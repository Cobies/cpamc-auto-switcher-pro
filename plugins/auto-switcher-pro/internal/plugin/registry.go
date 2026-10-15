package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	poolsRoutePath = "/auto-switcher-pro/pools"

	defaultStatePath = "/CLIProxyAPI/plugins/auto-switcher-pro-state.json"
	fallbackStateDir = "./"

	defaultAuthDir = "/root/.cli-proxy-api"
)

// resolveAuthDir locates the native CPAMC credentials directory.
func resolveAuthDir() string {
	if env := os.Getenv("AUTO_SWITCHER_AUTH_DIR"); env != "" {
		return env
	}
	if env := os.Getenv("CLI_PROXY_AUTH_DIR"); env != "" {
		return env
	}
	return defaultAuthDir
}

// PoolPolicy defines model filtering and isolation policies for a pool.
type PoolPolicy struct {
	DisableIsolation bool     `json:"disable_isolation"`
	Exclude55        bool     `json:"exclude_55"`
	TargetModels     []string `json:"target_models,omitempty"`
	ExcludedModels   []string `json:"excluded_models,omitempty"`
}

// PoolDefinition represents a logical load-balancing pool managed within Auto Switcher Pro.
// A pool has a sovereign identity defined by its immutable ID, human-readable Name/DisplayName,
// RouteSlug/BasePrefix for /model routing, Enabled toggle (active/paused), and a symmetrical list
// of member accounts (Members). The "Leader" is a dynamic, volatile role in RAM managed by
// Auto Switcher Pro's scheduler. Legacy LeaderAuth/Reserves fields remain populated for
// backward compatibility.
type PoolDefinition struct {
	ID           string            `json:"id"`                      // Sovereign immutable Unique Identifier (e.g. "Pool-01-gemini")
	Name         string            `json:"name,omitempty"`          // Human-readable Label / Group Name (e.g. "Pool-01-gemini")
	DisplayName  string            `json:"display_name,omitempty"`  // Optional extended label (e.g. "Pool-01-gemini")
	RouteSlug    string            `json:"route_slug,omitempty"`    // Virtual routing slug for /model (e.g. "Pool-01-gemini")
	Enabled      *bool             `json:"enabled,omitempty"`       // Operative status: nil/true = active in /model, false = paused
	Family       string            `json:"family"`                  // e.g. "gemini_pure", "gemini_sonnet", "gemini_opus", "gemini_claude", "codex"
	BasePrefix   string            `json:"base_prefix"`             // e.g. "agy", "agy_son", "agy_opus"
	Members      []string          `json:"members,omitempty"`       // Symmetrical list of all member auth files in the pool
	MemberModels map[string]string `json:"member_models,omitempty"` // Optional per-account configured model (e.g. {"antigravity-a.json": "gemini-3.8-flash-high"})
	ActiveLeader string            `json:"active_leader,omitempty"` // Dynamic active leader currently serving in RAM
	LeaderAuth   string            `json:"leader_auth"`             // Legacy compatibility (first/current active member)
	LeaderEmail  string            `json:"leader_email,omitempty"`
	Reserves     []string          `json:"reserves"`                // Legacy compatibility (remaining members)
	Policy       PoolPolicy        `json:"policy"`
	CreatedAt    string            `json:"created_at,omitempty"`
	UpdatedAt    string            `json:"updated_at,omitempty"`
}

// familyCanonicalShortName returns the clean family suffix ("gemini", "claude", "codex")
// used in Pool-XX-<family> identifiers.
func familyCanonicalShortName(family, basePrefix string) string {
	f := strings.ToLower(strings.TrimSpace(family))
	b := strings.ToLower(strings.TrimSpace(basePrefix))
	switch {
	case strings.Contains(f, "codex") || strings.HasPrefix(b, "codex"):
		return "codex"
	case strings.Contains(f, "claude") || strings.Contains(f, "sonnet") || strings.Contains(f, "opus") ||
		strings.HasPrefix(b, "clau") || strings.HasPrefix(b, "agy_clau") || strings.HasPrefix(b, "agy_son") || strings.HasPrefix(b, "agy_opus"):
		return "claude"
	default:
		return "gemini"
	}
}

