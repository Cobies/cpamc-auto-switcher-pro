package plugin

import (
	"auto-switcher-pro/internal/analytics"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAgentMatrixHandler_GET(t *testing.T) {
	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/v0/management/auto-switcher-pro/agent-matrix",
	}

	raw, err := handleAgentMatrixHTTP(req)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP failed: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("unmarshal envelope failed: %v", err)
	}

	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("unmarshal response payload failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got: %d", resp.StatusCode)
	}

	var data AgentMatrixPayload
	bodyBytes, err := base64.StdEncoding.DecodeString(resp.Body)
	if err != nil {
		t.Fatalf("decode base64 failed: %v", err)
	}
	if err := json.Unmarshal(bodyBytes, &data); err != nil {
		t.Fatalf("unmarshal body failed: %v", err)
	}

	if !data.OK {
		t.Errorf("expected OK=true")
	}
	if len(data.GentleAgents) == 0 {
		t.Errorf("expected GentleAgents to be populated")
	}
	if data.Jok3rDetected {
		if len(data.Jok3rAgents) == 0 {
			t.Errorf("expected Jok3rAgents to be populated when Jok3rDetected=true")
		}
	} else {
		if len(data.Jok3rAgents) != 0 {
			t.Errorf("expected Jok3rAgents to be empty when Jok3rDetected=false")
		}
	}

	// Verify Capability Matrix for Thinking
	if val, ok := data.PoolCapabilities["Pool-03-codex"]; ok && val {
		t.Errorf("expected Pool-03-codex to have supports_thinking=false, got true")
	}
	if val, ok := data.PoolCapabilities["Pool-04-claude"]; !ok || !val {
		t.Errorf("expected Pool-04-claude to have supports_thinking=true, got %v", val)
	}
}

func TestAgentMatrixHandler_POST(t *testing.T) {
	input := map[string]any{
		"agents": []AgentInfo{
			{
				Universe:      "jok3r_pi",
				AgentID:       "orchestrator",
				PrimaryPool:   "Pool-04-claude",
				FallbackPool:  "Pool-01-gemini",
				ThinkingLevel: "high",
				Concurrency:   1,
			},
			{
				Universe:      "gentle_ai",
				AgentID:       "gentle-ai-worker",
				RoleType:      "apply",
				PrimaryPool:   "Pool-03-codex",
				FallbackPool:  "Pool-02-gemini",
				ThinkingLevel: "high", // Should be sanitized to "none" because Codex does not support thinking
				Concurrency:   5,      // Should be sanitized to 1 for writer safety
			},
		},
	}
	body, _ := json.Marshal(input)

	req := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/agent-matrix",
		Body:   body,
	}

	raw, err := handleAgentMatrixHTTP(req)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP POST failed: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("unmarshal envelope failed: %v", err)
	}

	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("unmarshal response payload failed: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got: %d", resp.StatusCode)
	}

	// Verify persistence sanitized concurrency to 1 for worker
	records, err := analytics.GetAgentProfiles("gentle_ai")
	if err != nil {
		t.Fatalf("GetAgentProfiles failed: %v", err)
	}
	for _, r := range records {
		if r.AgentID == "gentle-ai-worker" {
			if r.Concurrency != 1 {
				t.Errorf("expected worker concurrency to be locked to 1, got %d", r.Concurrency)
			}
		}
	}
}

