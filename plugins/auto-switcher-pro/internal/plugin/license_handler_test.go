package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

func TestLicenseHTTP_StatusAndValidation(t *testing.T) {
	t.Run("GET /auto-switcher-pro/license/status", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodGet,
			Path:   "/auto-switcher-pro/license/status",
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		_ = json.Unmarshal(out, &env)
		var resp ManagementResponsePayload
		_ = json.Unmarshal(env.Result, &resp)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200, got %d", resp.StatusCode)
		}

		bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
		var status map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &status)
		if status["machine_id"] == nil || status["machine_id"] == "" {
			t.Errorf("expected machine_id in response")
		}
		if status["can_rotate"] != true {
			t.Errorf("expected can_rotate=true in initial trial state")
		}
	})

	t.Run("POST /auto-switcher-pro/license/activate invalid key fails", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodPost,
			Path:   "/auto-switcher-pro/license/activate",
			Body:   []byte(`{"key":"invalid.key.structure"}`),
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		_ = json.Unmarshal(out, &env)
		var resp ManagementResponsePayload
		_ = json.Unmarshal(env.Result, &resp)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("expected 400 for bad key, got %d", resp.StatusCode)
		}
	})

	t.Run("GET /auto-switcher-pro/license/session provides hardware authorized handshake", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodGet,
			Path:   "/auto-switcher-pro/license/session",
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		_ = json.Unmarshal(out, &env)
		var resp ManagementResponsePayload
		_ = json.Unmarshal(env.Result, &resp)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200, got %d", resp.StatusCode)
		}

		bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
		var res map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &res)
		if res["authorized"] != true {
			t.Errorf("expected authorized=true for active/trial machine")
		}
		if res["machine_id"] == nil || res["machine_id"] == "" {
			t.Errorf("expected machine_id in session payload")
		}
		if res["management_key"] != nil {
			t.Errorf("expected management_key to be excluded by default for security, got %v", res["management_key"])
		}
	})

	t.Run("GET /auto-switcher-pro/license/session with opt-in handshake exposes key if configured", func(t *testing.T) {
		t.Setenv("AUTO_SWITCHER_ALLOW_LOCAL_HANDSHAKE", "true")
		t.Setenv("CLIPROXY_MANAGEMENT_KEY", "test-secret-management-key")

		req := ManagementRequestPayload{
			Method: http.MethodGet,
			Path:   "/auto-switcher-pro/license/session",
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		_ = json.Unmarshal(out, &env)
		var resp ManagementResponsePayload
		_ = json.Unmarshal(env.Result, &resp)

		bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
		var res map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &res)
		if res["management_key"] != "test-secret-management-key" {
			t.Errorf("expected test-secret-management-key, got %v", res["management_key"])
		}
	})

	t.Run("getLocalManagementKeyResolution explicit audit logging", func(t *testing.T) {
		t.Setenv("CLIPROXY_MANAGEMENT_KEY", "env-test-key-123")
		k, src, warn := getLocalManagementKeyResolution()
		if k != "env-test-key-123" {
			t.Errorf("expected env-test-key-123, got %s", k)
		}
		if src != "env:CLIPROXY_MANAGEMENT_KEY" {
			t.Errorf("expected env:CLIPROXY_MANAGEMENT_KEY, got %s", src)
		}
		if warn != "" {
			t.Errorf("expected empty warning on direct env match, got %s", warn)
		}
	})
}
