package plugin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClassifyArgonError(t *testing.T) {
	tests := []struct {
		name         string
		errText      string
		wantType     string
		wantRetry    bool
		wantCooldown bool
	}{
		{
			name:         "Empty error",
			errText:      "",
			wantType:     ArgonErrNone,
			wantRetry:    true,
			wantCooldown: false,
		},
		{
			name:         "Spanish rate limit with time",
			errText:      "Has alcanzado el límite. El límite se restablece a las 18:30.",
			wantType:     ArgonErrRateLimit,
			wantRetry:    false,
			wantCooldown: true,
		},
		{
			name:         "English quota exceeded",
			errText:      "HTTP 429: Quota exceeded for model gemini-4-argon",
			wantType:     ArgonErrRateLimit,
			wantRetry:    false,
			wantCooldown: true,
		},
		{
			name:         "Captcha / BotGuard detected",
			errText:      "Unusual traffic detected. Please complete the CAPTCHA verification.",
			wantType:     ArgonErrCaptcha,
			wantRetry:    false,
			wantCooldown: true,
		},
		{
			name:         "Session expired",
			errText:      "Session expired. Inicia sesión con tu cuenta de Google.",
			wantType:     ArgonErrSessionExpired,
			wantRetry:    false,
			wantCooldown: false,
		},
		{
			name:         "Daemon busy",
			errText:      "gemini_daemon isBusy: another request in progress",
			wantType:     ArgonErrDaemonBusy,
			wantRetry:    true,
			wantCooldown: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			errType, isRetryable, cooldownSec := ClassifyArgonError(tc.errText)
			if errType != tc.wantType {
				t.Errorf("got type %q, want %q", errType, tc.wantType)
			}
			if isRetryable != tc.wantRetry {
				t.Errorf("got isRetryable %v, want %v", isRetryable, tc.wantRetry)
			}
			if tc.wantCooldown && cooldownSec <= 0 {
				t.Errorf("expected positive cooldown, got %d", cooldownSec)
			}
		})
	}
}

func TestArgonStatus_ProbeDaemonOffline(t *testing.T) {
	store := GetArgonStore()
	store.daemonURL = "http://127.0.0.1:59999" // unreachable test port

	status, isBusy, mem, _ := store.ProbeDaemon()
	if status != "offline" {
		t.Errorf("expected offline, got %s", status)
	}
	if isBusy {
		t.Errorf("expected not busy when offline")
	}
	if mem != 0 {
		t.Errorf("expected 0 memory when offline")
	}
}

func TestArgonStatus_ProbeDaemonOnline(t *testing.T) {
	// Mock daemon HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     "healthy",
			"isBusy":     false,
			"activeTask": "",
			"memoryMB":   142.5,
			"idle":       false,
		})
	}))
	defer server.Close()

	store := GetArgonStore()
	store.daemonURL = server.URL

	status, isBusy, mem, _ := store.ProbeDaemon()
	if status != "online" {
		t.Errorf("expected online, got %s", status)
	}
	if isBusy {
		t.Errorf("expected isBusy=false")
	}
	if mem < 100 {
		t.Errorf("expected >100 MB, got %f", mem)
	}
}

func TestArgonSyncSession_Validation(t *testing.T) {
	store := GetArgonStore()

	// Missing cookies
	_, err := store.IngestSession(SyncSessionPayload{Cookies: ""}, "")
	if err == nil {
		t.Errorf("expected error on empty cookies")
	}

	// Missing critical __Secure-1PSID / SID
	_, err = store.IngestSession(SyncSessionPayload{Cookies: "foo=bar; baz=123"}, "")
	if err == nil {
		t.Errorf("expected error on invalid cookies")
	}

	// Valid session
	acc, err := store.IngestSession(SyncSessionPayload{
		Cookies:  "__Secure-1PSID=test_token_123; __Secure-1PSIDTS=ts_456",
		AuthUser: "0",
		Email:    "test@google.com",
	}, "")
	if err != nil {
		t.Fatalf("unexpected error on valid cookies: %v", err)
	}
	if acc.AuthUser != "0" {
		t.Errorf("expected authuser 0, got %s", acc.AuthUser)
	}
	if acc.Status != "ready" {
		t.Errorf("expected status ready, got %s", acc.Status)
	}
}

