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

	db, err := ResetDBForTest(filepath.Join(tempDir, "test_rotations.db"))
	if err != nil {
		t.Fatalf("ResetDBForTest failed: %v", err)
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

	// Wait for worker queue to flush to SQLite
	time.Sleep(150 * time.Millisecond)

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

	// 3. Test Account Health persistence
	coolUntil := now + (15 * 60 * 1000)
	SaveAccountHealth(AccountHealth{
		AccountKey:  "leader@gmail.com",
		Email:       "leader@gmail.com",
		CoolUntilMs: coolUntil,
		HealthScore: 95.5,
		Window5hPct: 82.0,
		WeeklyPct:   90.0,
	})

	// 4. Test Session Affinity (Prompt Cache stickiness)
	SetSessionAffinity(SessionAffinity{
		SessionID:    "session-xyz-123",
		PoolID:       "Pool-01-gemini",
		AccountEmail: "leader@gmail.com",
		LastTurnMs:   now,
	})

	// 5. Test Audit Event logging
	RecordAuditEvent(AuditEvent{
		PoolID:         "Pool-01-gemini",
		EventType:      "PREVENTIVE",
		TriggerReason:  "hourly_threshold_exceeded",
		PreviousLeader: "leader@gmail.com",
		NewLeader:      "reserve@gmail.com",
		LatencyMs:      12,
		StatusCode:     200,
	})

	// 6. Test Flight Recorder incident capture
	RecordFlightEvent(FlightRecorderEvent{
		AccountEmail: "reserve@gmail.com",
		PoolID:       "Pool-01-gemini",
		ErrorKind:    "RATE_LIMIT_429",
		StatusCode:   429,
		ErrorMessage: "Resource has been exhausted",
		LatencyMs:    450,
	})

	// Wait for worker queue to flush
	time.Sleep(150 * time.Millisecond)

	// Validate Account Health
	healthMap, err := GetAllAccountHealth()
	if err != nil {
		t.Fatalf("GetAllAccountHealth failed: %v", err)
	}
	h, ok := healthMap["leader@gmail.com"]
	if !ok || h.CoolUntilMs != coolUntil || h.HealthScore != 95.5 {
		t.Errorf("expected saved health with coolUntil=%d score=95.5, got %+v", coolUntil, h)
	}

	// Validate Session Affinity
	aff, ok := GetSessionAffinity("session-xyz-123", "Pool-01-gemini")
	if !ok || aff.AccountEmail != "leader@gmail.com" {
		t.Errorf("expected valid session affinity for leader@gmail.com, got %+v (ok=%v)", aff, ok)
	}

	// Validate Audit Events
	audits, err := QueryAuditEvents(10)
	if err != nil || len(audits) == 0 {
		t.Fatalf("QueryAuditEvents failed or empty: %v", err)
	}
	if audits[0].EventType != "PREVENTIVE" || audits[0].NewLeader != "reserve@gmail.com" {
		t.Errorf("unexpected audit event: %+v", audits[0])
	}

	// Validate Flight Recorder
	flights, err := QueryFlightEvents(10)
	if err != nil || len(flights) == 0 {
		t.Fatalf("QueryFlightEvents failed or empty: %v", err)
	}
	if flights[0].ErrorKind != "RATE_LIMIT_429" || flights[0].StatusCode != 429 {
		t.Errorf("unexpected flight event: %+v", flights[0])
	}
}
