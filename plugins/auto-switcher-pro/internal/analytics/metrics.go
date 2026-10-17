package analytics

import (
	"database/sql"
	"fmt"
	"os"
	"time"
)

// MetricsTotals represents high-level metrics for the selected time range.
type MetricsTotals struct {
	TotalRequests   int64   `json:"total_requests"`
	LeaderRequests  int64   `json:"leader_requests"`
	FailoverRescues int64   `json:"failover_rescues"`
	FailoverRatePct float64 `json:"failover_rate_pct"`
}

// DatabaseInfo represents the physical properties of the local SQLite storage.
type DatabaseInfo struct {
	Path    string  `json:"path"`
	Mode    string  `json:"mode"`
	Records int64   `json:"records"`
	SizeKB  float64 `json:"size_kb"`
}

// HourlyBucket represents aggregated activity for an hourly time slot.
type HourlyBucket struct {
	Hour      string `json:"hour"`
	Requests  int64  `json:"requests"`
	Failovers int64  `json:"failovers"`
}

// PoolStat represents aggregated requests per pool.
type PoolStat struct {
	PoolID       string `json:"pool_id,omitempty"`
	PoolPrefix   string `json:"pool_prefix"`
	Family       string `json:"family,omitempty"`
	TargetModel  string `json:"model"`
	Requests     int64  `json:"requests"`
	Failovers    int64  `json:"failovers"`
	ActiveLeader string `json:"active_leader,omitempty"`
}

// AccountStat represents individual account usage.
type AccountStat struct {
	Email      string  `json:"email"`
	PoolID     string  `json:"pool_id,omitempty"`
	PoolPrefix string  `json:"pool_prefix,omitempty"`
	Role       string  `json:"role"`
	Requests   int64   `json:"requests"`
	SharePct   float64 `json:"share_pct"`
	Status     string  `json:"status"`
}

// SupportReport represents a diagnostic snapshot sent by a client.
type SupportReport struct {
	ID          string                 `json:"id"`
	Timestamp   int64                  `json:"timestamp"`
	MachineID   string                 `json:"machine_id"`
	MACAddress  string                 `json:"mac_address,omitempty"`
	ClientName  string                 `json:"client_name"`
	Version     string                 `json:"version"`
	OS          string                 `json:"os"`
	Summary     string                 `json:"summary,omitempty"`
	RecentLogs  []RotationEvent        `json:"recent_logs,omitempty"`
	SystemState map[string]interface{} `json:"system_state,omitempty"`
}

// MetricsSnapshot is returned to the frontend or local management endpoint.
type MetricsSnapshot struct {
	OK             bool           `json:"ok"`
	Range          string         `json:"range"`
	Totals         MetricsTotals  `json:"totals"`
	Database       DatabaseInfo   `json:"database"`
	TimelineHourly []HourlyBucket `json:"timeline_hourly"`
	Pools          []PoolStat     `json:"pools"`
	Accounts       []AccountStat  `json:"accounts"`
}

// QueryRecentEvents returns the last N rotation events from SQLite for diagnostic reports.
func QueryRecentEvents(limit int) ([]RotationEvent, error) {
	if limit <= 0 {
		limit = 10
	}
	db, err := InitDB()
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT timestamp, pool_id, pool_prefix, selected_account, account_email, is_failover, cascade_index, target_model, status_code
		FROM pool_rotations
		ORDER BY timestamp DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []RotationEvent
	for rows.Next() {
		var evt RotationEvent
		var failoverInt int
		if err := rows.Scan(
			&evt.Timestamp,
			&evt.PoolID,
			&evt.PoolPrefix,
			&evt.SelectedAccount,
			&evt.AccountEmail,
			&failoverInt,
			&evt.CascadeIndex,
			&evt.TargetModel,
			&evt.StatusCode,
		); err == nil {
			evt.IsFailover = (failoverInt == 1)
			events = append(events, evt)
		}
	}
	return events, nil
}