// ActiveModelForAccount resolves the configured model for a specific member account
// (falling back to the pool's first target_model or family default).
func (p PoolDefinition) ActiveModelForAccount(authFile string) string {
	trimmed := strings.TrimSpace(authFile)
	if trimmed != "" && len(p.MemberModels) > 0 {
		if m, ok := p.MemberModels[trimmed]; ok && strings.TrimSpace(m) != "" {
			return strings.TrimSpace(m)
		}
		for k, v := range p.MemberModels {
			if strings.EqualFold(strings.TrimSpace(k), trimmed) && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
	}
	if len(p.Policy.TargetModels) > 0 && strings.TrimSpace(p.Policy.TargetModels[0]) != "" {
		return strings.TrimSpace(p.Policy.TargetModels[0])
	}
	fam := familyCanonicalShortName(p.Family, p.BasePrefix)
	switch fam {
	case "codex":
		return "gpt-4o"
	case "claude":
		return "claude-sonnet-4-6"
	default:
		return "gemini-3.8-flash-high"
	}
}

// IsEnabled returns true unless the pool was explicitly paused (Enabled == false).
func (p PoolDefinition) IsEnabled() bool {
	if p.Enabled == nil {
		return true
	}
	return *p.Enabled
}

// AllMembers returns the ordered, deduplicated list of all physical auth files
// belonging to this pool.
func (p PoolDefinition) AllMembers() []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(p.Members)+1+len(p.Reserves))
	add := func(raw string) {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			out = append(out, trimmed)
		}
	}
	for _, m := range p.Members {
		add(m)
	}
	add(p.LeaderAuth)
	for _, r := range p.Reserves {
		add(r)
	}
	return out
}

// normalizePoolDefinition synchronizes ID, Name, RouteSlug, BasePrefix and Members/LeaderAuth/Reserves
// so both pool-centric callers (ID/Members) and legacy callers (BasePrefix/LeaderAuth/Reserves)
// work seamlessly.
func normalizePoolDefinition(pool *PoolDefinition) {
	if pool == nil {
		return
	}
	if strings.TrimSpace(pool.BasePrefix) == "" && strings.TrimSpace(pool.RouteSlug) != "" {
		pool.BasePrefix = strings.TrimSpace(pool.RouteSlug)
	}
	if strings.TrimSpace(pool.BasePrefix) == "" && strings.TrimSpace(pool.Name) != "" {
		pool.BasePrefix = strings.TrimSpace(pool.Name)
	}
	if strings.TrimSpace(pool.RouteSlug) == "" {
		pool.RouteSlug = strings.TrimSpace(pool.BasePrefix)
	}
	if strings.TrimSpace(pool.Name) == "" {
		pool.Name = strings.TrimSpace(pool.BasePrefix)
	}
	if strings.TrimSpace(pool.DisplayName) == "" {
		pool.DisplayName = pool.Name
	}
	if pool.Enabled == nil {
		tr := true
		pool.Enabled = &tr
	}

	// Contingencia Antigravedad & Gobernanza Sagrada:
	// Purgar de raíz cualquier identificador de pool virtual ('pool-...') de target_models y excluded_models
	// para blindar el estado de persistencia contra cualquier contaminación cruzada accidental.
	if len(pool.Policy.TargetModels) > 0 {
		cleanedTargets := make([]string, 0, len(pool.Policy.TargetModels))
		for _, t := range pool.Policy.TargetModels {
			tr := strings.TrimSpace(t)
			if tr != "" && !strings.HasPrefix(strings.ToLower(tr), "pool-") {
				cleanedTargets = append(cleanedTargets, tr)
			}
		}
		pool.Policy.TargetModels = cleanedTargets
	}
	if len(pool.Policy.ExcludedModels) > 0 {
		cleanedExclusions := make([]string, 0, len(pool.Policy.ExcludedModels))
		for _, e := range pool.Policy.ExcludedModels {
			er := strings.TrimSpace(e)
			if er != "" && !strings.HasPrefix(strings.ToLower(er), "pool-") {
				cleanedExclusions = append(cleanedExclusions, er)
			}
		}
		pool.Policy.ExcludedModels = cleanedExclusions
	}

	all := pool.AllMembers()
	pool.Members = all
	if len(all) > 0 {
		pool.LeaderAuth = all[0]
		if len(all) > 1 {
			pool.Reserves = all[1:]
		} else {
			pool.Reserves = []string{}
		}
		if strings.TrimSpace(pool.ActiveLeader) == "" {
			pool.ActiveLeader = pool.LeaderAuth
		}
	}
}

// RegistryState is the serializable structure stored on disk.
type RegistryState struct {
	Version   int              `json:"version"`
	UpdatedAt string           `json:"updated_at"`
	Pools     []PoolDefinition `json:"pools"`
}

