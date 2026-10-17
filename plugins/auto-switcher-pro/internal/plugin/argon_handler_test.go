package plugin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
