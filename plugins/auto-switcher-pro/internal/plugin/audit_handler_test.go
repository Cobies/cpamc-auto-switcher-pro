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
