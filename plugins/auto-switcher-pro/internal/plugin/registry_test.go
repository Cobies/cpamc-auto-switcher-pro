package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPoolRegistry_Lifecycle(t *testing.T) {
	tempDir := t.TempDir()
	stateFile := filepath.Join(tempDir, "test-pools.json")

	reg := NewPoolRegistry(stateFile)

	// 1. Initial empty state
	if err := reg.Load(); err != nil {
		t.Fatalf("unexpected error loading empty state: %v", err)
	}
	pools := reg.ListPools()
	if len(pools) != 0 {
		t.Fatalf("expected 0 pools initially, got %d", len(pools))
	}

	// 2. Save pool
	pool1 := PoolDefinition{
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: "antigravity-master1.json",
		Reserves:   []string{"antigravity-master2.json", "antigravity-master3.json"},
		Policy: PoolPolicy{
			DisableIsolation: false,
			Exclude55:        false,
		},
	}
	if err := reg.SavePool(pool1); err != nil {
		t.Fatalf("failed to save pool1: %v", err)
	}

	// 3. Verify in memory
	saved, ok := reg.GetPool("agy")
	if !ok {
		t.Fatal("expected pool 'agy' to be found")
	}
	if saved.LeaderAuth != "antigravity-master1.json" {
		t.Errorf("expected leader antigravity-master1.json, got %s", saved.LeaderAuth)
	}
	if len(saved.Reserves) != 2 {
		t.Errorf("expected 2 reserves, got %d", len(saved.Reserves))
	}

	// 4. Persistence across reload
	reg2 := NewPoolRegistry(stateFile)
	if err := reg2.Load(); err != nil {
		t.Fatalf("failed to reload registry: %v", err)
	}
	reloaded, ok := reg2.GetPool("AGY") // Case-insensitive lookup
	if !ok {
		t.Fatal("expected case-insensitive lookup to find 'agy'")
	}
	if reloaded.BasePrefix != "agy" {
		t.Errorf("expected base_prefix 'agy', got %s", reloaded.BasePrefix)
	}

	// 5. Add second pool (Claude)
	pool2 := PoolDefinition{
		Family:     "gemini_sonnet",
		BasePrefix: "agy_son",
		LeaderAuth: "antigravity-master1.json",
		Reserves:   []string{"antigravity-master2.json"},
	}
	if err := reg.SavePool(pool2); err != nil {
		t.Fatalf("failed to save pool2: %v", err)
	}
	if len(reg.ListPools()) != 2 {
		t.Fatalf("expected 2 pools, got %d", len(reg.ListPools()))
	}

	// 6. Delete pool
	deleted, err := reg.DeletePool("agy")
	if err != nil {
		t.Fatalf("failed to delete pool: %v", err)
	}
	if !deleted {
		t.Fatal("expected delete to return true")
	}
	if _, ok := reg.GetPool("agy"); ok {
		t.Fatal("expected 'agy' to be deleted")
	}
	if len(reg.ListPools()) != 1 {
		t.Fatalf("expected 1 pool remaining, got %d", len(reg.ListPools()))
	}
}

