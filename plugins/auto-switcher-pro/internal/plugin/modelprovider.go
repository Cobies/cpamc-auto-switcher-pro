package plugin

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"auto-switcher-pro/internal/analytics"
	"auto-switcher-pro/internal/license"
	"auto-switcher-pro/internal/version"
)

var totalRotations int64
var totalFailovers int64

func init() {
	license.SetTelemetryProvider(func() license.TelemetryInfo {
		var prefixes []string
		if activeRegistry != nil {
			if reg := activeRegistry(); reg != nil {
				pools := reg.ListPools()
				prefixes = make([]string, 0, len(pools))
				for _, p := range pools {
					prefixes = append(prefixes, p.BasePrefix)
				}
			}
		}
		persistedReqs, persistedFailovers := license.GetPersistedUsage()
		curReqs := atomic.LoadInt64(&totalRotations)
		if curReqs < persistedReqs {
			curReqs = persistedReqs
		}
		curFail := atomic.LoadInt64(&totalFailovers)
		if curFail < persistedFailovers {
			curFail = persistedFailovers
		}
		return license.TelemetryInfo{
			Version:        version.Version,
			Rotations:      curReqs,
			TotalFailovers: curFail,
			ActivePools:    prefixes,
		}
	})
}

// Plugin-side RPC methods exposed by the CLIProxyAPI plugin host for the
// model_provider, model_router and scheduler capabilities (sdk/pluginabi names).
const (
	methodModelStatic   = "model.static"
	methodModelRegister = "model.register"
	methodModelForAuth  = "model.for_auth"
	methodModelRoute    = "model.route"
	methodSchedulerPick = "scheduler.pick"
)

// antigravityProviderKey is the built-in provider key that owns the physical
// Antigravity OAuth credentials. The plugin registers its virtual pool models
// under this provider so the host resolves and schedules them natively.
const antigravityProviderKey = "antigravity"

// poolPrefixTargetPattern matches the reserve numbering convention of a pool
// base prefix (e.g. "clau_1" for base "clau"). Alphabetic suffixes belong to
// sibling pools, never to this one.
var poolReserveNumberPattern = regexp.MustCompile(`_\d+$`)

// Wire payloads. The CLIProxyAPI host marshals SDK request structs without json
// tags (Go field names, PascalCase) and decodes plugin responses into the same
// structs case-insensitively, so responses also use Go field names.

type modelStaticRequest struct {
	Plugin map[string]any `json:"Plugin"`
	Host   map[string]any `json:"Host"`
}

type modelForAuthRequest struct {
	Plugin       map[string]any    `json:"Plugin"`
	AuthID       string            `json:"AuthID"`
	AuthProvider string            `json:"AuthProvider"`
	StorageJSON  []byte            `json:"StorageJSON"`
	Metadata     map[string]any    `json:"Metadata"`
	Attributes   map[string]string `json:"Attributes"`
}

type modelRouteRequest struct {
	Plugin         map[string]any      `json:"Plugin"`
	PluginID       string              `json:"PluginID"`
	SourceFormat   string              `json:"SourceFormat"`
	RequestedModel string              `json:"RequestedModel"`
	Stream         bool                `json:"Stream"`
	Metadata       map[string]any      `json:"Metadata"`
	Headers        map[string][]string `json:"Headers"`
}

// pluginModelInfo mirrors sdk/pluginapi.ModelInfo (untagged fields). Only the
// identity fields the host registry consumes are populated.
type pluginModelInfo struct {
	ID          string `json:"ID"`
	Object      string `json:"Object"`
	Created     int64  `json:"Created"`
	OwnedBy     string `json:"OwnedBy"`
	DisplayName string `json:"DisplayName"`
}

type modelResponse struct {
	Provider string            `json:"Provider"`
	Models   []pluginModelInfo `json:"Models"`
}

type modelRouteResponse struct {
	Handled     bool   `json:"Handled"`
	TargetKind  string `json:"TargetKind"`
	Target      string `json:"Target,omitempty"`
	TargetModel string `json:"TargetModel,omitempty"`
	Reason      string `json:"Reason,omitempty"`
}

