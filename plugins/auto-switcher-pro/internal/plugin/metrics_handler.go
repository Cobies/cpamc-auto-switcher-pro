package plugin

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"auto-switcher-pro/internal/analytics"
)

const metricsRoutePath = "/auto-switcher-pro/metrics"

func isMetricsPath(path string) bool {
	return strings.Contains(path, "/auto-switcher-pro/metrics")
}

func handleMetricsHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
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
			if existing.TargetModel == "" {
				existing.TargetModel = targetModel
			}
		} else if existing, ok := poolMap[prefixKey]; ok {
			existing.PoolID = pool.ID
			existing.Family = pool.Family
			existing.ActiveLeader = pool.ActiveLeader
			if existing.TargetModel == "" {
				existing.TargetModel = targetModel
			}
		} else {
			// Pool exists in registry but has 0 traffic in requested window
			snapshot.Pools = append(snapshot.Pools, analytics.PoolStat{
				PoolID:       pool.ID,
				PoolPrefix:   pool.BasePrefix,
				Family:       pool.Family,
				TargetModel:  targetModel,
				Requests:     0,
				Failovers:    0,
				ActiveLeader: pool.ActiveLeader,
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
}