// PoolRegistry provides thread-safe in-memory caching and atomic file persistence
// for pools created via GroupManager.
type PoolRegistry struct {
	mu            sync.RWMutex
	filePath      string
	pools         map[string]PoolDefinition // keyed by base_prefix (case-insensitive)
	activeLeaders map[string]string         // volatile in-memory active leader per pool key
	loaded        bool
}

var (
	defaultRegistryInstance *PoolRegistry
	defaultRegistryOnce     sync.Once
)

// resolveStateFilePath determines the optimal persistent location for the state file.
func resolveStateFilePath(customPath string) string {
	if customPath != "" {
		return customPath
	}
	if envPath := os.Getenv("AUTO_SWITCHER_STATE_FILE"); envPath != "" {
		return envPath
	}

	// Prefer the container plugins bind-mount if the directory exists and is writable
	pluginsDir := "/CLIProxyAPI/plugins"
	if fi, err := os.Stat(pluginsDir); err == nil && fi.IsDir() {
		return defaultStatePath
	}

	// Local host fallback
	return filepath.Join(fallbackStateDir, "auto-switcher-pro-state.json")
}

// NewPoolRegistry creates a new PoolRegistry pointing to a given or resolved state file.
func NewPoolRegistry(filePath string) *PoolRegistry {
	resolved := resolveStateFilePath(filePath)
	return &PoolRegistry{
		filePath:      resolved,
		pools:         make(map[string]PoolDefinition),
		activeLeaders: make(map[string]string),
	}
}

// DefaultRegistry returns the process-wide default singleton registry.
func DefaultRegistry() *PoolRegistry {
	defaultRegistryOnce.Do(func() {
		defaultRegistryInstance = NewPoolRegistry("")
		_ = defaultRegistryInstance.Load()
	})
	return defaultRegistryInstance
}

// Load reads and parses the JSON state file from disk into memory.
func (r *PoolRegistry) Load() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	data, err := os.ReadFile(r.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			r.pools = make(map[string]PoolDefinition)
			r.loaded = true
			return nil
		}
		return fmt.Errorf("read state file %s: %w", r.filePath, err)
	}

	var state RegistryState
	if err := json.Unmarshal(data, &state); err != nil {
		return fmt.Errorf("unmarshal state file %s: %w", r.filePath, err)
	}

	r.pools = make(map[string]PoolDefinition)
	if r.activeLeaders == nil {
		r.activeLeaders = make(map[string]string)
	}
	for _, p := range state.Pools {
		normalizePoolDefinition(&p)
		key := strings.ToLower(strings.TrimSpace(p.BasePrefix))
		if key != "" {
			if live, ok := r.activeLeaders[key]; ok && live != "" {
				p.ActiveLeader = live
			}
			r.pools[key] = p
		}
	}
	r.loaded = true
	return nil
}

// Save atomically writes the current state to disk.
func (r *PoolRegistry) Save() error {
	r.mu.RLock()
	poolsList := make([]PoolDefinition, 0, len(r.pools))
	for _, p := range r.pools {
		poolsList = append(poolsList, p)
	}
	r.mu.RUnlock()

	state := RegistryState{
		Version:   1,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Pools:     poolsList,
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	dir := filepath.Dir(r.filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create state dir %s: %w", dir, err)
		}
	}

	tmpFile := fmt.Sprintf("%s.tmp.%d", r.filePath, time.Now().UnixNano())
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return fmt.Errorf("write temp state %s: %w", tmpFile, err)
	}

	if err := os.Rename(tmpFile, r.filePath); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("rename temp state to %s: %w", r.filePath, err)
	}

	return nil
}

// ListPools returns all stored pools as a slice, automatically reconciling
// with physical credential files on disk if the native auth directory exists.
func (r *PoolRegistry) ListPools() []PoolDefinition {
	_, _ = r.PruneStaleAccounts("")

	r.mu.RLock()
	defer r.mu.RUnlock()

	res := make([]PoolDefinition, 0, len(r.pools))
	for key, p := range r.pools {
		normalizePoolDefinition(&p)
		if live, ok := r.activeLeaders[key]; ok && live != "" {
			p.ActiveLeader = live
		}
		res = append(res, p)
	}
	return res
}