// schedulerPickRequest mirrors sdk/pluginapi.SchedulerPickRequest. Candidates
// arrive already filtered by availability (cooldowns excluded) and model support.
type schedulerPickRequest struct {
	Plugin     map[string]any       `json:"Plugin"`
	Provider   string               `json:"Provider"`
	Providers  []string             `json:"Providers"`
	Model      string               `json:"Model"`
	Stream     bool                 `json:"Stream"`
	Options    schedulerOptions     `json:"Options"`
	Candidates []schedulerCandidate `json:"Candidates"`
}

type schedulerOptions struct {
	Headers  map[string][]string `json:"Headers"`
	Metadata map[string]any      `json:"Metadata"`
}

type schedulerCandidate struct {
	ID         string            `json:"ID"`
	Provider   string            `json:"Provider"`
	Priority   int               `json:"Priority"`
	Status     string            `json:"Status"`
	Attributes map[string]string `json:"Attributes"`
}

// schedulerPickResponse mirrors sdk/pluginapi.SchedulerPickResponse (the SDK
// decodes both PascalCase and snake_case field names).
type schedulerPickResponse struct {
	AuthID          string `json:"AuthID,omitempty"`
	DelegateBuiltin string `json:"DelegateBuiltin,omitempty"`
	Handled         bool   `json:"Handled"`
	Reject          bool   `json:"Reject,omitempty"`
	RejectReason    string `json:"RejectReason,omitempty"`
	RejectCode      string `json:"RejectCode,omitempty"`
}

// activeRegistry returns the pool registry used by the model provider handlers.
// Overridable in tests to isolate fixture state from the process singleton.
var activeRegistry = func() *PoolRegistry { return DefaultRegistry() }

// baselineAntigravityModels is the standard Antigravity catalog published
// natively for credentials without pool membership. It keeps free accounts
// serving their native family while the plugin owns the provider catalog.
// Only confirmed active models supported upstream are listed here.
var baselineAntigravityModels = []pluginModelInfo{
	{ID: "gemini-3.8-flash-high", Object: "model", OwnedBy: antigravityProviderKey, DisplayName: "Gemini 3.8 Flash High"},
	{ID: "gemini-3.5-flash-lite", Object: "model", OwnedBy: antigravityProviderKey, DisplayName: "Gemini 3.5 Flash Lite"},
	{ID: "gemini-3.1-flash-lite", Object: "model", OwnedBy: antigravityProviderKey, DisplayName: "Gemini 3.1 Flash Lite"},
	{ID: "gemini-3-flash", Object: "model", OwnedBy: antigravityProviderKey, DisplayName: "Gemini 3 Flash"},
}

// deprecatedModelFallbacks maps retired or discontinued upstream model names
// to their current valid active counterpart in the same family.
// This prevents upstream HTTP 404s and 12-hour cascading cooldowns across all accounts.
var deprecatedModelFallbacks = map[string]string{
	"gemini-3.7-flash-high":  "gemini-3.8-flash-high",
	"gemini-3.6-flash-high":  "gemini-3.8-flash-high",
	"gemini-3.1-pro-low":     "gemini-3.8-flash-high",
	"gemini-pro-agent":       "gemini-3.8-flash-high",
	"gemini-2.5-flash-high":  "gemini-3.8-flash-high",
	"gemini-3.1-flash-image": "gemini-3.8-flash-high",
}

// dynamicDeprecatedCache holds runtime-learned model fallbacks in memory.
var dynamicDeprecatedCache sync.Map

// isConfirmedActiveModel reports whether the given model is in the active baseline.
func isConfirmedActiveModel(id string) bool {
	idLower := strings.ToLower(strings.TrimSpace(id))
	for _, m := range baselineAntigravityModels {
		if strings.EqualFold(m.ID, idLower) {
			return true
		}
	}
	if idLower == "gemini-3.8-flash-n" || idLower == "claude-sonnet-4-6" || idLower == "claude-opus-4-6-thinking" {
		return true
	}
	return false
}