func TestAgentMatrixHandler_DynamicDiscoveryAndMtime(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot access home directory")
	}

	// 1. Create a dummy subagent markdown file in ~/.pi/agent-j0k3r/subagents/
	subDir := filepath.Join(home, ".pi", "agent-j0k3r", "subagents")
	_ = os.MkdirAll(subDir, 0755)
	dummyPath := filepath.Join(subDir, "security-dynamic-test.md")
	dummyContent := "# 🛡️ Security Dynamic Tester\nDescription: Agente dinámico para pruebas quirúrgicas de seguridad\n"
	if err := os.WriteFile(dummyPath, []byte(dummyContent), 0644); err != nil {
		t.Skip("cannot write dummy subagent")
	}
	defer os.Remove(dummyPath)

	// 2. Perform GET
	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/v0/management/auto-switcher-pro/agent-matrix",
	}
	raw, err := handleAgentMatrixHTTP(req)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP failed: %v", err)
	}

	var env Envelope
	_ = json.Unmarshal(raw, &env)
	var resp ManagementResponsePayload
	_ = json.Unmarshal(env.Result, &resp)
	var data AgentMatrixPayload
	bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
	_ = json.Unmarshal(bodyBytes, &data)

	// Check if security-dynamic-test was discovered dynamically
	found := false
	for _, a := range data.Jok3rAgents {
		if a.AgentID == "security-dynamic-test" {
			found = true
			if !strings.Contains(a.DisplayName, "Security Dynamic Tester") {
				t.Errorf("expected display name to include title, got %s", a.DisplayName)
			}
			break
		}
	}
	if !found {
		t.Errorf("expected dynamically created agent 'security-dynamic-test' to be discovered")
	}

	// 3. Test Mtime Invalidation: touch subagents.json externally with a custom profile
	jok3rPath := filepath.Join(home, ".pi", "agent-j0k3r", "subagents.json")
	if data, err := os.ReadFile(jok3rPath); err == nil {
		var parsed map[string]any
		if err := json.Unmarshal(data, &parsed); err == nil {
			profiles, ok := parsed["model_profiles"].(map[string]any)
			if !ok {
				profiles = make(map[string]any)
			}
			profiles["security-dynamic-test"] = map[string]any{
				"model":    "cpamc/Pool-04-claude",
				"fallback": "cpamc/Pool-01-gemini",
				"effort":   "high",
			}
			parsed["model_profiles"] = profiles
			out, _ := json.MarshalIndent(parsed, "", "  ")
			_ = os.WriteFile(jok3rPath, out, 0644)
			_ = os.Chtimes(jok3rPath, time.Now().Add(2*time.Second), time.Now().Add(2*time.Second))

			// Next GET should pick up external mtime change
			raw2, _ := handleAgentMatrixHTTP(req)
			var env2 Envelope
			_ = json.Unmarshal(raw2, &env2)
			var resp2 ManagementResponsePayload
			_ = json.Unmarshal(env2.Result, &resp2)
			var data2 AgentMatrixPayload
			bodyBytes2, _ := base64.StdEncoding.DecodeString(resp2.Body)
			_ = json.Unmarshal(bodyBytes2, &data2)

			for _, a := range data2.Jok3rAgents {
				if a.AgentID == "security-dynamic-test" {
					if a.PrimaryPool != "Pool-04-claude" {
						t.Errorf("expected reconciled PrimaryPool=Pool-04-claude from external mtime, got %s", a.PrimaryPool)
					}
					break
				}
			}
		}
	}

	// 4. Test Dry-Run / Ping Route
	pingReq := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/agent-matrix/ping",
		Body:   []byte(`{"pool_id":"Pool-04-claude","target_model":"claude-sonnet-4-6"}`),
	}
	rawPing, err := handleAgentMatrixHTTP(pingReq)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP ping failed: %v", err)
	}
	var envPing Envelope
	_ = json.Unmarshal(rawPing, &envPing)
	var respPing ManagementResponsePayload
	_ = json.Unmarshal(envPing.Result, &respPing)
	if respPing.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK for ping, got %d", respPing.StatusCode)
	}
	var pingRes PingResult
	pingBytes, _ := base64.StdEncoding.DecodeString(respPing.Body)
	_ = json.Unmarshal(pingBytes, &pingRes)
	// 5. Test Dynamic Detection Isolation (when j0k3r-pi is NOT detected)
	t.Setenv("FORCE_JOK3R_DETECTED", "false")
	rawUndetected, err := handleAgentMatrixHTTP(req)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP failed: %v", err)
	}
	var envUndetected Envelope
	_ = json.Unmarshal(rawUndetected, &envUndetected)
	var respUndetected ManagementResponsePayload
	_ = json.Unmarshal(envUndetected.Result, &respUndetected)
	var dataUndetected AgentMatrixPayload
	bodyBytesUndetected, _ := base64.StdEncoding.DecodeString(respUndetected.Body)
	_ = json.Unmarshal(bodyBytesUndetected, &dataUndetected)

	if dataUndetected.Jok3rDetected {
		t.Errorf("expected Jok3rDetected=false when FORCE_JOK3R_DETECTED=false")
	}
	if len(dataUndetected.Jok3rAgents) != 0 {
		t.Errorf("expected Jok3rAgents to be completely empty when not detected, got %d", len(dataUndetected.Jok3rAgents))
	}
	if len(dataUndetected.GentleAgents) == 0 {
		t.Errorf("expected GentleAgents to remain available as default universe")
	}

	// 7. Test Triage Shadow Warmup endpoint
	warmupReq := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/agent-matrix/warmup-triage",
		Body:   []byte(`{"target_pools":["Pool-01-gemini","Pool-04-claude"]}`),
	}
	rawWarmup, err := handleAgentMatrixHTTP(warmupReq)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP warmup-triage failed: %v", err)
	}
	var envWarmup Envelope
	_ = json.Unmarshal(rawWarmup, &envWarmup)
	var respWarmup ManagementResponsePayload
	_ = json.Unmarshal(envWarmup.Result, &respWarmup)
	if respWarmup.StatusCode != http.StatusOK {
		t.Errorf("expected 200 OK for warmup-triage, got %d", respWarmup.StatusCode)
	}
}

