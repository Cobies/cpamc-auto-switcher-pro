package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"auto-switcher-pro/internal/analytics"
)

func TestHandleMetricsHTTP(t *testing.T) {
	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/v0/management/auto-switcher-pro/metrics?range=24h",
	}

	rawReq, _ := json.Marshal(req)
	out, err := HandleManagementHTTP(rawReq)
	if err != nil {
		t.Fatalf("HandleManagementHTTP returned error: %v", err)
	}

	var env Envelope
	_ = json.Unmarshal(out, &env)
	var resp ManagementResponsePayload
	_ = json.Unmarshal(env.Result, &resp)

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
	var snap map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &snap); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if snap["ok"] != true {
		t.Errorf("expected ok: true, got %v", snap["ok"])
	}
}

func TestEnrichMetricsWithRegistry(t *testing.T) {
	reg := &PoolRegistry{
		pools: map[string]PoolDefinition{
			"agy": {
				ID:           "Pool-01-gemini",
				BasePrefix:   "agy",
				Family:       "gemini_pure",
				ActiveLeader: "antigravity-leader@gmail.com.json",
				Members:      []string{"antigravity-leader@gmail.com.json", "antigravity-reserve@gmail.com.json"},
				Policy: PoolPolicy{
					TargetModels: []string{"gemini-3.8-flash-high"},
				},
			},
		},
	}

	snap := &analytics.MetricsSnapshot{
		OK:    true,
		Pools: []analytics.PoolStat{},
	}

	enrichMetricsWithRegistry(snap, reg)

	if len(snap.Pools) != 1 {
		t.Fatalf("expected 1 pool, got %d", len(snap.Pools))
	}
	if snap.Pools[0].PoolID != "Pool-01-gemini" {
		t.Errorf("expected pool ID 'Pool-01-gemini', got %q", snap.Pools[0].PoolID)
	}
	if snap.Pools[0].TargetModel != "gemini-3.8-flash-high" {
		t.Errorf("expected target model 'gemini-3.8-flash-high', got %q", snap.Pools[0].TargetModel)
	}
	if len(snap.Accounts) != 2 {
		t.Fatalf("expected 2 accounts from members, got %d", len(snap.Accounts))
	}
	if snap.Accounts[0].PoolID != "Pool-01-gemini" {
		t.Errorf("expected account PoolID 'Pool-01-gemini', got %q", snap.Accounts[0].PoolID)
	}
}