func TestPoolRegistry_HTTPHandler(t *testing.T) {
	tempDir := t.TempDir()
	stateFile := filepath.Join(tempDir, "http-pools.json")
	t.Setenv("AUTO_SWITCHER_STATE_FILE", stateFile)

	// Reset default instance for test
	defaultRegistryInstance = NewPoolRegistry(stateFile)
	_ = defaultRegistryInstance.Load()

	// 1. GET /pools -> initially empty
	getReq := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   poolsRoutePath,
	}
	rawResp, err := handlePoolsHTTP(getReq)
	if err != nil {
		t.Fatalf("unexpected error on GET: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(rawResp, &env); err != nil {
		t.Fatalf("failed to unmarshal envelope: %v", err)
	}
	var mgmtResp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &mgmtResp); err != nil {
		t.Fatalf("failed to unmarshal mgmtResp: %v", err)
	}
	if mgmtResp.StatusCode != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d", mgmtResp.StatusCode)
	}
	decodedBody, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	var getResult struct {
		OK    bool             `json:"ok"`
		Pools []PoolDefinition `json:"pools"`
		Count int              `json:"count"`
	}
	_ = json.Unmarshal(decodedBody, &getResult)
	if getResult.Count != 0 {
		t.Fatalf("expected count 0, got %d", getResult.Count)
	}

	// 2. POST /pools -> create pool
	poolPayload := PoolDefinition{
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: "antigravity-m1.json",
		Reserves:   []string{"antigravity-m2.json"},
	}
	bodyBytes, _ := json.Marshal(poolPayload)
	postReq := ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   poolsRoutePath,
		Body:   bodyBytes,
	}
	rawPostResp, err := handlePoolsHTTP(postReq)
	if err != nil {
		t.Fatalf("failed POST: %v", err)
	}
	_ = json.Unmarshal(rawPostResp, &env)
	_ = json.Unmarshal(env.Result, &mgmtResp)
	if mgmtResp.StatusCode != http.StatusOK {
		t.Fatalf("expected HTTP 200 on POST, got %d", mgmtResp.StatusCode)
	}

	// 3. GET /pools -> verify count is now 1
	rawResp2, _ := handlePoolsHTTP(getReq)
	_ = json.Unmarshal(rawResp2, &env)
	_ = json.Unmarshal(env.Result, &mgmtResp)
	decodedBody2, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	_ = json.Unmarshal(decodedBody2, &getResult)
	if getResult.Count != 1 {
		t.Fatalf("expected count 1, got %d", getResult.Count)
	}

	// 4. DELETE /pools?prefix=agy -> dissolve
	delReq := ManagementRequestPayload{
		Method: http.MethodDelete,
		Path:   poolsRoutePath,
		Query:  map[string][]string{"prefix": {"agy"}},
	}
	rawDelResp, err := handlePoolsHTTP(delReq)
	if err != nil {
		t.Fatalf("failed DELETE: %v", err)
	}
	_ = json.Unmarshal(rawDelResp, &env)
	_ = json.Unmarshal(env.Result, &mgmtResp)
	if mgmtResp.StatusCode != http.StatusOK {
		t.Fatalf("expected HTTP 200 on DELETE, got %d", mgmtResp.StatusCode)
	}

	// 5. GET /pools -> back to 0
	rawResp3, _ := handlePoolsHTTP(getReq)
	_ = json.Unmarshal(rawResp3, &env)
	_ = json.Unmarshal(env.Result, &mgmtResp)
	decodedBody3, _ := base64.StdEncoding.DecodeString(mgmtResp.Body)
	_ = json.Unmarshal(decodedBody3, &getResult)
	if getResult.Count != 0 {
		t.Fatalf("expected count 0 after delete, got %d", getResult.Count)
	}
}

func TestPruneStaleAccountsAutoHealing(t *testing.T) {
	// 1. Create a temporary authDir with mock .json credential files
	authDir := t.TempDir()
	fLeader := filepath.Join(authDir, "antigravity-leader@gmail.com.json")
	fReserve1 := filepath.Join(authDir, "antigravity-res1@gmail.com.json")
	fReserve2 := filepath.Join(authDir, "antigravity-res2@gmail.com.json")

	_ = os.WriteFile(fLeader, []byte("{}"), 0644)
	_ = os.WriteFile(fReserve1, []byte("{}"), 0644)
	_ = os.WriteFile(fReserve2, []byte("{}"), 0644)

	regFile := filepath.Join(t.TempDir(), "state.json")
	reg := NewPoolRegistry(regFile)

	pool := PoolDefinition{
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: "antigravity-leader@gmail.com.json",
		Reserves:   []string{"antigravity-res1@gmail.com.json", "antigravity-res2@gmail.com.json"},
	}
	if err := reg.SavePool(pool); err != nil {
		t.Fatalf("SavePool failed: %v", err)
	}

	// Case 1: All files exist on disk -> Prune is no-op
	changed, err := reg.PruneStaleAccounts(authDir)
	if err != nil || changed {
		t.Fatalf("expected changed=false when all files exist, got changed=%v err=%v", changed, err)
	}

	// Case 2: Reserve 1 is deleted from disk -> Reserve 1 pruned, Reserve 2 kept
	_ = os.Remove(fReserve1)
	changed, err = reg.PruneStaleAccounts(authDir)
	if err != nil || !changed {
		t.Fatalf("expected changed=true when reserve removed, got changed=%v err=%v", changed, err)
	}
	p, ok := reg.GetPool("agy")
	if !ok || len(p.Reserves) != 1 || p.Reserves[0] != "antigravity-res2@gmail.com.json" {
		t.Fatalf("unexpected reserves after pruning: %+v", p.Reserves)
	}

	// Case 3: Leader is deleted from disk -> Reserve 2 promoted to leader
	_ = os.Remove(fLeader)
	changed, err = reg.PruneStaleAccounts(authDir)
	if err != nil || !changed {
		t.Fatalf("expected changed=true when leader removed, got changed=%v err=%v", changed, err)
	}
	p, ok = reg.GetPool("agy")
	if !ok || p.LeaderAuth != "antigravity-res2@gmail.com.json" || len(p.Reserves) != 0 {
		t.Fatalf("expected reserve2 promoted to leader: %+v", p)
	}

	// Case 4: Final account is deleted from disk -> pool automatically dissolved
	_ = os.Remove(fReserve2)
	changed, err = reg.PruneStaleAccounts(authDir)
	if err != nil || !changed {
		t.Fatalf("expected changed=true when all accounts removed, got changed=%v err=%v", changed, err)
	}
	_, ok = reg.GetPool("agy")
	if ok {
		t.Fatalf("expected pool to be dissolved when all accounts deleted")
	}
	if len(reg.ListPools()) != 0 {
		t.Fatalf("expected 0 pools in registry")
	}
}

