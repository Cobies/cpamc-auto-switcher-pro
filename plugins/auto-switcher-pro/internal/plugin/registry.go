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
	poolsRoutePath       = "/auto-switcher-pro/pools"
	legacyPoolsRoutePath = "/visual-profile/pools"

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
type PoolDefinition struct {
	ID          string     `json:"id"`
	Family      string     `json:"family"`      // e.g. "gemini_pure", "gemini_sonnet", "gemini_opus", "gemini_claude", "codex"
	BasePrefix  string     `json:"base_prefix"` // e.g. "agy", "agy_son", "agy_opus"
	LeaderAuth  string     `json:"leader_auth"` // Master auth file name or identifier (e.g. "antigravity-u1@gmail.com.json")
	LeaderEmail string     `json:"leader_email,omitempty"`
	Reserves    []string   `json:"reserves"` // List of reserve master auth file names
	Policy      PoolPolicy `json:"policy"`
	CreatedAt   string     `json:"created_at,omitempty"`
	UpdatedAt   string     `json:"updated_at,omitempty"`
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
	mu        sync.RWMutex
	filePath  string
	pools     map[string]PoolDefinition // keyed by base_prefix (case-insensitive)
	loaded    bool
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
		filePath: resolved,
		pools:    make(map[string]PoolDefinition),
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
	for _, p := range state.Pools {
		key := strings.ToLower(strings.TrimSpace(p.BasePrefix))
		if key != "" {
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
	for _, p := range r.pools {
		res = append(res, p)
	}
	return res
}

// GetPool returns a pool by base prefix if it exists, reconciling with disk.
func (r *PoolRegistry) GetPool(basePrefix string) (PoolDefinition, bool) {
	_, _ = r.PruneStaleAccounts("")

	r.mu.RLock()
	defer r.mu.RUnlock()

	key := strings.ToLower(strings.TrimSpace(basePrefix))
	p, ok := r.pools[key]
	return p, ok
}

// PruneStaleAccounts checks registered pools against physical credential files in
// authDir. If authDir exists on disk:
//   - Missing reserve files are pruned from pool.Reserves.
//   - If LeaderAuth is missing, the first surviving reserve is promoted to leader.
//   - If all members have been deleted from disk, the pool is dissolved automatically.
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
				pool.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
				r.pools[key] = pool
			} else {
				toDelete = append(toDelete, key)
			}
		} else if len(survivingReserves) != len(pool.Reserves) {
			changed = true
			pool.Reserves = survivingReserves
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
	trimmedPrefix := strings.TrimSpace(pool.BasePrefix)
	if trimmedPrefix == "" {
		return errors.New("base_prefix is required")
	}
	if !safePrefixPattern.MatchString(trimmedPrefix) {
		return errors.New("base_prefix contains invalid characters")
	}
	if strings.TrimSpace(pool.LeaderAuth) == "" {
		return errors.New("leader_auth is required")
	}

	key := strings.ToLower(trimmedPrefix)
	now := time.Now().UTC().Format(time.RFC3339)

	r.mu.Lock()
	if existing, ok := r.pools[key]; ok {
		pool.CreatedAt = existing.CreatedAt
		if pool.ID == "" {
			pool.ID = existing.ID
		}
	} else {
		pool.CreatedAt = now
		if pool.ID == "" {
			pool.ID = fmt.Sprintf("pool-%s-%d", key, time.Now().Unix())
		}
	}
	pool.UpdatedAt = now
	pool.BasePrefix = trimmedPrefix
	r.pools[key] = pool
	r.mu.Unlock()

	return r.Save()
}

// DeletePool removes a pool by base prefix and commits atomically to disk.
func (r *PoolRegistry) DeletePool(basePrefix string) (bool, error) {
	key := strings.ToLower(strings.TrimSpace(basePrefix))
	if key == "" {
		return false, errors.New("base_prefix is required")
	}

	r.mu.Lock()
	_, exists := r.pools[key]
	if !exists {
		r.mu.Unlock()
		return false, nil
	}
	delete(r.pools, key)
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
	return strings.HasSuffix(normalized, poolsRoutePath) || strings.HasSuffix(normalized, legacyPoolsRoutePath)
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
			if vals, ok := req.Query["prefix"]; ok && len(vals) > 0 {
				prefix = vals[0]
			}
			if prefix == "" {
				if vals, ok := req.Query["base_prefix"]; ok && len(vals) > 0 {
					prefix = vals[0]
				}
			}
		}

		if prefix == "" && strings.Contains(req.Path, "?") {
			if u, err := url.Parse(req.Path); err == nil {
				prefix = u.Query().Get("prefix")
				if prefix == "" {
					prefix = u.Query().Get("base_prefix")
				}
			}
		}

		// Also check if prefix is supplied in the JSON body
		if prefix == "" && len(req.Body) > 0 {
			var bodyData struct {
				Prefix     string `json:"prefix"`
				BasePrefix string `json:"base_prefix"`
			}
			if err := json.Unmarshal(req.Body, &bodyData); err == nil {
				prefix = bodyData.Prefix
				if prefix == "" {
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
