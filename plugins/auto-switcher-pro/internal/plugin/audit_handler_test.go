package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"auto-switcher-pro/internal/analytics"
)

func TestTelemetryTraceHTTP_ExportEndpoint(t *testing.T) {
	tempDB := filepath.Join(t.TempDir(), "trace_http_test.db")
	_, err := analytics.ResetDBForTest(tempDB)
	if err != nil {
		t.Fatalf("failed to reset db: %v", err)
	}
	defer func() {
		_, _ = analytics.ResetDBForTest("")
	}()

	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/auto-switcher-pro/telemetry/export-trace",
	}
	rawReq, _ := json.Marshal(req)
	rawResp, err := HandleManagementHTTP(rawReq)
	if err != nil {
		t.Fatalf("HandleManagementHTTP failed: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(rawResp, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope: %s", string(rawResp))
	}

	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal management response: %v", err)
	}

	if mgmtResp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", mgmtResp.StatusCode)
	}

	bodyBytes, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	var trace analytics.TelemetryTrace
	if err := json.Unmarshal(bodyBytes, &trace); err != nil {
		t.Fatalf("failed to unmarshal trace: %v", err)
	}

	if trace.Version != "1.0.0" {
		t.Errorf("expected version 1.0.0, got %s", trace.Version)
	}
}

func TestIncidentsHTTP_PostAndGet(t *testing.T) {
	tempDB := filepath.Join(t.TempDir(), "incidents_http_test.db")
	_, err := analytics.ResetDBForTest(tempDB)
	if err != nil {
		t.Fatalf("failed to reset db: %v", err)
	}
	defer func() {
		_, _ = analytics.ResetDBForTest("")
	}()

	incPayload := map[string]any{
		"id":              "inc_http_123",
		"incident_type":   "STEP_BUDGET_EXCEEDED",
		"session_id":      "sess_test",
		"pool_id":         "Pool-01-gemini",
		"tokens_saved":    48000,
		"actions_blocked": 15,
		"command_trace":   []string{"cat a", "cat b"},
	}
	bodyBytes, _ := json.Marshal(incPayload)

	// 1. POST /auto-switcher-pro/incidents
	postReq := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/auto-switcher-pro/incidents",
		Body:   bodyBytes,
	}
	rawPost, _ := json.Marshal(postReq)
	rawResp, err := HandleManagementHTTP(rawPost)
	if err != nil {
		t.Fatalf("HandleManagementHTTP POST failed: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(rawResp, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope: %s", string(rawResp))
	}

	// 2. GET /auto-switcher-pro/incidents?id=inc_http_123
	getReq := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/auto-switcher-pro/incidents",
		Query:  map[string][]string{"id": {"inc_http_123"}},
	}
	rawGet, _ := json.Marshal(getReq)
	rawRespGet, err := HandleManagementHTTP(rawGet)
	if err != nil {
		t.Fatalf("HandleManagementHTTP GET failed: %v", err)
	}
	var envGet Envelope
	if err := json.Unmarshal(rawRespGet, &envGet); err != nil || !envGet.OK {
		t.Fatalf("expected OK envelope on GET: %s", string(rawRespGet))
	}

	var mgmtResp ManagementResponsePayload
	_ = json.Unmarshal(envGet.Result, &mgmtResp)
	respBody, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	var getResult struct {
		OK       bool                    `json:"ok"`
		Incident analytics.GuardIncident `json:"incident"`
	}
	if err := json.Unmarshal(respBody, &getResult); err != nil {
		t.Fatalf("failed to decode json body: %v", err)
	}
	if !getResult.OK || getResult.Incident.ID != "inc_http_123" {
		t.Errorf("expected incident inc_http_123, got %+v", getResult.Incident)
	}
}