// fuzzyFamilyFallback intelligently maps an unknown or newly retired model name
// to the best active canonical counterpart within the same family and tier.
func fuzzyFamilyFallback(model string) string {
	lower := strings.ToLower(strings.TrimSpace(model))
	if lower == "" {
		return ""
	}

	// 1. Google Gemini family deprecated/retired patterns
	if strings.Contains(lower, "gemini") {
		if strings.Contains(lower, "3.7") ||
			strings.Contains(lower, "3.6") ||
			strings.Contains(lower, "3.1-pro") ||
			strings.Contains(lower, "pro-agent") ||
			strings.Contains(lower, "2.5-flash-high") ||
			strings.Contains(lower, "flash-image") ||
			strings.Contains(lower, "deprecated") ||
			strings.Contains(lower, "flash-super") ||
			strings.Contains(lower, "custom-pro") {
			return "gemini-3.8-flash-high"
		}
	}

	// 2. Claude family (Antigravity package):
	if strings.Contains(lower, "claude") || strings.Contains(lower, "opus") || strings.Contains(lower, "sonnet") {
		if strings.Contains(lower, "opus-custom") {
			return "claude-opus-4-6-thinking"
		}
		if strings.Contains(lower, "sonnet-custom") {
			return "claude-sonnet-4-6"
		}
	}

	return model
}

// RegisterDynamicDeprecatedModel adds a runtime-detected deprecated model mapping.
func RegisterDynamicDeprecatedModel(deprecated string, activeFallback string) {
	d := strings.ToLower(strings.TrimSpace(deprecated))
	f := strings.TrimSpace(activeFallback)
	if d != "" && f != "" {
		dynamicDeprecatedCache.Store(d, f)
	}
}

// ResolveActiveModelFallback rewrites any known or fuzzy-detected retired upstream model names
// to their current valid active counterpart in the same family.
func ResolveActiveModelFallback(model string) string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)

	// 1. Exact confirmed active match -> return unchanged
	if isConfirmedActiveModel(lower) {
		return trimmed
	}

	// 2. Exact static mapping match
	if fallback, ok := deprecatedModelFallbacks[lower]; ok {
		return fallback
	}

	// 3. Dynamic runtime-learned deprecation cache
	if v, ok := dynamicDeprecatedCache.Load(lower); ok {
		if fallback, ok := v.(string); ok && fallback != "" {
			return fallback
		}
	}

	// 4. Fuzzy family fallback for unknown or future retired models
	fuzzy := fuzzyFamilyFallback(trimmed)
	if fuzzy != trimmed && fuzzy != "" {
		dynamicDeprecatedCache.Store(lower, fuzzy)
		return fuzzy
	}

	return trimmed
}

// HarvestUpstreamModelDeprecation captures an upstream 404/410/model_not_found error
// at runtime, computes the fuzzy canonical replacement, caches it in dynamicDeprecatedCache,
// and auto-migrates registered pool definitions in RAM and persistent state.
func HarvestUpstreamModelDeprecation(rawModel string, statusCode int) (fallback string, autoMigrated bool) {
	trimmed := strings.TrimSpace(rawModel)
	if trimmed == "" {
		return "", false
	}
	// Extract bare model
	bare := cleanBareModelID(trimmed)
	lower := strings.ToLower(bare)

	// If statusCode is 404 or 410, this model is retired upstream
	if statusCode == 404 || statusCode == 410 || strings.Contains(lower, "not_found") {
		fb := fuzzyFamilyFallback(bare)
		if fb != "" && fb != bare {
			dynamicDeprecatedCache.Store(lower, fb)
			dynamicDeprecatedCache.Store(strings.ToLower(trimmed), fb)

			// Auto-sanear pools registrados si hacían referencia a este modelo extinto
			reg := DefaultRegistry()
			migrated := false
			for _, p := range reg.ListPools() {
				poolChanged := false
				for acc, m := range p.MemberModels {
					if strings.EqualFold(m, bare) || strings.EqualFold(m, trimmed) {
						p.MemberModels[acc] = fb
						poolChanged = true
					}
				}
				for i, tm := range p.Policy.TargetModels {
					if strings.EqualFold(tm, bare) || strings.EqualFold(tm, trimmed) {
						p.Policy.TargetModels[i] = fb
						poolChanged = true
					}
				}
				if poolChanged {
					_ = reg.SavePool(p)
					migrated = true
				}
			}
			return fb, migrated
		}
	}
	return ResolveActiveModelFallback(trimmed), false
}