func TestHandleArgonExecuteRPC_NonStreamAndStream(t *testing.T) {
	// Mock daemon HTTP server that handles /generate
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/generate" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":      "chatcmpl-test-123",
				"object":  "chat.completion",
				"created": 1729220000,
				"model":   "gemini-4-argon",
				"choices": []map[string]any{
					{
						"index": 0,
						"message": map[string]any{
							"role":    "assistant",
							"content": "Hello from Gemini 4 Argon Web Thinking!",
						},
						"finish_reason": "stop",
					},
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := GetArgonStore()
	store.daemonURL = server.URL
	_, _ = store.IngestSession(SyncSessionPayload{
		Cookies:  "__Secure-1PSID=test_cookie; SID=test_sid",
		AuthUser: "0",
		Email:    "tester@gmail.com",
	}, "")

	// 1. Non-stream execution
	nonStreamReq := map[string]any{
		"Model": "gemini-4-argon",
		"Stream": false,
		"Payload": []byte(`{"model":"gemini-4-argon","messages":[{"role":"user","content":"Hi"}]}`),
	}
	rawNonStream, _ := json.Marshal(nonStreamReq)
	resp, err := HandleArgonExecuteRPC(rawNonStream, false)
	if err != nil {
		t.Fatalf("unexpected error in HandleArgonExecuteRPC non-stream: %v", err)
	}
	execResp, ok := resp.(argonExecutorResponse)
	if !ok {
		t.Fatalf("expected argonExecutorResponse, got %T", resp)
	}
	if !strings.Contains(string(execResp.Payload), "Hello from Gemini 4 Argon") {
		t.Errorf("payload missing expected text: %s", string(execResp.Payload))
	}

	// 2. Stream execution
	streamReq := map[string]any{
		"Model": "gemini-4-argon",
		"Stream": true,
		"Payload": []byte(`{"model":"gemini-4-argon","messages":[{"role":"user","content":"Hi"}]}`),
	}
	rawStream, _ := json.Marshal(streamReq)
	respStream, err := HandleArgonExecuteRPC(rawStream, true)
	if err != nil {
		t.Fatalf("unexpected error in HandleArgonExecuteRPC stream: %v", err)
	}
	streamResp, ok := respStream.(argonExecutorStreamResponse)
	if !ok {
		t.Fatalf("expected argonExecutorStreamResponse, got %T", respStream)
	}
	if len(streamResp.Chunks) < 3 {
		t.Fatalf("expected at least 3 stream chunks, got %d", len(streamResp.Chunks))
	}
	// Check that DONE chunk is present
	lastChunk := string(streamResp.Chunks[len(streamResp.Chunks)-1].Payload)
	if !strings.Contains(lastChunk, "[DONE]") {
		t.Errorf("expected [DONE] in last chunk, got: %s", lastChunk)
	}
}

func TestModelProvider_ArgonBimodalCatalogAndRouting(t *testing.T) {
	store := GetArgonStore()
	_, _ = store.IngestSession(SyncSessionPayload{
		Cookies:  "__Secure-1PSID=test_cookie; SID=test_sid",
		AuthUser: "0",
		Email:    "argon_tester@gmail.com",
	}, "")

	reg := NewPoolRegistry(t.TempDir() + "/state.json")

	// Modalidad A (Solo): no pools registered -> gemini-4-argon must appear in static catalog
	models := poolPrefixedCatalog(reg)
	foundArgon := false
	for _, m := range models {
		if m.ID == "gemini-4-argon" || m.ID == "argon/gemini-4-argon" {
			foundArgon = true
			if m.OwnedBy != "gemini-argon" {
				t.Errorf("expected ownedBy gemini-argon, got %s", m.OwnedBy)
			}
		}
	}
	if !foundArgon {
		t.Errorf("expected gemini-4-argon in poolPrefixedCatalog when argon accounts exist")
	}

	// Route decision for solo account
	routeResp := routeDecisionFor(reg, "gemini-4-argon")
	if !routeResp.Handled {
		t.Errorf("expected handled route for gemini-4-argon")
	}
	if routeResp.Target != "gemini-argon" || routeResp.TargetModel != "gemini-4-argon" {
		t.Errorf("unexpected route decision: %+v", routeResp)
	}

	// Modalidad B (Pool): register Pool-03-argon
	pool := PoolDefinition{
		ID:          "Pool-03-argon",
		DisplayName: "Pool-03-argon",
		BasePrefix:  "argon",
		Family:      "gemini_argon",
		LeaderAuth:  "gemini-argon-u0.json",
		Policy: PoolPolicy{
			TargetModels: []string{"gemini-4-argon"},
		},
	}
	_ = reg.SavePool(pool)

	poolModels := poolPrefixedCatalog(reg)
	foundPool := false
	for _, m := range poolModels {
		if m.ID == "Pool-03-argon" {
			foundPool = true
		}
	}
	if !foundPool {
		t.Errorf("expected Pool-03-argon in poolPrefixedCatalog")
	}

	// Route decision for sovereign pool
	poolRoute := routeDecisionFor(reg, "Pool-03-argon")
	if !poolRoute.Handled || poolRoute.Target != "gemini-argon" {
		t.Errorf("unexpected route decision for Pool-03-argon: %+v", poolRoute)
	}
}

