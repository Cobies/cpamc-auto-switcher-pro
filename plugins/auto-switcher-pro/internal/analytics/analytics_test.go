package analytics

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteAnalyticsLifecycle(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "analytics-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	dbPath = filepath.Join(tempDir, "test_rotations.db")

	db, err := InitDB()
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if db == nil {
		t.Fatal("expected non-nil db instance")
	}

	// 1. Insert test events
	now := time.Now().UnixMilli()
	RecordEvent(RotationEvent{
		Timestamp:       now - 1000,
		PoolID:          "Pool-01-gemini",
		PoolPrefix:      "agy",
		SelectedAccount: "antigravity-leader@gmail.com.json",
		AccountEmail:    "leader@gmail.com",
		IsFailover:      false,
		CascadeIndex:    0,
		TargetModel:     "gemini-3.8-flash-high",
	})

	RecordEvent(RotationEvent{
		Timestamp:       now,
		PoolID:          "Pool-01-gemini",
		PoolPrefix:      "agy",
		SelectedAccount: "antigravity-reserve@gmail.com.json",
		AccountEmail:    "reserve@gmail.com",
		IsFailover:      true,
		CascadeIndex:    1,
		TargetModel:     "gemini-3.8-flash-high",
	})

	// Wait for goroutines to flush to SQLite
	time.Sleep(100 * time.Millisecond)

	// 2. Query metrics
	snap, err := QueryMetrics("24h")
	if err != nil {
		t.Fatalf("QueryMetrics failed: %v", err)
	}

	if snap.Totals.TotalRequests != 2 {
		t.Errorf("expected 2 total requests, got %d", snap.Totals.TotalRequests)
	}
	if snap.Totals.LeaderRequests != 1 {
		t.Errorf("expected 1 leader request, got %d", snap.Totals.LeaderRequests)
	}
	if snap.Totals.FailoverRescues != 1 {
		t.Errorf("expected 1 failover rescue, got %d", snap.Totals.FailoverRescues)
	}
	if snap.Totals.FailoverRatePct != 50.0 {
		t.Errorf("expected 50%% failover rate, got %f", snap.Totals.FailoverRatePct)
	}
	if len(snap.Pools) != 1 || snap.Pools[0].PoolID != "Pool-01-gemini" {
		t.Errorf("expected pool 'Pool-01-gemini' in aggregates, got %v", snap.Pools)
	}
	if len(snap.Accounts) != 2 {
		t.Errorf("expected 2 accounts in aggregates, got %d", len(snap.Accounts))
	}
}
