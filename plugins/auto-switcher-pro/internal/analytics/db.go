package analytics

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	dbInstance *sql.DB
	dbOnce     sync.Once
	dbPath     string
	dbMu       sync.RWMutex
)

// resolveDBPath locates the writable storage directory for rotations.db.
func resolveDBPath() string {
	candidates := []string{
		"/CLIProxyAPI/plugins/rotations.db",
		filepath.Join(os.Getenv("HOME"), "services/cliproxy/plugins/rotations.db"),
		filepath.Join(os.Getenv("HOME"), ".local/share/auto-switcher-pro/rotations.db"),
		"./rotations.db",
	}
	for _, p := range candidates {
		dir := filepath.Dir(p)
		if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
			return p
		}
	}
	return "./rotations.db"
}

// ResetDBForTest resets the singleton instance and directs storage to tPath.
func ResetDBForTest(tPath string) (*sql.DB, error) {
	dbMu.Lock()
	defer dbMu.Unlock()
	if dbInstance != nil {
		_ = dbInstance.Close()
		dbInstance = nil
	}
	dbPath = tPath
	dbOnce = sync.Once{}
	return InitDB()
}

// InitDB initializes SQLite in WAL mode and creates required tables.
func InitDB() (*sql.DB, error) {
	var initErr error
	dbOnce.Do(func() {
		if dbPath == "" {
			dbPath = resolveDBPath()
		}
		_ = os.MkdirAll(filepath.Dir(dbPath), 0755)

		dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)", dbPath)
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			initErr = err
			return
		}

		db.SetMaxOpenConns(5)
		db.SetMaxIdleConns(2)
		db.SetConnMaxLifetime(time.Hour)

		schema := `
		CREATE TABLE IF NOT EXISTS pool_rotations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp INTEGER NOT NULL,
			pool_id TEXT DEFAULT '',
			pool_prefix TEXT NOT NULL,
			selected_account TEXT NOT NULL,
			account_email TEXT NOT NULL,
			is_failover INTEGER NOT NULL,
			cascade_index INTEGER NOT NULL,
			target_model TEXT NOT NULL,
			status_code INTEGER DEFAULT 200
		);
		CREATE INDEX IF NOT EXISTS idx_rotations_ts ON pool_rotations(timestamp);
		CREATE INDEX IF NOT EXISTS idx_rotations_pool ON pool_rotations(pool_prefix);
		CREATE INDEX IF NOT EXISTS idx_rotations_account ON pool_rotations(account_email);

		CREATE TABLE IF NOT EXISTS account_health (
			account_key TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			cool_until_ms INTEGER DEFAULT 0,
			hourly_req_count INTEGER DEFAULT 0,
			consecutive_errors INTEGER DEFAULT 0,
			health_score REAL DEFAULT 100.0,
			window_5h_pct REAL DEFAULT 100.0,
			weekly_pct REAL DEFAULT 100.0,
			last_used_ms INTEGER DEFAULT 0,
			updated_at_ms INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_account_health_updated ON account_health(updated_at_ms);

		CREATE TABLE IF NOT EXISTS session_affinity (
			session_id TEXT NOT NULL,
			pool_id TEXT NOT NULL,
			account_email TEXT NOT NULL,
			last_turn_ms INTEGER NOT NULL,
			PRIMARY KEY (session_id, pool_id)
		);
		CREATE INDEX IF NOT EXISTS idx_session_affinity_last ON session_affinity(last_turn_ms);

		CREATE TABLE IF NOT EXISTS audit_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp INTEGER NOT NULL,
			pool_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			trigger_reason TEXT NOT NULL,
			previous_leader TEXT,
			new_leader TEXT,
			latency_ms INTEGER DEFAULT 0,
			status_code INTEGER DEFAULT 200,
			details_json TEXT DEFAULT '{}'
		);
		CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(timestamp);
		CREATE INDEX IF NOT EXISTS idx_audit_events_pool ON audit_events(pool_id);

		CREATE TABLE IF NOT EXISTS flight_recorder (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp INTEGER NOT NULL,
			account_email TEXT NOT NULL,
			pool_id TEXT NOT NULL,
			error_kind TEXT NOT NULL,
			status_code INTEGER DEFAULT 0,
			error_message TEXT NOT NULL,
			headers_snapshot TEXT DEFAULT '',
			latency_ms INTEGER DEFAULT 0,
			quota_snapshot_json TEXT DEFAULT '{}'
		);
		CREATE INDEX IF NOT EXISTS idx_flight_recorder_ts ON flight_recorder(timestamp);
		CREATE INDEX IF NOT EXISTS idx_flight_recorder_acc ON flight_recorder(account_email);
		`
		if _, err := db.Exec(schema); err != nil {
			initErr = fmt.Errorf("failed to init schema: %w", err)
			return
		}

		// Idempotent column check for existing databases
		_, _ = db.Exec(`ALTER TABLE pool_rotations ADD COLUMN pool_id TEXT DEFAULT '';`)
		_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_rotations_pool_id ON pool_rotations(pool_id);`)

		dbInstance = db
		initWriteWorker()
	})

	if initErr != nil {
		return nil, initErr
	}
	return dbInstance, nil
}

// ---------------------------------------------------------------------------
// Model Entities
// ---------------------------------------------------------------------------

// RotationEvent represents a single routed request event.
type RotationEvent struct {
	Timestamp       int64  `json:"timestamp"`
	PoolID          string `json:"pool_id"`
	PoolPrefix      string `json:"pool_prefix"`
	SelectedAccount string `json:"selected_account"`
	AccountEmail    string `json:"account_email"`
	IsFailover      bool   `json:"is_failover"`
	CascadeIndex    int    `json:"cascade_index"`
	TargetModel     string `json:"target_model"`
	StatusCode      int    `json:"status_code"`
}

// AccountHealth represents the persistent state and score of an account.
type AccountHealth struct {
	AccountKey        string  `json:"account_key"`
	Email             string  `json:"email"`
	CoolUntilMs       int64   `json:"cool_until_ms"`
	HourlyReqCount    int     `json:"hourly_req_count"`
	ConsecutiveErrors int     `json:"consecutive_errors"`
	HealthScore       float64 `json:"health_score"` // 0.0 - 100.0
	Window5hPct       float64 `json:"window_5h_pct"`
	WeeklyPct         float64 `json:"weekly_pct"`
	LastUsedMs        int64   `json:"last_used_ms"`
	UpdatedAtMs       int64   `json:"updated_at_ms"`
}

// SessionAffinity maps an active agent session to a pool account for Prompt Cache preservation.
type SessionAffinity struct {
	SessionID    string `json:"session_id"`
	PoolID       string `json:"pool_id"`
	AccountEmail string `json:"account_email"`
	LastTurnMs   int64  `json:"last_turn_ms"`
}

// AuditEvent represents a rotation or rebalance decision.
type AuditEvent struct {
	ID             int64  `json:"id,omitempty"`
	Timestamp      int64  `json:"timestamp"`
	PoolID         string `json:"pool_id"`
	EventType      string `json:"event_type"` // "PREVENTIVE", "FAILOVER", "REBALANCE", "STICKY_SESSION"
	TriggerReason  string `json:"trigger_reason"`
	PreviousLeader string `json:"previous_leader"`
	NewLeader      string `json:"new_leader"`
	LatencyMs      int64  `json:"latency_ms"`
	StatusCode     int    `json:"status_code"`
	DetailsJSON    string `json:"details_json"`
}

// FlightRecorderEvent represents a crash, 429, or network drop incident.
type FlightRecorderEvent struct {
	ID                int64  `json:"id,omitempty"`
	Timestamp         int64  `json:"timestamp"`
	AccountEmail      string `json:"account_email"`
	PoolID            string `json:"pool_id"`
	ErrorKind         string `json:"error_kind"`
	StatusCode        int    `json:"status_code"`
	ErrorMessage      string `json:"error_message"`
	HeadersSnapshot   string `json:"headers_snapshot"`
	LatencyMs         int64  `json:"latency_ms"`
	QuotaSnapshotJSON string `json:"quota_snapshot_json"`
}

// ---------------------------------------------------------------------------
// Asynchronous Write Worker Pool (Zero I/O Block on Request Processing)
// ---------------------------------------------------------------------------

type writeTask struct {
	kind string // "rotation", "health", "affinity", "audit", "flight"
	data any
}

var (
	writeQueue     chan writeTask
	writeQueueOnce sync.Once
)

func initWriteWorker() {
	writeQueueOnce.Do(func() {
		writeQueue = make(chan writeTask, 2048)
		go runWriteWorker()
		go startAutoVacuumDaemon()
	})
}

func enqueueWrite(task writeTask) {
	initWriteWorker()
	select {
	case writeQueue <- task:
	default:
		// Queue saturated: drop safely to avoid memory exhaustion
	}
}

func runWriteWorker() {
	for task := range writeQueue {
		dbMu.RLock()
		db := dbInstance
		dbMu.RUnlock()

		if db == nil {
			var err error
			db, err = InitDB()
			if err != nil || db == nil {
				continue
			}
		}

		executeWriteTask(db, task)
	}
}

func executeWriteTask(db *sql.DB, task writeTask) {
	switch task.kind {
	case "rotation":
		evt, ok := task.data.(RotationEvent)
		if !ok {
			return
		}
		isFailoverInt := 0
		if evt.IsFailover {
			isFailoverInt = 1
		}
		stmt := `INSERT INTO pool_rotations (
			timestamp, pool_id, pool_prefix, selected_account, account_email, is_failover, cascade_index, target_model, status_code
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		_, _ = db.Exec(stmt,
			evt.Timestamp,
			evt.PoolID,
			evt.PoolPrefix,
			evt.SelectedAccount,
			evt.AccountEmail,
			isFailoverInt,
			evt.CascadeIndex,
			evt.TargetModel,
			evt.StatusCode,
		)

	case "health":
		h, ok := task.data.(AccountHealth)
		if !ok {
			return
		}
		if h.UpdatedAtMs == 0 {
			h.UpdatedAtMs = time.Now().UnixMilli()
		}
		stmt := `INSERT INTO account_health (
			account_key, email, cool_until_ms, hourly_req_count, consecutive_errors,
			health_score, window_5h_pct, weekly_pct, last_used_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(account_key) DO UPDATE SET
			cool_until_ms=excluded.cool_until_ms,
			hourly_req_count=excluded.hourly_req_count,
			consecutive_errors=excluded.consecutive_errors,
			health_score=excluded.health_score,
			window_5h_pct=excluded.window_5h_pct,
			weekly_pct=excluded.weekly_pct,
			last_used_ms=excluded.last_used_ms,
			updated_at_ms=excluded.updated_at_ms`
		_, _ = db.Exec(stmt,
			h.AccountKey,
			h.Email,
			h.CoolUntilMs,
			h.HourlyReqCount,
			h.ConsecutiveErrors,
			h.HealthScore,
			h.Window5hPct,
			h.WeeklyPct,
			h.LastUsedMs,
			h.UpdatedAtMs,
		)

	case "affinity":
		aff, ok := task.data.(SessionAffinity)
		if !ok {
			return
		}
		if aff.LastTurnMs == 0 {
			aff.LastTurnMs = time.Now().UnixMilli()
		}
		stmt := `INSERT INTO session_affinity (
			session_id, pool_id, account_email, last_turn_ms
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(session_id, pool_id) DO UPDATE SET
			account_email=excluded.account_email,
			last_turn_ms=excluded.last_turn_ms`
		_, _ = db.Exec(stmt, aff.SessionID, aff.PoolID, aff.AccountEmail, aff.LastTurnMs)

	case "audit":
		evt, ok := task.data.(AuditEvent)
		if !ok {
			return
		}
		if evt.Timestamp == 0 {
			evt.Timestamp = time.Now().UnixMilli()
		}
		if evt.StatusCode == 0 {
			evt.StatusCode = 200
		}
		stmt := `INSERT INTO audit_events (
			timestamp, pool_id, event_type, trigger_reason, previous_leader, new_leader, latency_ms, status_code, details_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		_, _ = db.Exec(stmt,
			evt.Timestamp,
			evt.PoolID,
			evt.EventType,
			evt.TriggerReason,
			evt.PreviousLeader,
			evt.NewLeader,
			evt.LatencyMs,
			evt.StatusCode,
			evt.DetailsJSON,
		)

	case "flight":
		rec, ok := task.data.(FlightRecorderEvent)
		if !ok {
			return
		}
		if rec.Timestamp == 0 {
			rec.Timestamp = time.Now().UnixMilli()
		}
		stmt := `INSERT INTO flight_recorder (
			timestamp, account_email, pool_id, error_kind, status_code, error_message, headers_snapshot, latency_ms, quota_snapshot_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		_, _ = db.Exec(stmt,
			rec.Timestamp,
			rec.AccountEmail,
			rec.PoolID,
			rec.ErrorKind,
			rec.StatusCode,
			rec.ErrorMessage,
			rec.HeadersSnapshot,
			rec.LatencyMs,
			rec.QuotaSnapshotJSON,
		)
	}
}

// ---------------------------------------------------------------------------
// Public Recording & Query APIs
// ---------------------------------------------------------------------------

// RecordEvent asynchronously records a rotation event into SQLite without blocking request dispatch.
func RecordEvent(evt RotationEvent) {
	if evt.Timestamp == 0 {
		evt.Timestamp = time.Now().UnixMilli()
	}
	if evt.StatusCode == 0 {
		evt.StatusCode = 200
	}
	enqueueWrite(writeTask{kind: "rotation", data: evt})
}

// SaveAccountHealth asynchronously persists account health and cooldown state.
func SaveAccountHealth(h AccountHealth) {
	if h.AccountKey == "" {
		return
	}
	enqueueWrite(writeTask{kind: "health", data: h})
}

// SetSessionAffinity asynchronously links an agent session to an account for caching affinity.
func SetSessionAffinity(aff SessionAffinity) {
	if aff.SessionID == "" || aff.PoolID == "" || aff.AccountEmail == "" {
		return
	}
	enqueueWrite(writeTask{kind: "affinity", data: aff})
}

// RecordAuditEvent asynchronously logs a rotation or rebalance decision.
func RecordAuditEvent(evt AuditEvent) {
	enqueueWrite(writeTask{kind: "audit", data: evt})
}

// RecordFlightEvent asynchronously records an incident into the flight recorder black box.
func RecordFlightEvent(rec FlightRecorderEvent) {
	enqueueWrite(writeTask{kind: "flight", data: rec})
}

// GetAllAccountHealth synchronously reads all saved account health records from SQLite.
func GetAllAccountHealth() (map[string]AccountHealth, error) {
	db, err := InitDB()
	if err != nil || db == nil {
		return nil, fmt.Errorf("db unavailable: %w", err)
	}

	rows, err := db.Query(`SELECT
		account_key, email, cool_until_ms, hourly_req_count, consecutive_errors,
		health_score, window_5h_pct, weekly_pct, last_used_ms, updated_at_ms
	FROM account_health`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make(map[string]AccountHealth)
	for rows.Next() {
		var h AccountHealth
		if err := rows.Scan(
			&h.AccountKey,
			&h.Email,
			&h.CoolUntilMs,
			&h.HourlyReqCount,
			&h.ConsecutiveErrors,
			&h.HealthScore,
			&h.Window5hPct,
			&h.WeeklyPct,
			&h.LastUsedMs,
			&h.UpdatedAtMs,
		); err == nil {
			results[h.AccountKey] = h
		}
	}
	return results, nil
}

// GetSessionAffinity checks if an active session has a pinned healthy account (TTL: 5 minutes).
func GetSessionAffinity(sessionID, poolID string) (SessionAffinity, bool) {
	db, err := InitDB()
	if err != nil || db == nil {
		return SessionAffinity{}, false
	}

	var aff SessionAffinity
	query := `SELECT session_id, pool_id, account_email, last_turn_ms
		FROM session_affinity
		WHERE session_id = ? AND pool_id = ?`
	err = db.QueryRow(query, sessionID, poolID).Scan(
		&aff.SessionID,
		&aff.PoolID,
		&aff.AccountEmail,
		&aff.LastTurnMs,
	)
	if err != nil {
		return SessionAffinity{}, false
	}

	// 5-minute Prompt Cache TTL validity
	now := time.Now().UnixMilli()
	if now-aff.LastTurnMs > 5*60*1000 {
		return aff, false
	}

	return aff, true
}

// QueryAuditEvents returns the most recent audit records.
func QueryAuditEvents(limit int) ([]AuditEvent, error) {
	db, err := InitDB()
	if err != nil || db == nil {
		return nil, fmt.Errorf("db unavailable: %w", err)
	}

	if limit <= 0 || limit > 200 {
		limit = 50
	}

	rows, err := db.Query(`SELECT
		id, timestamp, pool_id, event_type, trigger_reason, previous_leader, new_leader, latency_ms, status_code, details_json
	FROM audit_events ORDER BY timestamp DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(
			&e.ID,
			&e.Timestamp,
			&e.PoolID,
			&e.EventType,
			&e.TriggerReason,
			&e.PreviousLeader,
			&e.NewLeader,
			&e.LatencyMs,
			&e.StatusCode,
			&e.DetailsJSON,
		); err == nil {
			events = append(events, e)
		}
	}
	return events, nil
}

// QueryFlightEvents returns the most recent black box incidents.
func QueryFlightEvents(limit int) ([]FlightRecorderEvent, error) {
	db, err := InitDB()
	if err != nil || db == nil {
		return nil, fmt.Errorf("db unavailable: %w", err)
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	rows, err := db.Query(`SELECT
		id, timestamp, account_email, pool_id, error_kind, status_code, error_message, headers_snapshot, latency_ms, quota_snapshot_json
	FROM flight_recorder ORDER BY timestamp DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []FlightRecorderEvent
	for rows.Next() {
		var f FlightRecorderEvent
		if err := rows.Scan(
			&f.ID,
			&f.Timestamp,
			&f.AccountEmail,
			&f.PoolID,
			&f.ErrorKind,
			&f.StatusCode,
			&f.ErrorMessage,
			&f.HeadersSnapshot,
			&f.LatencyMs,
			&f.QuotaSnapshotJSON,
		); err == nil {
			events = append(events, f)
		}
	}
	return events, nil
}

// AutoVacuumCheckpoint purges rotation and audit records older than maxAgeDays (default: 30 days)
// and forces SQLite to truncate its WAL journal file, keeping disk usage lean.
func AutoVacuumCheckpoint(maxAgeDays int) error {
	db, err := InitDB()
	if err != nil || db == nil {
		return fmt.Errorf("db unavailable: %w", err)
	}

	if maxAgeDays <= 0 {
		maxAgeDays = 30
	}

	cutoffMs := time.Now().AddDate(0, 0, -maxAgeDays).UnixMilli()

	// 1. Purge old records
	_, _ = db.Exec(`DELETE FROM pool_rotations WHERE timestamp < ?`, cutoffMs)
	_, _ = db.Exec(`DELETE FROM audit_events WHERE timestamp < ?`, cutoffMs)
	_, _ = db.Exec(`DELETE FROM flight_recorder WHERE timestamp < ?`, cutoffMs)
	_, _ = db.Exec(`DELETE FROM session_affinity WHERE last_turn_ms < ?`, cutoffMs)

	// 2. Truncate WAL journal to reclaim physical disk space
	_, err = db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}

func startAutoVacuumDaemon() {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		_ = AutoVacuumCheckpoint(30)
	}
}
