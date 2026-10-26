package plugin

import (
	"path/filepath"
	"testing"

	"auto-switcher-pro/internal/analytics"
)

func TestTriggerGhostWarmupFromStandalone_PrimesLeaderAndLogsAudit(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "rotations.db")
	_, err := analytics.ResetDBForTest(dbPath)
	if err != nil {
		t.Fatalf("failed to init test db: %v", err)
	}

	stateFile := filepath.Join(tempDir, "auto-switcher-pro-state.json")
	reg := NewPoolRegistry(stateFile)
	poolDef := PoolDefinition{
		ID:         "Pool-01-gemini",
		BasePrefix: "agy",
		Family:     "gemini",
		LeaderAuth: "antigravity-leader@google.com.json",
		Reserves:   []string{"antigravity-reserve@google.com.json"},
	}
	_ = reg.SavePool(poolDef)

	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return reg }
	t.Cleanup(func() { activeRegistry = previous })

	err = TriggerGhostWarmupFromStandalone("standalone-dev@anthropic.com", "Pool-01-gemini")
	if err != nil {
		t.Fatalf("TriggerGhostWarmupFromStandalone failed: %v", err)
	}

	analytics.FlushWriteQueueForTest()

	events, err := analytics.QueryAuditEvents(10)
	if err != nil {
		t.Fatalf("QueryAuditEvents failed: %v", err)
	}

	found := false
	for _, e := range events {
		if e.EventType == "GHOST_WARMUP" && e.PoolID == "Pool-01-gemini" && e.PreviousLeader == "standalone-dev@anthropic.com" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected GHOST_WARMUP audit event in SQLite, but not found")
	}
}