// GetPool returns a pool by ID or base prefix if it exists, reconciling with disk.
func (r *PoolRegistry) GetPool(idOrPrefix string) (PoolDefinition, bool) {
	_, _ = r.PruneStaleAccounts("")

	r.mu.RLock()
	defer r.mu.RUnlock()

	key := strings.ToLower(strings.TrimSpace(idOrPrefix))
	if p, ok := r.pools[key]; ok {
		normalizePoolDefinition(&p)
		if live, hasLive := r.activeLeaders[key]; hasLive && live != "" {
			p.ActiveLeader = live
		}
		return p, true
	}
	// Fallback search by sovereign Pool ID, Name, DisplayName or RouteSlug
	for k, p := range r.pools {
		if strings.EqualFold(p.ID, key) ||
			strings.EqualFold(p.Name, key) ||
			strings.EqualFold(p.DisplayName, key) ||
			strings.EqualFold(p.RouteSlug, key) {
			normalizePoolDefinition(&p)
			if live, hasLive := r.activeLeaders[k]; hasLive && live != "" {
				p.ActiveLeader = live
			}
			return p, true
		}
	}
	return PoolDefinition{}, false
}

// SetActiveLeader dynamically updates the volatile in-memory active leader for a pool
// when Auto Switcher Pro rotates leadership among pool members.
func (r *PoolRegistry) SetActiveLeader(basePrefix, activeAuth string) {
	key := strings.ToLower(strings.TrimSpace(basePrefix))
	auth := strings.TrimSpace(activeAuth)
	if key == "" || auth == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.activeLeaders == nil {
		r.activeLeaders = make(map[string]string)
	}
	r.activeLeaders[key] = auth
	if p, ok := r.pools[key]; ok {
		p.ActiveLeader = auth
		r.pools[key] = p
	}
}

// PruneStaleAccounts checks registered pools against physical credential files in
// authDir. If authDir exists on disk:
//   - Missing reserve files are pruned from pool.Reserves.
//   - If LeaderAuth is missing, the first surviving reserve is promoted to leader.
//   - If all members have been deleted from disk, the pool is dissolved automatically.
//
// Returns true if state changed and was saved atomically.
func (r *PoolRegistry) PruneStaleAccounts(authDir string) (bool, error) {
	if authDir == "" {
		authDir = resolveAuthDir()
	}
	fi, err := os.Stat(authDir)
	if err != nil || !fi.IsDir() {
		return false, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	return r.pruneStaleAccountsLocked(authDir)
}

func (r *PoolRegistry) pruneStaleAccountsLocked(authDir string) (bool, error) {
	changed := false
	toDelete := make([]string, 0)

	for key, pool := range r.pools {
		survivingReserves := make([]string, 0, len(pool.Reserves))
		for _, res := range pool.Reserves {
			trimmed := strings.TrimSpace(res)
			if trimmed == "" {
				continue
			}
			resPath := filepath.Join(authDir, trimmed)
			if _, err := os.Stat(resPath); err == nil {
				survivingReserves = append(survivingReserves, trimmed)
			} else {
				changed = true
			}
		}

		leaderAlive := false
		trimmedLeader := strings.TrimSpace(pool.LeaderAuth)
		if trimmedLeader != "" {
			leaderPath := filepath.Join(authDir, trimmedLeader)
			if _, err := os.Stat(leaderPath); err == nil {
				leaderAlive = true
			}
		}

		if !leaderAlive {
			changed = true
			if len(survivingReserves) > 0 {
				pool.LeaderAuth = survivingReserves[0]
				pool.Reserves = survivingReserves[1:]
				pool.Members = append([]string{pool.LeaderAuth}, pool.Reserves...)
				pool.ActiveLeader = pool.LeaderAuth
				if r.activeLeaders != nil {
					r.activeLeaders[key] = pool.LeaderAuth
				}
				// Saneamiento de MemberModels: limpiar cuentas eliminadas
				if len(pool.MemberModels) > 0 {
					cleanedModels := make(map[string]string)
					aliveMembers := pool.AllMembers()
					for _, am := range aliveMembers {
						if m, ok := pool.MemberModels[am]; ok && strings.TrimSpace(m) != "" {
							cleanedModels[am] = m
						}
					}
					pool.MemberModels = cleanedModels
				}
				pool.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
				r.pools[key] = pool
			} else {
				toDelete = append(toDelete, key)
			}
		} else if len(survivingReserves) != len(pool.Reserves) {
			changed = true
			pool.Reserves = survivingReserves
			pool.Members = append([]string{pool.LeaderAuth}, pool.Reserves...)
			// Saneamiento de MemberModels: limpiar reservas eliminadas
			if len(pool.MemberModels) > 0 {
				cleanedModels := make(map[string]string)
				aliveMembers := pool.AllMembers()
				for _, am := range aliveMembers {
					if m, ok := pool.MemberModels[am]; ok && strings.TrimSpace(m) != "" {
						cleanedModels[am] = m
					}
				}
				pool.MemberModels = cleanedModels
			}
			pool.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			r.pools[key] = pool
		}
	}

	for _, delKey := range toDelete {
		delete(r.pools, delKey)
	}

	if changed {
		poolsList := make([]PoolDefinition, 0, len(r.pools))
		for _, p := range r.pools {
			poolsList = append(poolsList, p)
		}
		state := RegistryState{
			Version:   1,
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
			Pools:     poolsList,
		}
		data, err := json.MarshalIndent(state, "", "  ")
		if err != nil {
			return true, fmt.Errorf("marshal state on prune: %w", err)
		}
		dir := filepath.Dir(r.filePath)
		if dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0755)
		}
		tmpFile := fmt.Sprintf("%s.tmp.%d", r.filePath, time.Now().UnixNano())
		if err := os.WriteFile(tmpFile, data, 0644); err != nil {
			return true, fmt.Errorf("write temp state on prune: %w", err)
		}
		if err := os.Rename(tmpFile, r.filePath); err != nil {
			_ = os.Remove(tmpFile)
			return true, fmt.Errorf("rename temp state on prune: %w", err)
		}
	}

	return changed, nil
}