// cloneBaseline returns a copy of the baseline catalog.
func cloneBaseline() []pluginModelInfo {
	out := make([]pluginModelInfo, len(baselineAntigravityModels))
	copy(out, baselineAntigravityModels)
	return out
}

// cleanBareModelID strips any leading provider/pool prefixes (e.g. agy/agy/gemini-3-flash -> gemini-3-flash)
// and normalizes deprecated models to their active fallback.
func cleanBareModelID(id string) string {
	cur := strings.TrimSpace(id)
	for {
		idx := strings.Index(cur, "/")
		if idx >= 0 && idx < len(cur)-1 {
			cur = cur[idx+1:]
		} else {
			break
		}
	}
	return ResolveActiveModelFallback(cur)
}

// poolTargets extracts the pool's target model list (empty when unset or paused).
func poolTargets(pool PoolDefinition) []string {
	if !pool.IsEnabled() {
		return nil
	}
	if pool.Policy.DisableIsolation {
		// Wildcard pools serve every family: no virtual catalog narrowing.
		return nil
	}
	seen := make(map[string]struct{})
	targets := make([]string, 0, len(pool.Policy.TargetModels))
	for _, t := range pool.Policy.TargetModels {
		bare := cleanBareModelID(t)
		if bare != "" {
			if _, dup := seen[bare]; !dup {
				seen[bare] = struct{}{}
				targets = append(targets, bare)
			}
		}
	}
	return targets
}

// prefixMatchesPool reports whether an auth disk prefix belongs to the pool
// base prefix (exact or numeric reserve suffix).
func prefixMatchesPool(prefix, basePrefix string) bool {
	prefix = strings.TrimSpace(prefix)
	base := strings.TrimSpace(basePrefix)
	if prefix == "" || base == "" {
		return false
	}
	if prefix == base {
		return true
	}
	if !strings.HasPrefix(prefix, base+"_") {
		return false
	}
	suffix := strings.TrimPrefix(prefix, base+"_")
	return poolReserveNumberPattern.MatchString("_" + suffix)
}

// poolContainsAuth reports whether the auth file is a member of the pool.
func poolContainsAuth(pool PoolDefinition, authFileName string) bool {
	name := strings.TrimSpace(authFileName)
	if name == "" {
		return false
	}
	for _, member := range pool.AllMembers() {
		if strings.EqualFold(strings.TrimSpace(member), name) {
			return true
		}
	}
	return false
}

// memberPoolsForAuth returns the pools whose membership includes the auth.
func memberPoolsForAuth(registry *PoolRegistry, authFileName string) []PoolDefinition {
	all := registry.ListPools()
	members := make([]PoolDefinition, 0, len(all))
	for _, pool := range all {
		if poolContainsAuth(pool, authFileName) {
			members = append(members, pool)
		}
	}
	return members
}

// sortModelsByID orders models deterministically by ID.
func sortModelsByID(models []pluginModelInfo) {
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
}

// modelCatalogForAuth computes the complete model catalog the host must
// register for one auth, derived from its pool memberships and baseline models:
//   - Preserves all native baseline models (gemini-3.8-flash-high, gemini-3.7-flash-high, etc.)
//     so the native CPAMC "Auth Files Management" credential modal displays its full native catalog.
//   - Includes bare targets for pools the account serves (e.g. claude-sonnet-4-6).
//   - Strictly excludes virtual pool facades (Pool-01-gemini) and prefixed routes (agy/...)
//     to prevent contamination of the native credential inspection modal.
func modelCatalogForAuth(diskPrefix string, memberPools []PoolDefinition) []pluginModelInfo {
	seen := make(map[string]struct{})
	models := make([]pluginModelInfo, 0, 32)
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, dup := seen[id]; dup {
			return
		}
		seen[id] = struct{}{}
		display := id
		if slash := strings.Index(id, "/"); slash >= 0 && slash < len(id)-1 {
			display = id[slash+1:]
		}
		models = append(models, pluginModelInfo{
			ID:          id,
			Object:      "model",
			OwnedBy:     antigravityProviderKey,
			DisplayName: display,
		})
	}

	// Always seed with the complete native Antigravity baseline catalog
	for _, m := range baselineAntigravityModels {
		add(m.ID)
	}

	// Add any bare pool targets (e.g. claude-sonnet-4-6), never virtual pool facades or prefixed routes
	for _, pool := range memberPools {
		targets := poolTargets(pool)
		for _, target := range targets {
			cleanTarget := cleanBareModelID(target)
			if cleanTarget != "" && !strings.HasPrefix(strings.ToLower(cleanTarget), "pool-") {
				add(cleanTarget)
			}
		}
	}

	sortModelsByID(models)
	return models
}

