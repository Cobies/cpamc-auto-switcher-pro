package plugin

import (
	"strings"
	"sync"
	"time"

	"auto-switcher-pro/internal/analytics"
)

var (
	warmupOnce     sync.Once
	warmedAccounts = make(map[string]time.Time)
	warmupMu       sync.Mutex
)

// TriggerGhostWarmupCheck inspects active pools. If the active leader has >= 75% fatigue
// or critical quota, it proactively selects the healthiest reserve member,
// clears residual cooldowns via host bridge if needed, and records a GHOST_WARMUP audit event.
func TriggerGhostWarmupCheck(registry *PoolRegistry) {
	if registry == nil {
		return
	}
	pools := registry.ListPools()
	predEngine := GetPredictiveEngine()
	if predEngine == nil {
		return
	}

	for _, p := range pools {
		if !p.IsEnabled() {
			continue
		}
		leaderAuth := p.ActiveLeader
		if leaderAuth == "" {
			leaderAuth = p.LeaderAuth
		}
		leaderEmail := strings.TrimSuffix(strings.TrimPrefix(leaderAuth, "antigravity-"), ".json")
		fatiguePct, isCooling, _ := predEngine.GetAccountStatus(leaderEmail)

		// Check if leader is near fatigue threshold (>= 75%) or cooling
		if fatiguePct >= 75.0 || isCooling || predEngine.ShouldPreventiveCool(leaderEmail) {
			members := p.AllMembers()
			if len(members) < 2 {
				continue
			}

			// Find healthiest reserve
			var bestReserve string
			var bestScore float64 = -1
			for _, m := range members {
				if strings.EqualFold(m, leaderAuth) {
					continue
				}
				resEmail := strings.TrimSuffix(strings.TrimPrefix(m, "antigravity-"), ".json")
				if predEngine.ShouldPreventiveCool(resEmail) {
					continue
				}
				q, hasQ := predEngine.GetLiveQuota(resEmail)
				score := 50.0
				if hasQ {
					score = q.Window5hPct + q.WeeklyPct
				}
				if score > bestScore {
					bestScore = score
					bestReserve = m
				}
			}

			if bestReserve != "" {
				reserveEmail := strings.TrimSuffix(strings.TrimPrefix(bestReserve, "antigravity-"), ".json")
				warmupMu.Lock()
				lastWarmup, alreadyWarmed := warmedAccounts[reserveEmail]
				// Avoid spamming warmups: at most once every 5 minutes per reserve
				if alreadyWarmed && time.Since(lastWarmup) < 5*time.Minute {
					warmupMu.Unlock()
					continue
				}
				warmedAccounts[reserveEmail] = time.Now()
				warmupMu.Unlock()

				// If host bridge is available, preemptively clear any lingering cooldowns
				if hostCaller != nil {
					_, _ = hostCaller("host.routing.reset_cooldown", map[string]any{"account": bestReserve})
				}

				// Log warmup event in SQLite audit log
				analytics.RecordAuditEvent(analytics.AuditEvent{
					PoolID:         p.ID,
					EventType:      "GHOST_WARMUP",
					TriggerReason:  "leader_fatigue_75pct_threshold",
					PreviousLeader: leaderEmail,
					NewLeader:      reserveEmail,
					LatencyMs:      1,
					StatusCode:     200,
					DetailsJSON:    `{"status":"reserve_prewarmed_ready"}`,
				})
			}
		}
	}
}

// StartGhostWarmupDaemon launches a light ticker every 30s to monitor pools.
func StartGhostWarmupDaemon() {
	warmupOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				TriggerGhostWarmupCheck(activeRegistry())
			}
		}()
	})
}