func TestPoolRegistry_ContingencyPurgeVirtualPoolNames(t *testing.T) {
	tempDir := t.TempDir()
	stateFile := filepath.Join(tempDir, "contingency-pools.json")
	reg := NewPoolRegistry(stateFile)

	// Intento hostil / bug: Guardar un pool con nombres de pool en target_models y excluded_models
	hostilePool := PoolDefinition{
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: "antigravity-leader.json",
		Reserves:   []string{"antigravity-res.json"},
		Policy: PoolPolicy{
			TargetModels: []string{
				"gemini-3.8-flash-high",
				"Pool-01-gemini",
				"pool-02-claude",
			},
			ExcludedModels: []string{
				"gemini-3-flash",
				"Pool-01-gemini",
				"pool-99-special",
				"gemini-3.7-flash-high",
			},
		},
	}

	if err := reg.SavePool(hostilePool); err != nil {
		t.Fatalf("SavePool failed: %v", err)
	}

	// Verificar en memoria
	saved, ok := reg.GetPool("agy")
	if !ok {
		t.Fatal("expected pool 'agy' to be found")
	}

	// target_models no debe contener ningún pool-*
	if len(saved.Policy.TargetModels) != 1 || saved.Policy.TargetModels[0] != "gemini-3.8-flash-high" {
		t.Fatalf("expected target_models to only contain gemini-3.8-flash-high, got: %v", saved.Policy.TargetModels)
	}

	// excluded_models no debe contener ningún pool-*
	for _, ex := range saved.Policy.ExcludedModels {
		if strings.HasPrefix(strings.ToLower(ex), "pool-") {
			t.Fatalf("contingency failed: found contaminated pool name %q in excluded_models: %v", ex, saved.Policy.ExcludedModels)
		}
	}
	if len(saved.Policy.ExcludedModels) != 2 {
		t.Fatalf("expected exactly 2 excluded models, got %d: %v", len(saved.Policy.ExcludedModels), saved.Policy.ExcludedModels)
	}

	// Verificar en disco (persistencia real)
	reloaded := NewPoolRegistry(stateFile)
	if err := reloaded.Load(); err != nil {
		t.Fatalf("failed to reload registry: %v", err)
	}
	diskPool, _ := reloaded.GetPool("agy")
	for _, ex := range diskPool.Policy.ExcludedModels {
		if strings.HasPrefix(strings.ToLower(ex), "pool-") {
			t.Fatalf("persisted state contaminated with pool name %q: %v", ex, diskPool.Policy.ExcludedModels)
		}
	}
}

