package analytics

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTelemetryReplay_AnonymizationAnd429Detection(t *testing.T) {
	tempDB := filepath.Join(t.TempDir(), "rotations_replay_test.db")
	_, err := ResetDBForTest(tempDB)
	if err != nil {
		t.Fatalf("failed to init test db: %v", err)
	}
	defer func() {
		_, _ = ResetDBForTest("")
	}()

	// 1. Simular registro de evento 429
	realEmail := "developer-private-account@gmail.com"
	now := time.Now().UnixMilli()

	RecordFlightEvent(FlightRecorderEvent{
		AccountEmail:      realEmail,
		PoolID:            "Pool-01-gemini",
		ErrorKind:         "rate_limit",
		StatusCode:        429,
		ErrorMessage:      "resource exhausted: 429 Too Many Requests",
		HeadersSnapshot:   "x-quota-exceeded: true",
		LatencyMs:         120,
		QuotaSnapshotJSON: `{"percentage": 100}`,
	})
	FlushWriteQueueForTest()

	// 2. Exportar traza anónima
	trace, err := ExportAnonymousTrace(10)
	if err != nil {
		t.Fatalf("failed to export anonymous trace: %v", err)
	}

	if trace.EventsCount == 0 {
		t.Fatal("expected at least 1 event in trace, got 0")
	}

	// 3. Verificar anonimización estricta (Zero PII leak)
	for _, f := range trace.FlightLogs {
		if strings.Contains(f.AnonAccount, "@") || strings.Contains(f.AnonAccount, "developer") {
			t.Errorf("PII leaked in anonymous account identifier: %s", f.AnonAccount)
		}
		if !strings.HasPrefix(f.AnonAccount, "acc_") {
			t.Errorf("expected acc_ prefix in anonymous identifier, got %s", f.AnonAccount)
		}
		if f.StatusCode != 429 {
			t.Errorf("expected status code 429, got %d", f.StatusCode)
		}
	}

	// 4. Ejecutar simulación determinista (Replay)
	decisions := ReplayTrace(trace)
	if len(decisions) == 0 {
		t.Fatal("expected replay decisions, got 0")
	}

	found429Failover := false
	for _, d := range decisions {
		if d.StatusCode == 429 && d.Rotated && d.TriggerReason == "reactive_failover_429" {
			found429Failover = true
			break
		}
	}

	if !found429Failover {
		t.Errorf("expected replay to deterministically trigger reactive_failover_429 for 429 status")
	}
	_ = now
}
