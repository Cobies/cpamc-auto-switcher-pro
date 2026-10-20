package plugin

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAutonomousQuotaPoller_FamilyIsolationAndTelemetry(t *testing.T) {
	tempDir := t.TempDir()
	authDir := filepath.Join(tempDir, "auth-files")
	_ = os.MkdirAll(authDir, 0755)

	// Mock Antigravity account 1 (Gemini pool member)
	acc1File := "antigravity-gemini.json"
	acc1Data := `{
		"type": "antigravity",
		"provider": "antigravity",
		"token": "mock-token-1",
		"project_id": "proj-123",
		"email": "gemini-leader@gmail.com"
	}`
	_ = os.WriteFile(filepath.Join(authDir, acc1File), []byte(acc1Data), 0644)

	// Mock Antigravity account 2 (Claude pool member)
	acc2File := "antigravity-claude.json"
	acc2Data := `{
		"type": "antigravity",
		"provider": "antigravity",
		"token": "mock-token-2",
		"email": "claude-leader@gmail.com"
	}`
	_ = os.WriteFile(filepath.Join(authDir, acc2File), []byte(acc2Data), 0644)

	// Mock server returning Google Quota response with BOTH Gemini and Claude groups
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remGemini := 0.85 // 85% remaining
		remClaude := 0.10 // 10% remaining (exhausted)
		respJSON := `{
			"groups": [
				{
					"displayName": "Gemini Models",
					"buckets": [
						{"displayName": "5 hours limit", "remainingFraction": ` + fmt.Sprintf("%f", remGemini) + `},
						{"displayName": "Weekly limit", "remainingFraction": 0.90}
					]
				},
				{
					"displayName": "Claude and GPT models",
					"buckets": [
						{"displayName": "5 hours limit", "remainingFraction": ` + fmt.Sprintf("%f", remClaude) + `},
						{"displayName": "Weekly limit", "remainingFraction": 0.05}
					]
				}
			]
		}`
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(respJSON))
	}))
	defer mockServer.Close()

	// Setup Registry with 2 Pools: 1 Gemini, 1 Claude
	stateFile := filepath.Join(tempDir, "poller-pools.json")
	reg := NewPoolRegistry(stateFile)
	_ = reg.SavePool(PoolDefinition{
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: acc1File,
	})
	_ = reg.SavePool(PoolDefinition{
		Family:     "claude",
		BasePrefix: "clau",
		LeaderAuth: acc2File,
	})

	previousReg := activeRegistry
	activeRegistry = func() *PoolRegistry { return reg }
	defer func() { activeRegistry = previousReg }()

	pe := GetPredictiveEngine()

	poller := &AutonomousQuotaPoller{
		interval:       100 * time.Millisecond,
		client:         mockServer.Client(),
		authDir:        authDir,
		antigravityURL: mockServer.URL,
		userAgent:      antigravityAgent,
	}

	poller.PollAllPoolAccounts(context.Background())

	// Give goroutines time to finish
	time.Sleep(300 * time.Millisecond)

	// Verify Gemini account got Gemini Models quota (85% remaining)
	qGemini, ok := pe.GetLiveQuota("gemini-leader@gmail.com")
	if !ok {
		t.Fatalf("expected quota for gemini-leader@gmail.com to be recorded")
	}
	if qGemini.Window5hPct != 85.0 {
		t.Errorf("expected Gemini 5h quota to be 85.0, got %f", qGemini.Window5hPct)
	}

	// Verify Claude account got Claude Models quota (10% remaining)
	qClaude, ok := pe.GetLiveQuota("claude-leader@gmail.com")
	if !ok {
		t.Fatalf("expected quota for claude-leader@gmail.com to be recorded")
	}
	if qClaude.Window5hPct != 10.0 {
		t.Errorf("expected Claude 5h quota to be 10.0, got %f", qClaude.Window5hPct)
	}

	// Start & Stop lifecycle verification
	poller.Start()
	if !poller.running {
		t.Errorf("expected poller to be running after Start()")
	}
	poller.Stop()
	if poller.running {
		t.Errorf("expected poller to stop after Stop()")
	}
}