func TestPoolRegistry_RotatePoolLeader(t *testing.T) {
	tempDir := t.TempDir()
	stateFile := filepath.Join(tempDir, "rotate-pools.json")
	reg := NewPoolRegistry(stateFile)

	pool := PoolDefinition{
		Family:     "gemini_pure",
		BasePrefix: "agy",
		LeaderAuth: "antigravity-leader.json",
		Reserves:   []string{"antigravity-res1.json", "antigravity-res2.json"},
	}
	if err := reg.SavePool(pool); err != nil {
		t.Fatalf("SavePool failed: %v", err)
	}

	// 1. Rotate from leader -> res1
	updated, oldL, newL, err := reg.RotatePoolLeader("agy")
	if err != nil {
		t.Fatalf("RotatePoolLeader failed: %v", err)
	}
	if oldL != "antigravity-leader.json" || newL != "antigravity-res1.json" {
		t.Fatalf("expected rotation to res1, got old=%q, new=%q", oldL, newL)
	}
	if updated.ActiveLeader != "antigravity-res1.json" {
		t.Fatalf("expected updated ActiveLeader to be res1, got %q", updated.ActiveLeader)
	}

	// 2. Rotate from res1 -> res2
	updated, oldL, newL, err = reg.RotatePoolLeader("agy")
	if err != nil {
		t.Fatalf("RotatePoolLeader failed: %v", err)
	}
	if oldL != "antigravity-res1.json" || newL != "antigravity-res2.json" {
		t.Fatalf("expected rotation to res2, got old=%q, new=%q", oldL, newL)
	}

	// 3. Rotate from res2 -> leader (circular wrap)
	updated, oldL, newL, err = reg.RotatePoolLeader("agy")
	if err != nil {
		t.Fatalf("RotatePoolLeader failed: %v", err)
	}
	if oldL != "antigravity-res2.json" || newL != "antigravity-leader.json" {
		t.Fatalf("expected wrap rotation to leader, got old=%q, new=%q", oldL, newL)
	}

	// 4. HTTP POST /auto-switcher-pro/pools/rotate via DefaultRegistry
	defReg := DefaultRegistry()
	_ = defReg.SavePool(pool)
	rawResp, err := handlePoolsHTTP(ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/pools/rotate",
		Body:   []byte(`{"prefix":"agy"}`),
	})
	if err != nil {
		t.Fatalf("handlePoolsHTTP /rotate failed: %v", err)
	}
	var envelope struct {
		Result struct {
			Body string `json:"Body"`
		} `json:"result"`
	}
	_ = json.Unmarshal(rawResp, &envelope)
	bodyBytes := rawResp
	if envelope.Result.Body != "" {
		bodyBytes, _ = base64.StdEncoding.DecodeString(envelope.Result.Body)
	}

	var httpResp struct {
		OK        bool   `json:"ok"`
		Rotated   bool   `json:"rotated"`
		NewLeader string `json:"new_leader"`
	}
	if err := json.Unmarshal(bodyBytes, &httpResp); err != nil || !httpResp.OK || httpResp.NewLeader != "antigravity-res1.json" {
		t.Fatalf("unexpected HTTP rotate response: %s (raw: %s)", string(bodyBytes), string(rawResp))
	}

	// 5. Test routine agent turn with healthy leader (should NOT rotate to preserve prompt cache)
	rawRespRoutine, err := handlePoolsHTTP(ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/pools/rotate",
		Body:   []byte(`{"prefix":"agy","reason":"agent turn"}`),
	})
	if err != nil {
		t.Fatalf("handlePoolsHTTP /rotate (routine) failed: %v", err)
	}
	_ = json.Unmarshal(rawRespRoutine, &envelope)
	bodyBytesRoutine := rawRespRoutine
	if envelope.Result.Body != "" {
		bodyBytesRoutine, _ = base64.StdEncoding.DecodeString(envelope.Result.Body)
	}
	var httpRespRoutine struct {
		OK            bool   `json:"ok"`
		Rotated       bool   `json:"rotated"`
		CurrentLeader string `json:"current_leader"`
		Reason        string `json:"reason"`
	}
	if err := json.Unmarshal(bodyBytesRoutine, &httpRespRoutine); err != nil || !httpRespRoutine.OK || httpRespRoutine.Rotated || httpRespRoutine.Reason != "leader_healthy" {
		t.Fatalf("expected healthy leader skip, got: %s", string(bodyBytesRoutine))
	}

	// 6. Test forced rotation (force: true)
	rawRespForced, err := handlePoolsHTTP(ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/pools/rotate",
		Body:   []byte(`{"prefix":"agy","reason":"failover","force":true}`),
	})
	if err != nil {
		t.Fatalf("handlePoolsHTTP /rotate (forced) failed: %v", err)
	}
	_ = json.Unmarshal(rawRespForced, &envelope)
	bodyBytesForced := rawRespForced
	if envelope.Result.Body != "" {
		bodyBytesForced, _ = base64.StdEncoding.DecodeString(envelope.Result.Body)
	}
	var httpRespForced struct {
		OK        bool   `json:"ok"`
		Rotated   bool   `json:"rotated"`
		NewLeader string `json:"new_leader"`
	}
	if err := json.Unmarshal(bodyBytesForced, &httpRespForced); err != nil || !httpRespForced.OK || !httpRespForced.Rotated || httpRespForced.NewLeader != "antigravity-res2.json" {
		t.Fatalf("expected forced rotation to res2, got: %s", string(bodyBytesForced))
	}
}
