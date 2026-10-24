package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestSelfHealingReport_GenerationAndEndpoint(t *testing.T) {
	// 1. Probar generación directa
	report := GenerateSelfHealingReport()
	if report.Timestamp == "" {
		t.Error("expected non-empty timestamp")
	}
	if !strings.Contains(report.CryptographicRing, "V2") {
		t.Errorf("expected V2 in cryptographic ring, got %s", report.CryptographicRing)
	}
	if !strings.Contains(report.PromptCacheAffinity, "RAM") {
		t.Errorf("expected RAM isolation in prompt cache affinity, got %s", report.PromptCacheAffinity)
	}
	if !strings.Contains(report.IntegritySummary, "Ring V2 activo") {
		t.Errorf("expected Ring V2 activo in summary, got %s", report.IntegritySummary)
	}

	// 2. Probar endpoint /auto-switcher-pro/self-healing
	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/auto-switcher-pro/self-healing",
	}
	rawReq, _ := json.Marshal(req)
	rawResp, err := HandleManagementHTTP(rawReq)
	if err != nil {
		t.Fatalf("unexpected error calling self-healing endpoint: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(rawResp, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got: %s", string(rawResp))
	}

	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal management response: %v", err)
	}

	if mgmtResp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", mgmtResp.StatusCode)
	}

	bodyBytes, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	var endpointReport SelfHealingReport
	if err := json.Unmarshal(bodyBytes, &endpointReport); err != nil {
		t.Fatalf("failed to unmarshal self-healing report from body: %v", err)
	}

	if endpointReport.IntegritySummary != report.IntegritySummary {
		t.Errorf("expected matching summaries, got %s vs %s", endpointReport.IntegritySummary, report.IntegritySummary)
	}
}
