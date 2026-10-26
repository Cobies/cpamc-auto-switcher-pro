package analytics

import (
	"path/filepath"
	"testing"
	"time"
)

func TestQueryAccountStability_CalculatesScoreAndRating(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "rotations.db")

	db, err := ResetDBForTest(dbPath)
	if err != nil {
		t.Fatalf("failed to init db for test: %v", err)
	}

	testEmail := "dev_tester@example.com"
	now := time.Now().UnixMilli()

	// 1. Insertar peticiones exitosas
	_, err = db.Exec(`
		INSERT INTO pool_rotations (timestamp, pool_prefix, selected_account, account_email, is_failover, cascade_index, target_model, status_code)
		VALUES (?, 'clau', 'acc1', ?, 0, 0, 'claude-3-7-sonnet', 200),
		       (?, 'clau', 'acc1', ?, 0, 0, 'claude-3-7-sonnet', 200),
		       (?, 'clau', 'acc1', ?, 0, 0, 'claude-3-7-sonnet', 200)
	`, now, testEmail, now, testEmail, now, testEmail)
	if err != nil {
		t.Fatalf("failed to insert test rotations: %v", err)
	}

	metrics, err := QueryAccountStability(testEmail)
	if err != nil {
		t.Fatalf("QueryAccountStability failed: %v", err)
	}

	if metrics.TotalRequests != 3 {
		t.Errorf("expected 3 total requests, got %d", metrics.TotalRequests)
	}
	if metrics.SuccessRate != 100.0 {
		t.Errorf("expected 100%% success rate, got %f", metrics.SuccessRate)
	}
	if metrics.HealthRating != "Excelente" {
		t.Errorf("expected rating 'Excelente', got %s", metrics.HealthRating)
	}

	// 2. Insertar un incidente de red (502) en flight_recorder
	_, err = db.Exec(`
		INSERT INTO flight_recorder (timestamp, account_email, pool_id, error_kind, status_code, error_message)
		VALUES (?, ?, 'Pool-04-claude', 'upstream_error', 502, 'Bad Gateway')
	`, now, testEmail)
	if err != nil {
		t.Fatalf("failed to insert test flight error: %v", err)
	}

	metrics2, err := QueryAccountStability(testEmail)
	if err != nil {
		t.Fatalf("QueryAccountStability after error failed: %v", err)
	}

	if metrics2.RecentErrors != 1 {
		t.Errorf("expected 1 recent error, got %d", metrics2.RecentErrors)
	}
	if metrics2.LastErrorCode != 502 {
		t.Errorf("expected last error code 502, got %d", metrics2.LastErrorCode)
	}
	if metrics2.StabilityScore >= 100.0 {
		t.Errorf("expected score to decrease after error, got %f", metrics2.StabilityScore)
	}
}