func TestAgentMatrix_RoleBasedPoolAllocation(t *testing.T) {
	// 1. In a Gemini-only multi-pool setup (e.g. Pool-02-gemini and Pool-03-gemini on production):
	geminiOnly := []string{"Pool-02-gemini", "Pool-03-gemini"}
	pWorker, fWorker := resolveBestPoolForRole("apply", "gentle-ai-worker", geminiOnly)
	pVerify, fVerify := resolveBestPoolForRole("verify", "gentle-ai-verify", geminiOnly)

	if pWorker == pVerify {
		t.Errorf("expected worker and verify to be distributed across distinct pools, but both got %s", pWorker)
	}
	if pWorker != "Pool-02-gemini" {
		t.Errorf("expected worker to receive Pool-02-gemini, got %s", pWorker)
	}
	if pVerify != "Pool-03-gemini" {
		t.Errorf("expected verify to receive Pool-03-gemini for quota isolation, got %s", pVerify)
	}
	if fWorker != "Pool-03-gemini" {
		t.Errorf("expected worker fallback to be Pool-03-gemini, got %s", fWorker)
	}
	if fVerify != "Pool-02-gemini" {
		t.Errorf("expected verify fallback to be Pool-02-gemini, got %s", fVerify)
	}

	// 2. In a multi-family setup (Claude + Gemini):
	multiFamily := []string{"Pool-01-gemini", "Pool-02-gemini", "Pool-04-claude"}
	pOrch, _ := resolveBestPoolForRole("orchestrator", "orchestrator", multiFamily)
	pExplore, _ := resolveBestPoolForRole("discovery", "gentle-ai-explore", multiFamily)
	pVer, _ := resolveBestPoolForRole("verify", "gentle-ai-verify", multiFamily)

	if pOrch != "Pool-04-claude" {
		t.Errorf("expected orchestrator to allocate Claude pool, got %s", pOrch)
	}
	if pExplore != "Pool-01-gemini" {
		t.Errorf("expected explore to allocate Gemini 1, got %s", pExplore)
	}
	if pVer != "Pool-02-gemini" {
		t.Errorf("expected verify to allocate Gemini 2, got %s", pVer)
	}
}

func TestAgentMatrix_RealPingDiagnostics(t *testing.T) {
	pingReq := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/agent-matrix/ping",
		Body:   []byte(`{"pool_id":"Pool-02-gemini","target_model":"gemini-3.8-flash-high"}`),
	}
	rawPing, err := handleAgentMatrixHTTP(pingReq)
	if err != nil {
		t.Fatalf("handleAgentMatrixHTTP ping failed: %v", err)
	}
	var env Envelope
	_ = json.Unmarshal(rawPing, &env)
	var resp ManagementResponsePayload
	_ = json.Unmarshal(env.Result, &resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}

	var res PingResult
	bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
	_ = json.Unmarshal(bodyBytes, &res)

	if !res.OK {
		t.Errorf("expected ping to be OK")
	}
	if res.LatencyMs <= 0 {
		t.Errorf("expected real latency > 0ms, got %d", res.LatencyMs)
	}
	if res.Model != "gemini-3.8-flash-high" {
		t.Errorf("expected model gemini-3.8-flash-high, got %s", res.Model)
	}
	if !strings.Contains(res.Message, "Ruta verificada") {
		t.Errorf("expected verification status message, got: %s", res.Message)
	}
}