// QueryMetrics computes an aggregated MetricsSnapshot for the given time range ("1h", "24h", "7d", "30d", "all").
func QueryMetrics(rangeStr string) (*MetricsSnapshot, error) {
	db, err := InitDB()
	if err != nil {
		return nil, err
	}

	now := time.Now()
	var startEpochMs int64
	switch rangeStr {
	case "1h":
		startEpochMs = now.Add(-1 * time.Hour).UnixMilli()
	case "7d":
		startEpochMs = now.AddDate(0, 0, -7).UnixMilli()
	case "30d":
		startEpochMs = now.AddDate(0, 0, -30).UnixMilli()
	case "all":
		startEpochMs = 0
	case "24h":
		fallthrough
	default:
		rangeStr = "24h"
		startEpochMs = now.Add(-24 * time.Hour).UnixMilli()
	}

	snap := &MetricsSnapshot{
		OK:             true,
		Range:          rangeStr,
		TimelineHourly: make([]HourlyBucket, 0),
		Pools:          make([]PoolStat, 0),
		Accounts:       make([]AccountStat, 0),
	}

	// 1. Database file stats
	dbPath := resolveDBPath()
	snap.Database.Path = dbPath
	snap.Database.Mode = "WAL"
	if fi, err := os.Stat(dbPath); err == nil {
		snap.Database.SizeKB = float64(fi.Size()) / 1024.0
	}
	var totalRecords int64
	_ = db.QueryRow("SELECT COUNT(*) FROM pool_rotations").Scan(&totalRecords)
	snap.Database.Records = totalRecords

	// 2. Range totals
	var totReqs, failovers int64
	err = db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(is_failover), 0)
		FROM pool_rotations
		WHERE timestamp >= ?
	`, startEpochMs).Scan(&totReqs, &failovers)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	snap.Totals.TotalRequests = totReqs
	snap.Totals.FailoverRescues = failovers
	snap.Totals.LeaderRequests = totReqs - failovers
	if totReqs > 0 {
		snap.Totals.FailoverRatePct = (float64(failovers) / float64(totReqs)) * 100.0
	}

	// 3. Hourly timeline buckets
	rows, err := db.Query(`
		SELECT 
			strftime('%H:00', timestamp / 1000, 'unixepoch', 'localtime') as hr,
			COUNT(*),
			COALESCE(SUM(is_failover), 0)
		FROM pool_rotations
		WHERE timestamp >= ?
		GROUP BY hr
		ORDER BY hr ASC
	`, startEpochMs)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var b HourlyBucket
			if err := rows.Scan(&b.Hour, &b.Requests, &b.Failovers); err == nil {
				snap.TimelineHourly = append(snap.TimelineHourly, b)
			}
		}
	}

	// 4. Per-pool aggregates (sovereign pool_id with seamless fallback to pool_prefix)
	pRows, err := db.Query(`
		SELECT 
			COALESCE(NULLIF(pool_id, ''), pool_prefix) as p_id,
			pool_prefix,
			target_model,
			COUNT(*),
			COALESCE(SUM(is_failover), 0)
		FROM pool_rotations
		WHERE timestamp >= ?
		GROUP BY p_id, pool_prefix, target_model
		ORDER BY COUNT(*) DESC
	`, startEpochMs)
	if err == nil {
		defer pRows.Close()
		for pRows.Next() {
			var ps PoolStat
			if err := pRows.Scan(&ps.PoolID, &ps.PoolPrefix, &ps.TargetModel, &ps.Requests, &ps.Failovers); err == nil {
				snap.Pools = append(snap.Pools, ps)
			}
		}
	}

	// 5. Per-account usage (with sovereign pool_id linkage)
	aRows, err := db.Query(`
		SELECT 
			account_email,
			COALESCE(NULLIF(pool_id, ''), pool_prefix) as p_id,
			pool_prefix,
			cascade_index,
			COUNT(*)
		FROM pool_rotations
		WHERE timestamp >= ?
		GROUP BY account_email, p_id, pool_prefix, cascade_index
		ORDER BY COUNT(*) DESC
	`, startEpochMs)
	if err == nil {
		defer aRows.Close()
		for aRows.Next() {
			var email, poolID, poolPrefix string
			var idx int
			var reqs int64
			if err := aRows.Scan(&email, &poolID, &poolPrefix, &idx, &reqs); err == nil {
				roleLabel := poolID
				if roleLabel == "" {
					roleLabel = poolPrefix
				}
				role := fmt.Sprintf("Líder (%s)", roleLabel)
				status := "Activa"
				if idx > 0 {
					role = fmt.Sprintf("Reserva %d (%s)", idx, roleLabel)
					status = "Rescató peticiones por 429"
				}
				sharePct := 0.0
				if totReqs > 0 {
					sharePct = (float64(reqs) / float64(totReqs)) * 100.0
				}
				snap.Accounts = append(snap.Accounts, AccountStat{
					Email:      email,
					PoolID:     poolID,
					PoolPrefix: poolPrefix,
					Role:       role,
					Requests:   reqs,
					SharePct:   sharePct,
					Status:     status,
				})
			}
		}
	}

	return snap, nil
}