// poolPrefixedCatalog computes the static catalog of virtual pool routes:
// Exposes the clean sovereign Pool Identifier (e.g. "Pool-01-gemini", "Pool-02-gemini")
// as well as "<base>/<target>" for every pool target, plus the baseline when no pools
// exist (keeps the provider match key armed at host sweep time).
func poolPrefixedCatalog(registry *PoolRegistry) []pluginModelInfo {
	pools := registry.ListPools()
	models := make([]pluginModelInfo, 0, 16)
	seen := make(map[string]struct{})
	addModel := func(id, display string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, dup := seen[id]; dup {
			return
		}
		seen[id] = struct{}{}
		models = append(models, pluginModelInfo{
			ID:          id,
			Object:      "model",
			OwnedBy:     antigravityProviderKey,
			DisplayName: display,
		})
	}
	for _, pool := range pools {
		if !pool.IsEnabled() {
			continue
		}
		cleanPoolName := strings.TrimSpace(pool.DisplayName)
		if cleanPoolName == "" {
			cleanPoolName = strings.TrimSpace(pool.ID)
		}
		if cleanPoolName != "" {
			addModel(cleanPoolName, cleanPoolName)
		}
	}
	if len(models) == 0 {
		return cloneBaseline()
	}
	sortModelsByID(models)
	return models
}

// routeDecisionFor resolves a model.route request:
// 1) Clean Pool Identifier ("Pool-01-gemini"): resolves dynamically to the configured
//    model of the current ActiveLeader account in RAM.
// 2) Legacy "<base>/<target>" route: rewrites to the bare target model on the built-in
//    antigravity provider.
func routeDecisionFor(registry *PoolRegistry, requestedModel string) modelRouteResponse {
	trimmed := strings.TrimSpace(requestedModel)
	if trimmed == "" {
		return modelRouteResponse{}
	}

	// 0. Deprecated model auto-fallback interceptor:
	// If the requested model is a known retired or fuzzy-matched deprecated model (e.g. gemini-3.7-flash-high),
	// route it directly to the active model to prevent upstream 404 and cascading cooldowns.
	resolvedFallback := ResolveActiveModelFallback(trimmed)
	if !strings.EqualFold(resolvedFallback, trimmed) && !strings.Contains(trimmed, "/") {
		return modelRouteResponse{
			Handled:     true,
			TargetKind:  "provider",
			Target:      antigravityProviderKey,
			TargetModel: resolvedFallback,
			Reason:      fmt.Sprintf("auto-switcher-pro deprecated model auto-fallback (%s -> %s)", trimmed, resolvedFallback),
		}
	}

	slash := strings.Index(trimmed, "/")
	if slash <= 0 {
		// Direct Clean Pool Identifier invocation (e.g. "Pool-01-gemini")
		pool, ok := registry.GetPool(trimmed)
		if !ok || !pool.IsEnabled() {
			return modelRouteResponse{}
		}
		// Only treat bare strings without slash as pool routes if they match the Pool ID / DisplayName
		// (avoid intercepting native bare models like "gemini-3-flash").
		if !strings.EqualFold(trimmed, pool.ID) && !strings.EqualFold(trimmed, pool.DisplayName) && !strings.HasPrefix(strings.ToLower(trimmed), "pool-") {
			return modelRouteResponse{}
		}
		activeAuth := strings.TrimSpace(pool.ActiveLeader)
		if activeAuth == "" {
			activeAuth = strings.TrimSpace(pool.LeaderAuth)
		}
		// Armonización estricta: resolver TargetModel contra el objetivo especialista soberano del pool
		// garantizando que cualquier miembro que scheduler.pick elija reciba el mismo modelo válido.
		canonicalTarget := ""
		targets := poolTargets(pool)
		if len(targets) > 0 && strings.TrimSpace(targets[0]) != "" {
			canonicalTarget = targets[0]
		}
		if canonicalTarget == "" {
			canonicalTarget = pool.ActiveModelForAccount(activeAuth)
		}
		resolvedModel := ResolveActiveModelFallback(canonicalTarget)
		return modelRouteResponse{
			Handled:     true,
			TargetKind:  "provider",
			Target:      antigravityProviderKey,
			TargetModel: resolvedModel,
			Reason:      fmt.Sprintf("auto-switcher-pro sovereign pool route (%s -> %s)", trimmed, resolvedModel),
		}
	}

	if slash >= len(trimmed)-1 {
		return modelRouteResponse{}
	}

	base := trimmed[:slash]
	rest := trimmed[slash+1:]
	pool, ok := registry.GetPool(base)
	if !ok || !pool.IsEnabled() {
		return modelRouteResponse{}
	}

	resolvedRest := ResolveActiveModelFallback(rest)
	for _, target := range poolTargets(pool) {
		if strings.EqualFold(target, rest) || strings.EqualFold(target, resolvedRest) {
			return modelRouteResponse{
				Handled:     true,
				TargetKind:  "provider",
				Target:      antigravityProviderKey,
				TargetModel: resolvedRest,
				Reason:      fmt.Sprintf("auto-switcher-pro 2N pool route (%s)", pool.BasePrefix),
			}
		}
	}
	return modelRouteResponse{}
}

