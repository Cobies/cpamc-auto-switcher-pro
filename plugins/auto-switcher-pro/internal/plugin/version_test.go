package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

func TestHandleVersionHTTP_Success(t *testing.T) {
	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/v0/management/auto-switcher-pro/version",
	}

	raw, err := handleVersionHTTP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("failed to unmarshal envelope: %v", err)
	}

	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("failed to unmarshal result: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	bodyBytes, err := base64.StdEncoding.DecodeString(resp.Body)
	if err != nil {
		t.Fatalf("failed to decode base64: %v", err)
	}

	var data map[string]any
	if err := json.Unmarshal(bodyBytes, &data); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}

	if data["ok"] != true {
		t.Errorf("expected ok=true, got %v", data["ok"])
	}
	if data["current_version"] == "" {
		t.Errorf("expected non-empty current_version")
	}
	if data["github_repo"] != "WiloxDev/cpamc-auto-switcher-pro" {
		t.Errorf("expected WiloxDev/cpamc-auto-switcher-pro, got %v", data["github_repo"])
	}
}

func TestHandleVersionHTTP_MethodNotAllowed(t *testing.T) {
	req := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/version",
	}

	raw, err := handleVersionHTTP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("failed to unmarshal envelope: %v", err)
	}

	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("failed to unmarshal result: %v", err)
	}

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", resp.StatusCode)
	}
}
