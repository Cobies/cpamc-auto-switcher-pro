package plugin

import (
	"encoding/json"
	"strings"
	"testing"
)

func testModelProviderRegistry(t *testing.T) *PoolRegistry {
	t.Helper()
	r := NewPoolRegistry(t.TempDir() + "/state.json")
	_ = r.SavePool(PoolDefinition{
		ID:         "pool-agy-1",
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: "antigravity-a@gmail.com.json",
		Reserves:   []string{"antigravity-b@gmail.com.json"},
		Policy: PoolPolicy{
			TargetModels: []string{"gemini-3-flash", "gemini-3.8-flash-high"},
		},
	})
	_ = r.SavePool(PoolDefinition{
		ID:         "pool-clau-1",
		Family:     "claude",
		BasePrefix: "clau",
		LeaderAuth: "antigravity-a@gmail.com.json",
		Reserves:   []string{"antigravity-b@gmail.com.json"},
		Policy: PoolPolicy{
			TargetModels: []string{"claude-sonnet-4-6", "claude-opus-5-5-high"},
		},
	})
	t.Cleanup(func() { _ = r.Clear() })
	return r
}

func modelIDs(models []pluginModelInfo) []string {
	ids := make([]string, 0, len(models))
	for _, m := range models {
		ids = append(ids, m.ID)
	}
	return ids
}

func TestModelCatalogForAuthWithoutPoolsReturnsBaseline(t *testing.T) {
	models := modelCatalogForAuth("", nil)
	ids := modelIDs(models)
	if len(ids) != len(baselineAntigravityModels) {
		t.Fatalf("baseline catalog size mismatch: got %d want %d", len(ids), len(baselineAntigravityModels))
	}
	found := false
	for _, id := range ids {
		if id == "gemini-3.8-flash-high" {
			found = true
		}
	}
	if !found {
		t.Fatalf("baseline catalog missing gemini-3.8-flash-high: %v", ids)
	}
}

func TestModelCatalogForAuthDiskBackedPoolServesBareTargets(t *testing.T) {
	// Auth prefixed "agy" (disk-backed member of the agy pool) serving two pools:
	// the gemini pool is disk-backed; the claude pool is registry-only (2N dual family).
	models := modelCatalogForAuth("agy", []PoolDefinition{
		{
			BasePrefix: "agy",
			LeaderAuth: "antigravity-a@gmail.com.json",
			Policy:     PoolPolicy{TargetModels: []string{"gemini-3-flash", "gemini-3.8-flash-high"}},
		},
		{
			BasePrefix: "clau",
			LeaderAuth: "antigravity-a@gmail.com.json",
			Policy:     PoolPolicy{TargetModels: []string{"claude-sonnet-4-6"}},
		},
	})
	ids := modelIDs(models)

	wantAll := []string{
		"gemini-3-flash",
		"gemini-3.8-flash-high",
		"claude-sonnet-4-6",
		"clau/claude-sonnet-4-6",
	}
	for _, want := range wantAll {
		found := false
		for _, id := range ids {
			if id == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("catalog missing %q: %v", want, ids)
		}
	}
}

func TestModelCatalogForAuthDeduplicatesAndSorts(t *testing.T) {
	models := modelCatalogForAuth("clau", []PoolDefinition{
		{
			BasePrefix: "clau",
			LeaderAuth: "antigravity-a@gmail.com.json",
			Policy:     PoolPolicy{TargetModels: []string{"claude-sonnet-4-6", "claude-sonnet-4-6"}},
		},
	})
	ids := modelIDs(models)
	for i := 1; i < len(ids); i++ {
		if ids[i-1] >= ids[i] {
			t.Fatalf("catalog not sorted/deduplicated: %v", ids)
		}
	}
}

func TestPoolPrefixedCatalogIncludesRoutesAndBaselineWithoutPools(t *testing.T) {
	r := NewPoolRegistry(t.TempDir() + "/empty.json")
	catalog := poolPrefixedCatalog(r)
	if len(catalog) != len(baselineAntigravityModels) {
		t.Fatalf("empty registry must return baseline, got %d models", len(catalog))
	}

	registry := testModelProviderRegistry(t)
	catalog = poolPrefixedCatalog(registry)
	ids := modelIDs(catalog)
	for _, want := range []string{"agy/gemini-3-flash", "clau/claude-sonnet-4-6"} {
		found := false
		for _, id := range ids {
			if id == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("static catalog missing %q: %v", want, ids)
		}
	}
}

func TestRouteDecisionForPoolTargets(t *testing.T) {
	registry := testModelProviderRegistry(t)

	resp := routeDecisionFor(registry, "clau/claude-sonnet-4-6")
	if !resp.Handled || resp.TargetKind != "provider" || resp.Target != "antigravity" || resp.TargetModel != "claude-sonnet-4-6" {
		t.Fatalf("unexpected route decision: %+v", resp)
	}
	if !strings.Contains(resp.Reason, "clau") {
		t.Fatalf("route reason should reference the pool: %+v", resp)
	}

	// Non-target model under a pool prefix must not be routed (native path keeps working).
	resp = routeDecisionFor(registry, "agy/gemini-3.8-flash-n")
	if resp.Handled {
		t.Fatalf("non-target model must not be routed: %+v", resp)
	}

	// Unknown prefix must not be routed.
	resp = routeDecisionFor(registry, "claude/claude-sonnet-4-6")
	if resp.Handled {
		t.Fatalf("foreign provider model must not be routed: %+v", resp)
	}
}

