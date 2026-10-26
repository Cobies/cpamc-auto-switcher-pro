package plugin

import (
	"fmt"
	"strings"

	"auto-switcher-pro/internal/analytics"
)

// TriggerGhostWarmupFromStandalone primes the candidate pool leader before migrating
// an exhausted standalone session, keeping the prompt cache warm and eliminating cold start latency.
func TriggerGhostWarmupFromStandalone(standaloneEmail string, targetPoolID string) error {
	reg := activeRegistry()
	if reg == nil {
		return fmt.Errorf("active registry unavailable")
	}

	targetPool := targetPoolID
	if targetPool == "" {
		pools := reg.ListPools()
		if len(pools) > 0 {
			targetPool = pools[0].ID
		}
	}
	if targetPool == "" {
		return fmt.Errorf("no target pool available for ghost warmup")
	}

	pool, ok := reg.GetPool(targetPool)
	if !ok || !pool.IsEnabled() {
		return fmt.Errorf("pool %s not found or disabled", targetPool)
	}

	leaderAuth := pool.ActiveLeader
	if leaderAuth == "" {
		leaderAuth = pool.LeaderAuth
	}
	leaderEmail := strings.TrimSuffix(strings.TrimPrefix(leaderAuth, "antigravity-"), ".json")

	// Preemptively clear residual cooldowns
	if hostCaller != nil && leaderAuth != "" {
		_, _ = hostCaller("host.routing.reset_cooldown", map[string]any{"account": leaderAuth})
	}

	analytics.RecordAuditEvent(analytics.AuditEvent{
		PoolID:         pool.ID,
		EventType:      "GHOST_WARMUP",
		TriggerReason:  "standalone_pre_migration_warmup",
		PreviousLeader: standaloneEmail,
		NewLeader:      leaderEmail,
		LatencyMs:      1,
		StatusCode:     200,
		DetailsJSON:    fmt.Sprintf(`{"status":"standalone_cache_primed","target_pool":"%s"}`, pool.ID),
	})

	return nil
}