// parseAuthDiskPrefix extracts the routing prefix from the auth file JSON
// delivered in the model.for_auth request.
func parseAuthDiskPrefix(storageJSON []byte) string {
	if len(storageJSON) == 0 {
		return ""
	}
	var payload struct {
		Prefix string `json:"prefix"`
	}
	if err := json.Unmarshal(storageJSON, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.Prefix)
}

// handleModelStatic serves model.static: the static virtual pool route catalog.
func handleModelStatic() modelResponse {
	return modelResponse{
		Provider: antigravityProviderKey,
		Models:   poolPrefixedCatalog(activeRegistry()),
	}
}

// handleModelForAuth serves model.for_auth: the per-auth model catalog.
func handleModelForAuth(req modelForAuthRequest) modelResponse {
	authID := strings.TrimSpace(req.AuthID)
	diskPrefix := parseAuthDiskPrefix(req.StorageJSON)
	memberPools := memberPoolsForAuth(activeRegistry(), authID)
	return modelResponse{
		Provider: antigravityProviderKey,
		Models:   modelCatalogForAuth(diskPrefix, memberPools),
	}
}

// handleModelRoute serves model.route.
func handleModelRoute(req modelRouteRequest) modelRouteResponse {
	return routeDecisionFor(activeRegistry(), req.RequestedModel)
}