// SavePool stores or updates a pool definition and commits atomically to disk.
func (r *PoolRegistry) SavePool(pool PoolDefinition) error {
	normalizePoolDefinition(&pool)

	trimmedPrefix := strings.TrimSpace(pool.BasePrefix)
	if trimmedPrefix == "" {
		return errors.New("base_prefix is required")
	}
	if !safePrefixPattern.MatchString(trimmedPrefix) {
		return errors.New("base_prefix contains invalid characters")
	}
	if len(pool.Members) == 0 || strings.TrimSpace(pool.LeaderAuth) == "" {
		return errors.New("at least one member account (members or leader_auth) is required")
	}

	key := strings.ToLower(trimmedPrefix)
	now := time.Now().UTC().Format(time.RFC3339)

	r.mu.Lock()
	// Check if pool already exists by ID (in case of rename/prefix update) or by key
	var existing PoolDefinition
	foundExisting := false
	oldKeyToRemove := ""
	if strings.TrimSpace(pool.ID) != "" {
		for k, p := range r.pools {
			if strings.EqualFold(p.ID, pool.ID) {
				existing = p
				foundExisting = true
				if k != key {
					oldKeyToRemove = k
				}
				break
			}
		}
	}
	if !foundExisting {
		if ex, ok := r.pools[key]; ok {
			existing = ex
			foundExisting = true
		}
	}

	if foundExisting {
		pool.CreatedAt = existing.CreatedAt
		if pool.ID == "" {
			pool.ID = existing.ID
		}
		if pool.DisplayName == "" {
			pool.DisplayName = existing.DisplayName
		}
		// Fusión defensiva (merge) de MemberModels: preservar asignaciones per-cuenta previas
		// si el payload entrante solo contiene un subconjunto o actualización parcial.
		if len(existing.MemberModels) > 0 {
			merged := make(map[string]string)
			for k, v := range existing.MemberModels {
				if strings.TrimSpace(v) != "" {
					merged[k] = strings.TrimSpace(v)
				}
			}
			for k, v := range pool.MemberModels {
				if strings.TrimSpace(v) != "" {
					merged[k] = strings.TrimSpace(v)
				}
			}
			pool.MemberModels = merged
		}
		if oldKeyToRemove != "" {
			delete(r.pools, oldKeyToRemove)
		}
	} else {
		pool.CreatedAt = now
		seq := len(r.pools) + 1
		famShort := familyCanonicalShortName(pool.Family, trimmedPrefix)
		canonicalPoolID := fmt.Sprintf("Pool-%02d-%s", seq, famShort)
		if pool.ID == "" {
			pool.ID = canonicalPoolID
		}
		if pool.DisplayName == "" || pool.DisplayName == trimmedPrefix {
			pool.DisplayName = canonicalPoolID
		}
	}
	pool.UpdatedAt = now
	pool.BasePrefix = trimmedPrefix
	pool.RouteSlug = trimmedPrefix
	if strings.TrimSpace(pool.Name) == "" {
		pool.Name = trimmedPrefix
	}
	if r.activeLeaders == nil {
		r.activeLeaders = make(map[string]string)
	}
	r.activeLeaders[key] = pool.ActiveLeader
	r.pools[key] = pool
	r.mu.Unlock()

	return r.Save()
}

