package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	raw, err := HandlePluginMethod("management.handle", []byte(`{"Method":"GET","Path":"/auto-switcher-pro/healthz"}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got: %s", string(raw))
	}

	// The health response is in env.Result as ManagementResponsePayload
	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal management response: %v", err)
	}

	// Decode base64 body
	bodyBytes, err := base64.StdEncoding.DecodeString(mgmtResp.Body)
	if err != nil {
		t.Fatalf("failed to decode base64 body: %v", err)
	}

	var status HealthStatus
	if err := json.Unmarshal(bodyBytes, &status); err != nil {
		t.Fatalf("failed to unmarshal health status: %v", err)
	}

	// Should have basic structure
	if status.Timestamp == "" {
		t.Error("expected timestamp in health status")
	}
	if status.LicenseStatus == "" {
		t.Error("expected license status")
	}
	// ActivePools may be 0 if no pools registered
	t.Logf("Health status: healthy=%v, license=%s, pools=%d, latency=%dms",
		status.Healthy, status.LicenseStatus, status.ActivePools, status.UpstreamLatency)
}

func TestReadyEndpoint(t *testing.T) {
	raw, err := HandlePluginMethod("management.handle", []byte(`{"Method":"GET","Path":"/auto-switcher-pro/readyz"}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got: %s", string(raw))
	}

	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal management response: %v", err)
	}

	bodyBytes, err := base64.StdEncoding.DecodeString(mgmtResp.Body)
	if err != nil {
		t.Fatalf("failed to decode base64 body: %v", err)
	}

	var status ReadyStatus
	if err := json.Unmarshal(bodyBytes, &status); err != nil {
		t.Fatalf("failed to unmarshal ready status: %v", err)
	}

	// Should have basic structure
	t.Logf("Ready status: ready=%v, reason=%s", status.Ready, status.Reason)
}

func TestHealthEndpoint_MethodNotAllowed(t *testing.T) {
	raw, err := HandlePluginMethod("management.handle", []byte(`{"Method":"POST","Path":"/auto-switcher-pro/healthz"}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope for POST, got: %s", string(raw))
	}

	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal management response: %v", err)
	}

	if mgmtResp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", mgmtResp.StatusCode)
	}

	bodyBytes, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	var errResp map[string]string
	json.Unmarshal(bodyBytes, &errResp)
	if errResp["error"] != "method_not_allowed" {
		t.Errorf("expected method_not_allowed error, got %s", errResp["error"])
	}
}

func TestSSEProxyEndpoint_ManagementHandle(t *testing.T) {
	// SSE proxy via management.handle should return error directing to direct route
	raw, err := HandlePluginMethod("management.handle", []byte(`{"Method":"GET","Path":"/auto-switcher-pro/sse-proxy/v1beta/models:streamGenerateContent"}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope for SSE proxy via management.handle, got: %s", string(raw))
	}

	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal management response: %v", err)
	}

	if mgmtResp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", mgmtResp.StatusCode)
	}

	bodyBytes, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	var errResp map[string]string
	if err := json.Unmarshal(bodyBytes, &errResp); err != nil {
		t.Logf("Error body: %s", string(bodyBytes))
	} else {
		if errResp["error"] != "use_direct_route" {
			t.Errorf("expected use_direct_route error, got %s", errResp["error"])
		}
	}
}