// schedulerPickCascade resolves auth selection for pool requests with the
// Líder -> Cascading Reserves semantics: the leader serves while available and
// reserves take over in cascade order. The host delivers Candidates already
// filtered by availability (cooldowns excluded) and model support, so picking
// the first cascade member present IS quota-aware failover.
func schedulerPickCascade(registry *PoolRegistry, req schedulerPickRequest) schedulerPickResponse {
	// Verificar si la licencia permite rotación o si el periodo de prueba expiró
	licStatus := license.GetLicenseStatus()
	if !licStatus.CanRotate {
		// Licencia expirada: no permitir failover ni cascada a cuentas de reserva
		return schedulerPickResponse{Handled: false}
	}

	// 1) Pool identity from the original client model ("clau/claude-sonnet-4-6")
	// carried by the host in the requested_model metadata key.
	originalModel := ""
	if req.Options.Metadata != nil {
		if v, ok := req.Options.Metadata["requested_model"]; ok {
			if s, ok := v.(string); ok {
				originalModel = strings.TrimSpace(s)
			}
		}
	}
	var pool *PoolDefinition
	if slash := strings.Index(originalModel, "/"); slash > 0 {
		if candidate, ok := registry.GetPool(originalModel[:slash]); ok && candidate.IsEnabled() {
			rest := originalModel[slash+1:]
			for _, target := range poolTargets(candidate) {
				if strings.EqualFold(target, rest) {
					pool = &candidate
					break
				}
			}
		}
	} else if originalModel != "" {
		// Clean Pool Identifier (e.g. "Pool-01-gemini")
		if candidate, ok := registry.GetPool(originalModel); ok && candidate.IsEnabled() {
			if strings.EqualFold(originalModel, candidate.ID) ||
				strings.EqualFold(originalModel, candidate.DisplayName) ||
				strings.HasPrefix(strings.ToLower(originalModel), "pool-") {
				pool = &candidate
			}
		}
	}
	if pool == nil {
		// Not a pool request (native credential or non-pool model): native scheduler.
		return schedulerPickResponse{Handled: false}
	}
	// 2) Symmetrical Pool Members with Dynamic Active Leader ordering:
	// Start from the current ActiveLeader in RAM (if set), followed by remaining pool members.
	allMembers := pool.AllMembers()
	cascade := make([]string, 0, len(allMembers))
	currentActive := strings.TrimSpace(pool.ActiveLeader)
	if currentActive != "" {
		for _, m := range allMembers {
			if strings.EqualFold(m, currentActive) {
				cascade = append(cascade, m)
				break
			}
		}
		for _, m := range allMembers {
			if !strings.EqualFold(m, currentActive) {
				cascade = append(cascade, m)
			}
		}
	} else {
		cascade = append(cascade, allMembers...)
	}

	// 3) Pick the first cascade member present among the available candidates.
	// REGLA PREDICTIVA (CTO): Si el líder dinámico actual está cerca de su límite seguro (>80%)
	// y hay otros miembros del pool sanos, rotar preventivamente el liderazgo antes del 429.
	available := make(map[string]string, len(req.Candidates))
	for _, candidate := range req.Candidates {
		if strings.TrimSpace(candidate.ID) != "" {
			available[strings.ToLower(candidate.ID)] = candidate.ID
		}
	}

	predEngine := GetPredictiveEngine()

	// Evaluar si el líder dinámico actual requiere descanso preventivo y si existe al menos otro miembro sano
	leaderAuth := ""
	if len(cascade) > 0 {
		leaderAuth = cascade[0]
	}
	leaderEmail := strings.TrimSuffix(strings.TrimPrefix(leaderAuth, "antigravity-"), ".json")

	// Blindaje de Prompt Caching (Histeresis & Sticky Session):
	// Para no destruir los embeddings en caché de Google Antigravity a mitad de una tarea larga:
	// 1) Si el líder no está en enfriamiento forzado ni tiene cuota crítica (<15%), se mantiene sticky.
	// 2) Si califica para enfriamiento por volumen/fatiga pero su cuota es >= 15%, solo se rota si
	//    alguna reserva disponible tiene una ventaja de cuota de al menos +30% (Δ >= 30%).
	hasHealthyReserve := false
	reserveWithBetterQuota := false
	leaderQuota, hasLeaderQuota := predEngine.GetLiveQuota(leaderEmail)

	if len(cascade) > 1 {
		for _, resAuth := range cascade[1:] {
			if _, ok := available[strings.ToLower(resAuth)]; ok {
				hasHealthyReserve = true
				if hasLeaderQuota {
					resEmail := strings.TrimSuffix(strings.TrimPrefix(resAuth, "antigravity-"), ".json")
					if resQ, ok := predEngine.GetLiveQuota(resEmail); ok {
						// Histeresis: la reserva debe tener al menos +30% de ventaja en cuota de 5h
						if (resQ.Window5hPct - leaderQuota.Window5hPct) >= 30.0 {
							reserveWithBetterQuota = true
							break
						}
					}
				} else {
					reserveWithBetterQuota = true
					break
				}
			}
		}
	}

	// Si el líder tiene cuota crítica (<15%) o cooldown activo, rotar si hay reserva sana
	// Si solo es fatiga por requests (>80%), aplicar histeresis: requerir reserva con +30% ventaja
	skipLeaderPredictive := false
	if hasHealthyReserve {
		if predEngine.IsCriticalQuotaOrCooldown(leaderEmail) {
			skipLeaderPredictive = true
		} else if predEngine.ShouldPreventiveCool(leaderEmail) && reserveWithBetterQuota {
			skipLeaderPredictive = true
		}
	}

	// Predictive Token-Budget Routing:
	// Si se debe recurrir a las reservas (failover o rotación preventiva), ordenar las reservas
	// disponibles por mayor cuota combinada (Window5hPct + WeeklyPct) para asignar la tarea
	// al miembro con mayor capacidad restante y evitar caídas prematuras.
	orderedCascade := make([]string, 0, len(cascade))
	if len(cascade) > 0 {
		orderedCascade = append(orderedCascade, cascade[0]) // Mantener el líder en el índice 0
		if len(cascade) > 1 {
			reserves := append([]string(nil), cascade[1:]...)
			sort.SliceStable(reserves, func(a, b int) bool {
				emailA := strings.TrimSuffix(strings.TrimPrefix(reserves[a], "antigravity-"), ".json")
				emailB := strings.TrimSuffix(strings.TrimPrefix(reserves[b], "antigravity-"), ".json")
				qA, hasA := predEngine.GetLiveQuota(emailA)
				qB, hasB := predEngine.GetLiveQuota(emailB)
				if hasA && hasB {
					scoreA := qA.Window5hPct + qA.WeeklyPct
					scoreB := qB.Window5hPct + qB.WeeklyPct
					return scoreA > scoreB
				}
				if hasA {
					return true
				}
				return false
			})
			orderedCascade = append(orderedCascade, reserves...)
		}
	} else {
		orderedCascade = cascade
	}

	for i, authFile := range orderedCascade {
		// Si el motor predictivo decidió enfriar al líder actual y estamos en i == 0, rotar al siguiente miembro
		if i == 0 && skipLeaderPredictive {
			continue
		}

		if exactID, ok := available[strings.ToLower(authFile)]; ok {
			isFailover := (i > 0) // Si i > 0 significa que hubo rotación de líder (por 429 o balanceo predictivo)
			if isFailover && registry != nil {
				// Actualizar el Líder Dinámico Ficticio en RAM hacia el nuevo miembro activo
				registry.SetActiveLeader(pool.BasePrefix, exactID)
			}
			reqs, fail := license.RecordRotation(isFailover)
			atomic.StoreInt64(&totalRotations, reqs)
			atomic.StoreInt64(&totalFailovers, fail)

			// Registrar evento granular en SQLite local (Pulse Tokens)
			email := exactID
			email = strings.TrimPrefix(email, "antigravity-")
			email = strings.TrimSuffix(email, ".json")

			// Registrar actividad en el motor predictivo para control de fatiga
			predEngine.RecordActivity(email)

			// Resolver el modelo especialista específico de esta cuenta (member_models o fallback del pool)
			resolvedTargetModel := ResolveActiveModelFallback(pool.ActiveModelForAccount(exactID))
			if strings.TrimSpace(resolvedTargetModel) == "" {
				resolvedTargetModel = ResolveActiveModelFallback(originalModel)
			}

			analytics.RecordEvent(analytics.RotationEvent{
				PoolID:          pool.ID,
				PoolPrefix:      pool.BasePrefix,
				SelectedAccount: exactID,
				AccountEmail:    email,
				IsFailover:      isFailover,
				CascadeIndex:    i,
				TargetModel:     resolvedTargetModel,
				StatusCode:      200,
			})

			return schedulerPickResponse{
				Handled: true,
				AuthID:  exactID,
			}
		}
	}

	// 4) No cascade member available: delegate to the builtin scheduler.
	return schedulerPickResponse{Handled: false}
}

// handleSchedulerPick serves scheduler.pick.
func handleSchedulerPick(req schedulerPickRequest) schedulerPickResponse {
	return schedulerPickCascade(activeRegistry(), req)
}

// isModelProviderMethod reports whether the plugin method belongs to the
// model provider, router or scheduler RPC surface.
func isModelProviderMethod(method string) bool {
	switch method {
	case methodModelStatic, methodModelRegister, methodModelForAuth, methodModelRoute, methodSchedulerPick:
		return true
	}
	return false
}