// DeletePool removes a pool by ID or base prefix and commits atomically to disk.
func (r *PoolRegistry) DeletePool(idOrPrefix string) (bool, error) {
	target := strings.ToLower(strings.TrimSpace(idOrPrefix))
	if target == "" {
		return false, errors.New("id or base_prefix is required")
	}

	r.mu.Lock()
	matchedKey := ""
	if _, exists := r.pools[target]; exists {
		matchedKey = target
	} else {
		for k, p := range r.pools {
			if strings.EqualFold(p.ID, target) || strings.EqualFold(p.RouteSlug, target) {
				matchedKey = k
				break
			}
		}
	}
	if matchedKey == "" {
		r.mu.Unlock()
		return false, nil
	}
	delete(r.pools, matchedKey)
	r.mu.Unlock()

	if err := r.Save(); err != nil {
		return false, err
	}
	return true, nil
}

// Clear removes all pools and commits to disk.
func (r *PoolRegistry) Clear() error {
	r.mu.Lock()
	r.pools = make(map[string]PoolDefinition)
	r.mu.Unlock()

	return r.Save()
}

// isPoolsPath checks if an incoming management HTTP path targets the pools API endpoint.
func isPoolsPath(rawPath string) bool {
	normalized := strings.TrimSpace(rawPath)
	if idx := strings.IndexAny(normalized, "?#"); idx != -1 {
		normalized = normalized[:idx]
	}
	normalized = strings.TrimRight(normalized, "/")
	return strings.HasSuffix(normalized, poolsRoutePath)
}

// handlePoolsHTTP dispatches GET, POST, DELETE operations on /v0/management/auto-switcher-pro/pools.
func handlePoolsHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	registry := DefaultRegistry()

	switch method {
	case http.MethodGet:
		pools := registry.ListPools()
		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":    true,
			"pools": pools,
			"count": len(pools),
		})

	case http.MethodPost:
		if len(req.Body) == 0 {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "bad_request",
				"message": "request body is required",
			})
		}

		var pool PoolDefinition
		if err := json.Unmarshal(req.Body, &pool); err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "bad_request",
				"message": fmt.Sprintf("malformed JSON payload: %v", err),
			})
		}

		if err := registry.SavePool(pool); err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "invalid_pool",
				"message": err.Error(),
			})
		}

		saved, _ := registry.GetPool(pool.BasePrefix)
		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":      true,
			"pool":    saved,
			"message": fmt.Sprintf("Pool %s saved successfully", saved.BasePrefix),
		})

	case http.MethodDelete:
		prefix := ""
		if len(req.Query) > 0 {
			for _, k := range []string{"id", "prefix", "base_prefix"} {
				if vals, ok := req.Query[k]; ok && len(vals) > 0 && vals[0] != "" {
					prefix = vals[0]
					break
				}
			}
		}

		if prefix == "" && strings.Contains(req.Path, "?") {
			if u, err := url.Parse(req.Path); err == nil {
				for _, k := range []string{"id", "prefix", "base_prefix"} {
					if v := u.Query().Get(k); v != "" {
						prefix = v
						break
					}
				}
			}
		}

		// Also check if id or prefix is supplied in the JSON body
		if prefix == "" && len(req.Body) > 0 {
			var bodyData struct {
				ID         string `json:"id"`
				Prefix     string `json:"prefix"`
				BasePrefix string `json:"base_prefix"`
			}
			if err := json.Unmarshal(req.Body, &bodyData); err == nil {
				if bodyData.ID != "" {
					prefix = bodyData.ID
				} else if bodyData.Prefix != "" {
					prefix = bodyData.Prefix
				} else {
					prefix = bodyData.BasePrefix
				}
			}
		}

		if strings.TrimSpace(prefix) == "" {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "bad_request",
				"message": "prefix query parameter is required to delete a pool",
			})
		}

		deleted, err := registry.DeletePool(prefix)
		if err != nil {
			return jsonManagementResponse(http.StatusInternalServerError, map[string]string{
				"error":   "delete_error",
				"message": err.Error(),
			})
		}

		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":      true,
			"deleted": deleted,
			"prefix":  prefix,
			"message": fmt.Sprintf("Pool %s dissolved successfully", prefix),
		})

	default:
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": fmt.Sprintf("method %s not allowed on pools endpoint", method),
		})
	}
}