func TestPrefixMatchesPoolNumericReservesOnly(t *testing.T) {
	cases := []struct {
		prefix string
		base   string
		want   bool
	}{
		{"agy", "agy", true},
		{"agy_1", "agy", true},
		{"agy_12", "agy", true},
		{"agy_son", "agy", false},
		{"agy_clau", "agy", false},
		{"", "agy", false},
		{"agy", "", false},
	}
	for _, tc := range cases {
		if got := prefixMatchesPool(tc.prefix, tc.base); got != tc.want {
			t.Fatalf("prefixMatchesPool(%q, %q) = %v, want %v", tc.prefix, tc.base, got, tc.want)
		}
	}
}

func TestParseAuthDiskPrefix(t *testing.T) {
	if got := parseAuthDiskPrefix([]byte(`{"prefix":"agy_1","email":"a@x.com"}`)); got != "agy_1" {
		t.Fatalf("parseAuthDiskPrefix = %q, want agy_1", got)
	}
	if got := parseAuthDiskPrefix(nil); got != "" {
		t.Fatalf("empty storage must yield empty prefix, got %q", got)
	}
}

func TestHandleModelForAuthUsesRegistryMembership(t *testing.T) {
	registry := testModelProviderRegistry(t)

	// Swap the active registry resolver for an isolated test registry.
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	// Leader is a member of both pools; its storage prefix is agy (disk-backed gemini).
	resp := handleModelForAuth(modelForAuthRequest{
		AuthID:       "antigravity-a@gmail.com.json",
		AuthProvider: "antigravity",
		StorageJSON:  []byte(`{"prefix":"agy"}`),
	})
	if resp.Provider != "antigravity" {
		t.Fatalf("provider mismatch: %+v", resp)
	}
	ids := modelIDs(resp.Models)
	for _, want := range []string{"gemini-3-flash", "claude-sonnet-4-6", "clau/claude-sonnet-4-6"} {
		found := false
		for _, id := range ids {
			if id == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("for_auth catalog missing %q: %v", want, ids)
		}
	}

	// Unknown auth falls back to the baseline catalog.
	resp = handleModelForAuth(modelForAuthRequest{
		AuthID:       "antigravity-unknown@gmail.com.json",
		AuthProvider: "antigravity",
		StorageJSON:  []byte(`{"prefix":""}`),
	})
	if len(resp.Models) != len(baselineAntigravityModels) {
		t.Fatalf("unknown auth must receive baseline, got %v", modelIDs(resp.Models))
	}
}

func TestHandleModelStaticArmsProviderKey(t *testing.T) {
	registry := NewPoolRegistry(t.TempDir() + "/state.json")
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	resp := handleModelStatic()
	if resp.Provider != "antigravity" {
		t.Fatalf("static provider must stay armed, got %q", resp.Provider)
	}
	if len(resp.Models) == 0 {
		t.Fatal("static response must carry at least the baseline catalog")
	}
}

func TestModelRouteRequestDecodesPascalCaseWire(t *testing.T) {
	wire := `{"Plugin":{"Name":"Auto switcher pro"},"PluginID":"auto-switcher-pro-linux-amd64","SourceFormat":"openai","RequestedModel":"clau/claude-sonnet-4-6","Stream":false}`
	var req modelRouteRequest
	if err := json.Unmarshal([]byte(wire), &req); err != nil {
		t.Fatalf("decode wire request: %v", err)
	}
	if req.RequestedModel != "clau/claude-sonnet-4-6" {
		t.Fatalf("RequestedModel mismatch: %q", req.RequestedModel)
	}
}

func TestIsModelProviderMethod(t *testing.T) {
	for _, method := range []string{"model.static", "model.register", "model.for_auth", "model.route"} {
		if !isModelProviderMethod(method) {
			t.Fatalf("method %s must be recognized", method)
		}
	}
	if isModelProviderMethod("management.handle") {
		t.Fatal("management.handle is not a model provider method")
	}
}

func TestSchedulerPickCascadePrefersLeader(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "claude-sonnet-4-6",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "clau/claude-sonnet-4-6"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-b@gmail.com.json", Provider: "antigravity", Status: "active"},
			{ID: "antigravity-a@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	if !resp.Handled || resp.AuthID != "antigravity-a@gmail.com.json" {
		t.Fatalf("leader must be preferred: %+v", resp)
	}
}

func TestSchedulerPickCascadeFallsToFirstAvailableReserve(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	// Leader agotado (no está entre los candidatos disponibles)
	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "claude-sonnet-4-6",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "clau/claude-sonnet-4-6"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-b@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	if !resp.Handled || resp.AuthID != "antigravity-b@gmail.com.json" {
		t.Fatalf("first available reserve (cascade order) must be picked: %+v", resp)
	}
}

func TestSchedulerPickNonPoolModelDelegates(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	// Modelo sin prefijo de pool: sin requested_model de pool → builtin
	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "gemini-3-flash",
		Candidates: []schedulerCandidate{
			{ID: "antigravity-a@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	if resp.Handled {
		t.Fatalf("non-pool request must delegate to builtin: %+v", resp)
	}
}

func TestSchedulerPickUnknownPrefixDelegates(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "claude-sonnet-4-6",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "claude/claude-sonnet-4-6"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-a@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	if resp.Handled {
		t.Fatalf("foreign provider prefix must delegate: %+v", resp)
	}
}

func TestSchedulerPickRetriesSkipTriedMembers(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	// Tras fallar líder y primera reserva, solo queda la última: debe elegirse
	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "claude-sonnet-4-6",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "clau/claude-sonnet-4-6"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-b@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	if !resp.Handled || resp.AuthID != "antigravity-b@gmail.com.json" {
		t.Fatalf("last cascade member must be picked on retries: %+v", resp)
	}
}
