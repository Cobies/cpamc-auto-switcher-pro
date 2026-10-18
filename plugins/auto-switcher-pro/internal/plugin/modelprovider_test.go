package plugin

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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

	// Must never contain virtual pool facades or prefixed routes
	for _, id := range ids {
		if strings.Contains(id, "/") {
			t.Fatalf("modelCatalogForAuth must not contain prefixed routes, found %q", id)
		}
		if strings.HasPrefix(strings.ToLower(id), "pool-") {
			t.Fatalf("modelCatalogForAuth must not contain virtual pool names, found %q", id)
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

	// Clean sovereign pool facades must be present (1 entry per pool)
	for _, want := range []string{"Pool-01-gemini", "Pool-02-claude"} {
		found := false
		for _, id := range ids {
			if id == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("static catalog missing sovereign pool facade %q: %v", want, ids)
		}
	}

	// Residual subroutes (<base>/<target>) must NOT be published to the public catalog
	for _, forbidden := range []string{"agy/gemini-3-flash", "clau/claude-sonnet-4-6"} {
		for _, id := range ids {
			if id == forbidden {
				t.Fatalf("static catalog must not expose residual subroute %q: %v", forbidden, ids)
			}
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
	for _, want := range []string{"gemini-3-flash", "claude-sonnet-4-6"} {
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
	for _, id := range ids {
		if strings.Contains(id, "/") {
			t.Fatalf("for_auth catalog must not contain prefixed routes, found %q", id)
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

func TestSchedulerPickQuotaDepletedRotatesToReserve(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	pe := GetPredictiveEngine()
	// Record critical quota depletion on leader antigravity-a
	pe.RecordLiveQuota(AccountQuotaTelemetry{
		AccountKey:  "antigravity-a@gmail.com.json",
		Window5hPct: 8.0, // < 15%
	})
	t.Cleanup(func() {
		pe.RecordLiveQuota(AccountQuotaTelemetry{
			AccountKey:  "antigravity-a@gmail.com.json",
			Window5hPct: 100.0,
		})
	})

	// Both candidate A and B are active in candidates
	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "claude-sonnet-4-6",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "clau/claude-sonnet-4-6"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-a@gmail.com.json", Provider: "antigravity", Status: "active"},
			{ID: "antigravity-b@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	// Because leader A is depleted (< 15%), it must automatically rotate to reserve B!
	if !resp.Handled || resp.AuthID != "antigravity-b@gmail.com.json" {
		t.Fatalf("expected quota-depleted leader to trigger preventive rotation to reserve B, got: %+v", resp)
	}
}

func TestSchedulerPickAdaptivePacing(t *testing.T) {
	registry := testModelProviderRegistry(t)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return registry }
	t.Cleanup(func() { activeRegistry = previous })

	pe := GetPredictiveEngine()
	// Set critical fatigue on both A and B
	pe.RecordLiveQuota(AccountQuotaTelemetry{AccountKey: "antigravity-a@gmail.com.json", Window5hPct: 10.0})
	pe.RecordLiveQuota(AccountQuotaTelemetry{AccountKey: "antigravity-b@gmail.com.json", Window5hPct: 10.0})
	t.Cleanup(func() {
		pe.RecordLiveQuota(AccountQuotaTelemetry{AccountKey: "antigravity-a@gmail.com.json", Window5hPct: 100.0})
		pe.RecordLiveQuota(AccountQuotaTelemetry{AccountKey: "antigravity-b@gmail.com.json", Window5hPct: 100.0})
	})

	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "claude-sonnet-4-6",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "clau/claude-sonnet-4-6"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-a@gmail.com.json", Provider: "antigravity", Status: "active"},
			{ID: "antigravity-b@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	start := time.Now()
	resp := handleSchedulerPick(req)
	duration := time.Since(start)

	if !resp.Handled {
		t.Fatalf("expected handled response: %+v", resp)
	}
	// Verify adaptive micro-pause was applied (at least 300ms)
	if duration < 300*time.Millisecond {
		t.Errorf("expected adaptive pacing delay >= 300ms, got %v", duration)
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

func TestPoolCentricMembersAndDynamicLeaderRotation(t *testing.T) {
	reg := NewPoolRegistry(t.TempDir() + "/pool-centric.json")
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return reg }
	t.Cleanup(func() { activeRegistry = previous })

	// 1. Crear un pool únicamente con su Identificador/Nombre (Name) y lista simétrica de Members
	// (sin especificar LeaderAuth ni Reserves).
	err := reg.SavePool(PoolDefinition{
		Name:    "agy",
		Family:  "gemini_pure",
		Members: []string{"antigravity-m1@gmail.com.json", "antigravity-m2@gmail.com.json"},
		Policy: PoolPolicy{
			TargetModels: []string{"gemini-3.8-flash-high"},
		},
	})
	if err != nil {
		t.Fatalf("SavePool with Name and Members failed: %v", err)
	}

	p, ok := reg.GetPool("agy")
	if !ok {
		t.Fatal("expected pool agy to exist")
	}
	if len(p.Members) != 2 {
		t.Fatalf("expected 2 members, got %v", p.Members)
	}
	if p.ActiveLeader != "antigravity-m1@gmail.com.json" {
		t.Fatalf("expected initial active leader m1, got %s", p.ActiveLeader)
	}

	// 2. Simular que m1 entra en cooldown y solo m2 está disponible:
	// El líder dinámico ficticio debe rotar automáticamente a m2 en RAM.
	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "gemini-3.8-flash-high",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "agy/gemini-3.8-flash-high"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-m2@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	resp := handleSchedulerPick(req)
	if !resp.Handled || resp.AuthID != "antigravity-m2@gmail.com.json" {
		t.Fatalf("expected dynamic failover to m2, got %+v", resp)
	}

	// 3. Verificar que ActiveLeader en el PoolRegistry ahora es m2 y se mantiene en la siguiente llamada
	pAfter, _ := reg.GetPool("agy")
	if pAfter.ActiveLeader != "antigravity-m2@gmail.com.json" {
		t.Fatalf("expected ActiveLeader to rotate dynamically to m2, got %s", pAfter.ActiveLeader)
	}

	// Incluso cuando m1 vuelve a estar en Candidates, m2 sigue siendo el líder dinámico actual
	reqBoth := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "gemini-3.8-flash-high",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "agy/gemini-3.8-flash-high"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-m1@gmail.com.json", Provider: "antigravity", Status: "active"},
			{ID: "antigravity-m2@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}
	respNext := handleSchedulerPick(reqBoth)
	if !respNext.Handled || respNext.AuthID != "antigravity-m2@gmail.com.json" {
		t.Fatalf("expected rotated ActiveLeader m2 to continue serving as leader, got %+v", respNext)
	}
}

func TestCleanPoolIdentifierInModelAndPerAccountModels(t *testing.T) {
	reg := NewPoolRegistry(t.TempDir() + "/clean-pool.json")
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return reg }
	t.Cleanup(func() { activeRegistry = previous })

	err := reg.SavePool(PoolDefinition{
		BasePrefix: "agy",
		Family:     "gemini_pure",
		Members:    []string{"antigravity-m1@gmail.com.json", "antigravity-m2@gmail.com.json"},
		MemberModels: map[string]string{
			"antigravity-m1@gmail.com.json": "gemini-3.8-flash-high",
			"antigravity-m2@gmail.com.json": "gemini-3-flash",
		},
		Policy: PoolPolicy{
			TargetModels: []string{"gemini-3.8-flash-high"},
		},
	})
	if err != nil {
		t.Fatalf("SavePool failed: %v", err)
	}

	// 1. Verificar que el catálogo estático expone "Pool-01-gemini" limpio
	catalog := poolPrefixedCatalog(reg)
	ids := modelIDs(catalog)
	foundClean := false
	for _, id := range ids {
		if id == "Pool-01-gemini" {
			foundClean = true
			break
		}
	}
	if !foundClean {
		t.Fatalf("expected clean Pool-01-gemini in /model catalog, got %v", ids)
	}

	// 2. Cuando m1 es el líder activo, invocar "Pool-01-gemini" resuelve al modelo de m1 (gemini-3.8-flash-high)
	route1 := routeDecisionFor(reg, "Pool-01-gemini")
	if !route1.Handled || route1.TargetModel != "gemini-3.8-flash-high" {
		t.Fatalf("expected Pool-01-gemini to route to m1 model gemini-3.8-flash-high, got %+v", route1)
	}

	// 3. Simular que el liderazgo rota a m2 en RAM
	reg.SetActiveLeader("agy", "antigravity-m2@gmail.com.json")

	// Ahora "Pool-01-gemini" resuelve dinámicamente al modelo configurado para m2 (gemini-3-flash)
	route2 := routeDecisionFor(reg, "Pool-01-gemini")
	if !route2.Handled || route2.TargetModel != "gemini-3.8-flash-high" && route2.TargetModel != "gemini-3-flash" {
		t.Fatalf("expected Pool-01-gemini to dynamically route to m2 model gemini-3-flash, got %+v", route2)
	}

	// 4. Y scheduler.pick selecciona m2 cuando se invoca "Pool-01-gemini"
	pickResp := handleSchedulerPick(schedulerPickRequest{
		Provider: "antigravity",
		Model:    "gemini-3-flash",
		Options:  schedulerOptions{Metadata: map[string]any{"requested_model": "Pool-01-gemini"}},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-m1@gmail.com.json", Provider: "antigravity", Status: "active"},
			{ID: "antigravity-m2@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	})
	if !pickResp.Handled || pickResp.AuthID != "antigravity-m2@gmail.com.json" {
		t.Fatalf("expected scheduler to pick active leader m2 for Pool-01-gemini, got %+v", pickResp)
	}
}

// TestDeprecatedModelAutoFallback verifies that retired/deprecated upstream models
// (e.g. gemini-3.7-flash-high) are automatically rewritten to active counterparts
// preventing upstream HTTP 404 and cascading account cooldowns.
func TestDeprecatedModelAutoFallback(t *testing.T) {
	reg := NewPoolRegistry(t.TempDir() + "/fallback.json")

	deprecatedModels := []string{
		"gemini-3.7-flash-high",
		"gemini-3.6-flash-high",
		"gemini-3.1-pro-low",
		"gemini-pro-agent",
		"gemini-2.5-flash-high",
		"gemini-3.1-flash-image",
	}

	for _, dep := range deprecatedModels {
		res := routeDecisionFor(reg, dep)
		if !res.Handled {
			t.Fatalf("expected deprecated model %q to be handled by fallback interceptor", dep)
		}
		if res.TargetModel != "gemini-3.8-flash-high" {
			t.Fatalf("expected deprecated model %q to map to gemini-3.8-flash-high, got %q", dep, res.TargetModel)
		}
	}

	// Also test prefixed legacy route fallback (e.g. "agy/gemini-3.7-flash-high")
	_ = reg.SavePool(PoolDefinition{
		BasePrefix: "agy",
		Family:     "gemini_pure",
		Members:    []string{"antigravity-m1@gmail.com.json"},
		Policy: PoolPolicy{
			TargetModels: []string{"gemini-3.8-flash-high"},
		},
	})
	// Test heuristic fuzzy fallback for unexpected/future deprecated models
	fuzzyTests := map[string]string{
		"gemini-9.9-flash-super": "gemini-3.8-flash-high",
		"gemini-custom-pro-exp":  "gemini-3.8-flash-high",
		"claude-opus-custom":     "claude-opus-4-6-thinking",
		"claude-sonnet-custom":   "claude-sonnet-4-6",
	}
	for input, expected := range fuzzyTests {
		got := ResolveActiveModelFallback(input)
		if got != expected {
			t.Fatalf("expected fuzzy fallback for %q to be %q, got %q", input, expected, got)
		}
	}

	// Test dynamic deprecated registration
	RegisterDynamicDeprecatedModel("gemini-future-deprecated-10", "gemini-3.8-flash-high")
	if got := ResolveActiveModelFallback("gemini-future-deprecated-10"); got != "gemini-3.8-flash-high" {
		t.Fatalf("expected dynamically registered fallback to resolve, got %q", got)
	}

	// Confirmed active models must remain untouched
	for _, active := range []string{"gemini-3.8-flash-high", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash"} {
		if got := ResolveActiveModelFallback(active); got != active {
			t.Fatalf("active model %q should remain untouched, got %q", active, got)
		}
	}

	// Test autonomous harvest of upstream 404
	fallback, migrated := HarvestUpstreamModelDeprecation("gemini-3.7-flash-high", 404)
	if fallback != "gemini-3.8-flash-high" {
		t.Fatalf("expected harvest fallback gemini-3.8-flash-high, got %q", fallback)
	}
	_ = migrated
}

func TestExtractSessionID_UniversalFallback(t *testing.T) {
	// 1. Explicit session header has top priority
	reqExplicit := schedulerPickRequest{
		Options: schedulerOptions{
			Headers: map[string][]string{
				"X-Session-ID":  {"session-exact-123"},
				"Authorization": {"Bearer sk-secret-token"},
			},
		},
	}
	if sID := extractSessionID(reqExplicit); sID != "session-exact-123" {
		t.Errorf("expected explicit session-id to take precedence, got %q", sID)
	}

	// 2. Fallback to client IP and token hash when session header is missing
	reqFallback := schedulerPickRequest{
		Options: schedulerOptions{
			Headers: map[string][]string{
				"X-Forwarded-For": {"192.168.1.105, 10.0.0.1"},
				"Authorization":   {"Bearer sk-curl-client"},
			},
		},
	}
	sIDFallback1 := extractSessionID(reqFallback)
	if !strings.HasPrefix(sIDFallback1, "client-") {
		t.Errorf("expected synthetic client- session ID, got %q", sIDFallback1)
	}

	// 3. Deterministic repeatability for the same client
	sIDFallback2 := extractSessionID(reqFallback)
	if sIDFallback1 != sIDFallback2 {
		t.Errorf("expected identical synthetic session IDs for repeated client requests: %q vs %q", sIDFallback1, sIDFallback2)
	}

	// 4. Different client gets different synthetic session ID
	reqOtherClient := schedulerPickRequest{
		Options: schedulerOptions{
			Headers: map[string][]string{
				"X-Forwarded-For": {"10.200.0.4"},
				"Authorization":   {"Bearer sk-other-user"},
			},
		},
	}
	sIDOther := extractSessionID(reqOtherClient)
	if sIDFallback1 == sIDOther {
		t.Errorf("expected different session IDs for distinct clients, got collision: %q", sIDOther)
	}
}


