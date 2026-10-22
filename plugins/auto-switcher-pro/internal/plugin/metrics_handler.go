package plugin

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"auto-switcher-pro/internal/analytics"
	"auto-switcher-pro/internal/license"
)

const metricsRoutePath = "/auto-switcher-pro/metrics"

func isMetricsPath(path string) bool {
	return strings.Contains(path, "/auto-switcher-pro/metrics") || strings.Contains(path, "/auto-switcher-pro/report")
}

func handleMetricsHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if strings.Contains(req.Path, "/auto-switcher-pro/report") {
		return handleGenerateSupportReportHTTP(req)
	}

	if method != http.MethodGet && method != http.MethodHead {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "GET or HEAD required",
		})
	}

	rangeParam := "24h"
	if u, err := url.Parse(req.Path); err == nil {
		if r := u.Query().Get("range"); r != "" {
			rangeParam = r
		}
	}

	snapshot, err := analytics.QueryMetrics(rangeParam)
	if err != nil {
		return jsonManagementResponse(http.StatusInternalServerError, map[string]string{
			"error":   "internal_error",
			"message": err.Error(),
		})
	}

	reg := activeRegistry()
	if reg != nil {
		enrichMetricsWithRegistry(snapshot, reg)
	}

	return jsonManagementResponse(http.StatusOK, snapshot)
}

func enrichMetricsWithRegistry(snapshot *analytics.MetricsSnapshot, reg *PoolRegistry) {
	if snapshot == nil || reg == nil {
		return
	}
	pools := reg.ListPools()
	if len(pools) == 0 {
		return
	}

	poolMap := make(map[string]*analytics.PoolStat)
	for i := range snapshot.Pools {
		p := &snapshot.Pools[i]
		key := strings.ToLower(strings.TrimSpace(p.PoolID))
		if key == "" {
			key = strings.ToLower(strings.TrimSpace(p.PoolPrefix))
		}
		poolMap[key] = p
	}

	for _, pool := range pools {
		idKey := strings.ToLower(strings.TrimSpace(pool.ID))
		prefixKey := strings.ToLower(strings.TrimSpace(pool.BasePrefix))

		targetModel := pool.ActiveModelForAccount(pool.ActiveLeader)
		if existing, ok := poolMap[idKey]; ok {
			existing.PoolID = pool.ID
			existing.Family = pool.Family
			existing.ActiveLeader = pool.ActiveLeader
			existing.SurvivalFallback = pool.Policy.SurvivalFallback
			if existing.TargetModel == "" {
				existing.TargetModel = targetModel
			}
		} else if existing, ok := poolMap[prefixKey]; ok {
			existing.PoolID = pool.ID
			existing.Family = pool.Family
			existing.ActiveLeader = pool.ActiveLeader
			existing.SurvivalFallback = pool.Policy.SurvivalFallback
			if existing.TargetModel == "" {
				existing.TargetModel = targetModel
			}
		} else {
			// Pool exists in registry but has 0 traffic in requested window
			snapshot.Pools = append(snapshot.Pools, analytics.PoolStat{
				PoolID:           pool.ID,
				PoolPrefix:       pool.BasePrefix,
				Family:           pool.Family,
				TargetModel:      targetModel,
				Requests:         0,
				Failovers:        0,
				ActiveLeader:     pool.ActiveLeader,
				SurvivalFallback: pool.Policy.SurvivalFallback,
			})
		}
	}

	// If no traffic is recorded yet for accounts, expose real accounts from registry
	if len(snapshot.Accounts) == 0 {
		for _, pool := range pools {
			members := pool.Members
			if len(members) == 0 {
				if pool.ActiveLeader != "" {
					members = append(members, pool.ActiveLeader)
				}
				members = append(members, pool.Reserves...)
			}
			for idx, m := range members {
				email := strings.TrimPrefix(m, "antigravity-")
				email = strings.TrimSuffix(email, ".json")
				roleLabel := pool.ID
				if roleLabel == "" {
					roleLabel = pool.BasePrefix
				}
				role := fmt.Sprintf("Líder (%s)", roleLabel)
				status := "Lista"
				if idx > 0 {
					role = fmt.Sprintf("Reserva %d (%s)", idx, roleLabel)
					status = "En espera de rotación"
				}
				snapshot.Accounts = append(snapshot.Accounts, analytics.AccountStat{
					Email:      email,
					PoolID:     pool.ID,
					PoolPrefix: pool.BasePrefix,
					Role:       role,
					Requests:   0,
					SharePct:   0.0,
					Status:     status,
				})
			}
		}
	}

	// Enrich all accounts with live predictive recovery ETAs and health score
	pe := GetPredictiveEngine()
	for i := range snapshot.Accounts {
		acc := &snapshot.Accounts[i]
		eta := pe.GetAccountRecoveryETA(acc.Email)
		acc.EstimatedETA = eta.EstimatedETAStr
		if eta.Window5hPct > 0 {
			acc.HealthScore = eta.Window5hPct
		}
		if eta.IsCooling {
			acc.Status = eta.EstimatedETAStr
		}
	}
}

// handleGenerateSupportReportHTTP builds a diagnostic package and dispatches it to the VPS License Hub.
func handleGenerateSupportReportHTTP(req ManagementRequestPayload) ([]byte, error) {
	events, _ := analytics.QueryRecentEvents(15)

	// Anonimizar correos en los logs antes de enviar
	anonymizedLogs := make([]analytics.RotationEvent, 0, len(events))
	for _, e := range events {
		masked := e.AccountEmail
		if atIdx := strings.Index(masked, "@"); atIdx > 0 {
			user := masked[:atIdx]
			domain := masked[atIdx:]
			if len(user) > 3 {
				masked = user[:3] + "***" + domain
			} else {
				masked = "***" + domain
			}
		}
		e.AccountEmail = masked
		anonymizedLogs = append(anonymizedLogs, e)
	}

	report := analytics.SupportReport{
		ID:         fmt.Sprintf("REP-%d", time.Now().UnixNano()%1000000),
		Timestamp:  time.Now().Unix(),
		MachineID:  license.GetMachineID(),
		MACAddress: license.GetMACAddress(),
		ClientName: license.GetSystemIdentity(),
		Version:    "1.1.0",
		OS:         "linux",
		RecentLogs: anonymizedLogs,
		SystemState: map[string]interface{}{
			"pools_count": len(activeRegistry().ListPools()),
		},
	}

	return jsonManagementResponse(http.StatusOK, map[string]interface{}{
		"ok":     true,
		"report": report,
	})
}
