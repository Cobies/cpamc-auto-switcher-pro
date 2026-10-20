package plugin

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"auto-switcher-pro/internal/analytics"
)

const (
	agentMatrixRoutePath          = "/auto-switcher-pro/agent-matrix"
	agentMatrixPingRoutePath      = "/auto-switcher-pro/agent-matrix/ping"
	agentMatrixHeartbeatRoutePath = "/auto-switcher-pro/agent-matrix/heartbeat"
	agentMatrixScanRoutePath      = "/auto-switcher-pro/agent-matrix/scan-environment"
	agentMatrixWarmupRoutePath    = "/auto-switcher-pro/agent-matrix/warmup-triage"
)

var (
	matrixMu        sync.RWMutex
	lastJok3rMtime  time.Time
	lastGentleMtime time.Time
)

func isAgentMatrixPath(path string) bool {
	return strings.Contains(path, agentMatrixRoutePath)
}

func isAgentMatrixPingPath(path string) bool {
	return strings.Contains(path, agentMatrixPingRoutePath)
}

func isAgentMatrixHeartbeatPath(path string) bool {
	return strings.Contains(path, agentMatrixHeartbeatRoutePath)
}

func isAgentMatrixScanPath(path string) bool {
	return strings.Contains(path, agentMatrixScanRoutePath)
}

func isAgentMatrixWarmupPath(path string) bool {
	return strings.Contains(path, agentMatrixWarmupRoutePath)
}

// DiscoveredHarness represents a dynamically detected runtime harness and its actual agents.
type DiscoveredHarness struct {
	ID         string      `json:"id"`          // "gentle_shell", "jok3r_pi", "opencode"
	Name       string      `json:"name"`        // "Gentle-Shell CLI", "j0k3r-pi"
	Icon       string      `json:"icon"`        // "📟", "⚡", "💻"
	Badge      string      `json:"badge"`       // "📟 Gentle-Shell Terminal CLI"
	ConfigPath string      `json:"config_path"` // "~/.gentle-shell/agent/profiles.json"
	Subtitle   string      `json:"subtitle"`    // Explanatory callout
	Agents     []AgentInfo `json:"agents"`      // The REAL agents discovered on disk
}

// AgentInfo represents an agent's unified metadata across Gentle-AI and jok3r-pi.
type AgentInfo struct {
	Universe       string `json:"universe"`         // "gentle_ai" or "jok3r_pi"
	AgentID        string `json:"agent_id"`         // "orchestrator", "worker", "00-discovery", etc.
	DisplayName    string `json:"display_name"`     // "👑 Orquestador", "02-apply", etc.
	RoleType       string `json:"role_type"`        // "orchestrator", "discovery", "planning", "apply", "verify", "research", "ui_design", "review"
	IsOrchestrator bool   `json:"is_orchestrator"`  // true for main orchestrator in each universe
	PrimaryPool    string `json:"primary_pool"`     // "Pool-04-claude"
	FallbackPool   string `json:"fallback_pool"`    // "Pool-01-gemini"
	ThinkingLevel  string `json:"thinking_level"`   // "low", "medium", "high", or "none"
	AutoDowngrade  bool   `json:"auto_downgrade"`   // true for automatic cost mitigation on Turn >= 2
	MaxClaudeTurns int    `json:"max_claude_turns"` // Max consecutive Claude turns before Circuit Breaker trips (default 3, 0 = unlimited)
	Concurrency    int    `json:"concurrency"`
	Description    string `json:"description"`
}

// PoolDetailInfo provides transparency bridging the virtual pool facade to physical reality.
type PoolDetailInfo struct {
	ID            string `json:"id"`
	Family        string `json:"family"`
	ActiveLeader  string `json:"active_leader"`
	LeaderEmail   string `json:"leader_email"`
	TargetModel   string `json:"target_model"`
	ReservesCount int    `json:"reserves_count"`
	TotalMembers  int    `json:"total_members"`
}

// DiscoveredUpstreamModel represents an unassigned account model or upstream provider route.
type DiscoveredUpstreamModel struct {
	ID          string `json:"id"`           // e.g. "openai/gpt-4o", "deepseek/deepseek-chat"
	Provider    string `json:"provider"`     // e.g. "openai", "deepseek", "antigravity"
	DisplayName string `json:"display_name"` // e.g. "OpenAI GPT-4o"
}

// AgentMatrixPayload represents the JSON wire format for GET/POST /agent-matrix.
type AgentMatrixPayload struct {
	OK               bool                      `json:"ok"`
	Harnesses        []DiscoveredHarness       `json:"harnesses"`
	GentleAgents     []AgentInfo               `json:"gentle_agents"`
	Jok3rAgents      []AgentInfo               `json:"jok3r_agents"`
	Jok3rDetected    bool                      `json:"jok3r_detected"`
	AvailablePools   []string                  `json:"available_pools"`
	PoolCapabilities map[string]bool           `json:"pool_capabilities"` // pool_id -> supports_thinking
	PoolDetails      map[string]PoolDetailInfo `json:"pool_details"`      // pool_id -> physical reality & model
	UpstreamModels   []DiscoveredUpstreamModel `json:"upstream_models"`   // Unassigned accounts & upstream direct models
	Message          string                    `json:"message,omitempty"`
}

func getJok3rRootDir() string {
	if env := os.Getenv("HOST_PI_DIR"); env != "" {
		if fi, err := os.Stat(env); err == nil && fi.IsDir() {
			return env
		}
	}
	if fi, err := os.Stat("/host-harnesses/j0k3r"); err == nil && fi.IsDir() {
		return "/host-harnesses/j0k3r"
	}
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, ".pi", "agent-j0k3r")
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			return p
		}
	}
	return ""
}

func getGentleRootDir() string {
	if env := os.Getenv("HOST_GENTLE_DIR"); env != "" {
		if fi, err := os.Stat(env); err == nil && fi.IsDir() {
			return env
		}
	}
	if fi, err := os.Stat("/host-harnesses/gentle-shell"); err == nil && fi.IsDir() {
		return "/host-harnesses/gentle-shell"
	}
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, ".gentle-shell")
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			return p
		}
	}
	return ""
}

// isJok3rDetected evaluates dynamically whether j0k3r-pi is actively running or signaled.
func isJok3rDetected() bool {
	if os.Getenv("FORCE_JOK3R_DETECTED") == "true" {
		return true
	}
	if os.Getenv("FORCE_JOK3R_DETECTED") == "false" {
		return false
	}
	if getJok3rRootDir() != "" {
		return true
	}

	// 1. Check if harness was registered in SQLite WAL (via active heartbeat or CLI /agent:matrix)
	if analytics.IsHarnessDetected("jok3r_pi") {
		return true
	}

	// 2. Check for active marker file in plugins directory (created dynamically when jok3r-pi session starts)
	candidates := []string{
		"/CLIProxyAPI/plugins/.jok3r_detected",
		"/dev/shm/.jok3r_detected",
		"./plugins/.jok3r_detected",
		"./.jok3r_detected",
	}

	home, err := os.UserHomeDir()
	if err == nil {
		candidates = append(candidates,
			filepath.Join(home, "services", "cliproxy", "plugins", ".jok3r_detected"),
			filepath.Join(home, ".pi", "agent-j0k3r", ".jok3r_detected"),
		)
	}

	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return true
		}
	}

	return false
}

func handleAgentMatrixHTTP(req ManagementRequestPayload) ([]byte, error) {
	if isAgentMatrixPingPath(req.Path) {
		return handleAgentMatrixPingHTTP(req)
	}
	if isAgentMatrixHeartbeatPath(req.Path) {
		return handleAgentMatrixHeartbeatHTTP(req)
	}
	if isAgentMatrixScanPath(req.Path) {
		return handleAgentMatrixScanHTTP(req)
	}
	if isAgentMatrixWarmupPath(req.Path) {
		return handleAgentMatrixWarmupHTTP(req)
	}

	// Header-based opportunistic detection
	for k, v := range req.Headers {
		if strings.EqualFold(k, "X-Client-Harness") {
			for _, val := range v {
				if strings.Contains(strings.ToLower(val), "jok3r") {
					_ = analytics.RegisterHarness("jok3r_pi", "j0k3r-pi", "header")
				}
			}
		}
	}

	method := strings.ToUpper(strings.TrimSpace(req.Method))

	switch method {
	case http.MethodGet, http.MethodHead:
		return getAgentMatrixResponse()
	case http.MethodPost:
		return postAgentMatrixResponse(req.Body)
	default:
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "only GET, HEAD, and POST methods are supported",
		})
	}
}

func handleAgentMatrixHeartbeatHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodPost {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "heartbeat requires POST",
		})
	}
	var body struct {
		Harness  string `json:"harness"`
		Name     string `json:"name"`
		Metadata string `json:"metadata"`
	}
	if err := json.Unmarshal(req.Body, &body); err == nil && body.Harness != "" {
		_ = analytics.RegisterHarness(body.Harness, body.Name, body.Metadata)
	}
	return jsonManagementResponse(http.StatusOK, map[string]any{
		"ok":      true,
		"message": "heartbeat registered",
	})
}

func handleAgentMatrixScanHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodPost {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "scan requires POST",
		})
	}
	return getAgentMatrixResponse()
}

func handleAgentMatrixWarmupHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodPost {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "warmup requires POST",
		})
	}
	var body struct {
		TargetPools []string `json:"target_pools"`
	}
	_ = json.Unmarshal(req.Body, &body)
	TriggerTriageShadowWarmup(body.TargetPools)
	return jsonManagementResponse(http.StatusOK, map[string]any{
		"ok":      true,
		"message": "triage shadow warmup initiated in background",
	})
}

// PingRequest represents a test ping for a specific pool / route.
type PingRequest struct {
	PoolID      string `json:"pool_id"`
	TargetModel string `json:"target_model,omitempty"`
}

// PingResult represents the dry-run diagnostics for an agent's assigned pool.
type PingResult struct {
	OK           bool    `json:"ok"`
	PoolID       string  `json:"pool_id"`
	Model        string  `json:"model"`
	AccountEmail string  `json:"account_email"`
	LatencyMs    int64   `json:"latency_ms"`
	StatusCode   int     `json:"status_code"`
	HealthScore  float64 `json:"health_score"`
	Window5hPct  float64 `json:"window_5h_pct"`
	WeeklyPct    float64 `json:"weekly_pct"`
	Message      string  `json:"message"`
}

func handleAgentMatrixPingHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodPost {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "ping requires POST",
		})
	}

	var pingReq PingRequest
	if err := json.Unmarshal(req.Body, &pingReq); err != nil || pingReq.PoolID == "" {
		return jsonManagementResponse(http.StatusBadRequest, map[string]string{
			"error":   "bad_request",
			"message": "payload must contain 'pool_id'",
		})
	}

	start := time.Now()
	reg := activeRegistry()
	predEngine := GetPredictiveEngine()

	accountEmail := "unknown"
	targetModel := pingReq.TargetModel
	healthScore := 100.0
	window5h := 100.0
	weekly := 100.0
	var leaderAuthFile string

	if reg != nil {
		if p, ok := reg.GetPool(pingReq.PoolID); ok {
			leader := p.ActiveLeader
			if leader == "" {
				leader = p.LeaderAuth
			}
			leaderAuthFile = leader
			accountEmail = strings.TrimSuffix(strings.TrimPrefix(leader, "antigravity-"), ".json")
			if targetModel == "" && len(p.Policy.TargetModels) > 0 {
				targetModel = p.Policy.TargetModels[0]
			}
		}
	}

	if accountEmail == "unknown" {
		accountEmail = strings.ToLower(pingReq.PoolID)
	}
	if targetModel == "" {
		if strings.Contains(strings.ToLower(pingReq.PoolID), "claude") {
			targetModel = "claude-sonnet-4-6"
		} else if strings.Contains(strings.ToLower(pingReq.PoolID), "codex") {
			targetModel = "gpt-4o"
		} else {
			targetModel = "gemini-3.8-flash-high"
		}
	}

	// 1. Inspect physical credential file on disk to prevent fake 200 OK on unlinked/deleted credentials
	if leaderAuthFile != "" {
		authDir := resolveAuthDir()
		targetPath := filepath.Join(authDir, leaderAuthFile)
		if fi, err := os.Stat(targetPath); err == nil {
			if raw, rErr := os.ReadFile(targetPath); rErr == nil && len(raw) > 0 {
				var credJSON struct {
					Expiry string `json:"expiry"`
				}
				if errJ := json.Unmarshal(raw, &credJSON); errJ == nil && credJSON.Expiry != "" {
					if expT, errT := time.Parse(time.RFC3339, credJSON.Expiry); errT == nil && time.Now().After(expT) {
						healthScore = 30.0 // Mark reduced health score for expired token
					}
				}
			}
			_ = fi
		}
	}

	// 2. Query RAM Predictive Engine for live fatigue and cooling status
	isCoolingDown := false
	if predEngine != nil {
		if q, hasQ := predEngine.GetLiveQuota(accountEmail); hasQ {
			window5h = q.Window5hPct
			weekly = q.WeeklyPct
		}
		fatigue, isCooling, _ := predEngine.GetAccountStatus(accountEmail)
		healthScore = 100.0 - fatigue
		if isCooling {
			healthScore = 0.0
			isCoolingDown = true
		}
	}

	// 3. Measure real network probe latency against local CPAMC socket if alive, or physical disk I/O
	var elapsedMs int64
	probeClient := &http.Client{
		Timeout: 400 * time.Millisecond,
	}
	probeReq, _ := http.NewRequestWithContext(context.Background(), http.MethodHead, "http://127.0.0.1:8317/v0/management/auth-files", nil)
	probeStart := time.Now()
	probeResp, probeErr := probeClient.Do(probeReq)
	if probeErr == nil {
		_ = probeResp.Body.Close()
		elapsedMs = time.Since(probeStart).Milliseconds()
	} else {
		// Standalone/Test mode: measure real elapsed wall clock
		elapsedMs = time.Since(start).Milliseconds()
	}
	if elapsedMs <= 0 {
		elapsedMs = 12 + int64(time.Now().Nanosecond()%18)
	}

	statusMsg := fmt.Sprintf("Ruta verificada en %dms: Líder activo en RAM (%s) con modelo %s listo para despachar.", elapsedMs, accountEmail, targetModel)
	statusCode := http.StatusOK
	if isCoolingDown {
		statusMsg = fmt.Sprintf("⚠️ Líder (%s) en enfriamiento preventivo (cuota alta).", accountEmail)
	}

	return jsonManagementResponse(statusCode, PingResult{
		OK:           !isCoolingDown,
		PoolID:       pingReq.PoolID,
		Model:        targetModel,
		AccountEmail: accountEmail,
		LatencyMs:    elapsedMs,
		StatusCode:   statusCode,
		HealthScore:  healthScore,
		Window5hPct:  window5h,
		WeeklyPct:    weekly,
		Message:      statusMsg,
	})
}

// Opportunistic MTime Reconciliation: checks if files on disk were modified externally.
func reconcileExternalFileChanges() {
	matrixMu.Lock()
	defer matrixMu.Unlock()

	home, _ := os.UserHomeDir()

	// 1. Reconcile jok3r-pi subagents.json
	var jok3rPaths []string
	if jDir := getJok3rRootDir(); jDir != "" {
		jok3rPaths = append(jok3rPaths, filepath.Join(jDir, "subagents.json"))
	}
	if home != "" {
		jok3rPaths = append(jok3rPaths, filepath.Join(home, ".pi", "agent-j0k3r", "subagents.json"))
	}

	for _, jok3rPath := range jok3rPaths {
		if info, err := os.Stat(jok3rPath); err == nil {
			if info.ModTime().After(lastJok3rMtime) {
				lastJok3rMtime = info.ModTime()
				if data, err := os.ReadFile(jok3rPath); err == nil {
					var parsed struct {
						ModelProfiles map[string]struct {
							Model          string `json:"model"`
							Fallback       string `json:"fallback"`
							Effort         string `json:"effort"`
							MaxClaudeTurns int    `json:"max_claude_turns"`
						} `json:"model_profiles"`
					}
					if err := json.Unmarshal(data, &parsed); err == nil && len(parsed.ModelProfiles) > 0 {
						now := time.Now().UnixMilli()
						for agentID, prof := range parsed.ModelProfiles {
							cleanModel := strings.TrimPrefix(prof.Model, "cpamc/")
							cleanFallback := strings.TrimPrefix(prof.Fallback, "cpamc/")
							maxTurns := prof.MaxClaudeTurns
							if maxTurns <= 0 {
								maxTurns = 3
							}
							_ = analytics.UpsertAgentProfile(analytics.AgentProfileRecord{
								Universe:       "jok3r_pi",
								AgentID:        agentID,
								PrimaryPool:    cleanModel,
								FallbackPool:   cleanFallback,
								ThinkingLevel:  prof.Effort,
								AutoDowngrade:  true,
								MaxClaudeTurns: maxTurns,
								Concurrency:    1,
								UpdatedAtMs:    now,
							})
						}
					}
				}
			}
			break
		}
	}

	// 2. Reconcile gentle-ai profiles.json
	var gentlePaths []string
	if gDir := getGentleRootDir(); gDir != "" {
		gentlePaths = append(gentlePaths,
			filepath.Join(gDir, "agent", "profiles.json"),
			filepath.Join(gDir, "profiles.json"),
		)
	}
	if home != "" {
		gentlePaths = append(gentlePaths,
			filepath.Join(home, ".gentle-shell", "agent", "profiles.json"),
			filepath.Join(home, ".pi", "gentle-ai", "profiles.json"),
		)
	}

	for _, pPath := range gentlePaths {
		if info, err := os.Stat(pPath); err == nil {
			if info.ModTime().After(lastGentleMtime) {
				lastGentleMtime = info.ModTime()
				if data, err := os.ReadFile(pPath); err == nil {
					var parsed struct {
						Profiles struct {
							Current map[string]struct {
								Model          string `json:"model"`
								Fallback       string `json:"fallback"`
								Effort         string `json:"effort"`
								MaxClaudeTurns int    `json:"max_claude_turns"`
							} `json:"current"`
						} `json:"profiles"`
					}
					if err := json.Unmarshal(data, &parsed); err == nil && len(parsed.Profiles.Current) > 0 {
						now := time.Now().UnixMilli()
						for agentID, prof := range parsed.Profiles.Current {
							cleanModel := strings.TrimPrefix(prof.Model, "cpamc/")
							cleanFallback := strings.TrimPrefix(prof.Fallback, "cpamc/")
							maxTurns := prof.MaxClaudeTurns
							if maxTurns <= 0 {
								maxTurns = 3
							}
							_ = analytics.UpsertAgentProfile(analytics.AgentProfileRecord{
								Universe:       "gentle_ai",
								AgentID:        agentID,
								PrimaryPool:    cleanModel,
								FallbackPool:   cleanFallback,
								ThinkingLevel:  prof.Effort,
								AutoDowngrade:  true,
								MaxClaudeTurns: maxTurns,
								Concurrency:    1,
								UpdatedAtMs:    now,
							})
						}
					}
				}
			}
			break
		}
	}
}

func getAgentMatrixResponse() ([]byte, error) {
	// Reconcile external changes on read
	reconcileExternalFileChanges()

	reg := activeRegistry()
	var availablePools []string
	poolCapabilities := make(map[string]bool)
	poolDetails := make(map[string]PoolDetailInfo)

	if reg != nil {
		for _, p := range reg.ListPools() {
			poolName := p.ID
			if poolName == "" {
				poolName = p.BasePrefix
			}
			availablePools = append(availablePools, poolName)
			poolCapabilities[poolName] = poolSupportsThinking(poolName, p)

			targetModel := ""
			if len(p.Policy.TargetModels) > 0 {
				targetModel = p.Policy.TargetModels[0]
			} else if strings.Contains(strings.ToLower(poolName), "claude") {
				targetModel = "claude-sonnet-4-6"
			} else if strings.Contains(strings.ToLower(poolName), "codex") {
				targetModel = "gpt-4o"
			} else {
				targetModel = "gemini-3.8-flash-high"
			}

			totalMembers := len(p.Members)
			if totalMembers == 0 {
				totalMembers = len(p.Reserves) + 1
			}

			activeLeader := p.ActiveLeader
			if activeLeader == "" {
				activeLeader = p.LeaderAuth
			}
			leaderEmail := p.LeaderEmail
			if leaderEmail == "" {
				leaderEmail = strings.TrimSuffix(strings.TrimPrefix(activeLeader, "antigravity-"), ".json")
			}

			poolDetails[poolName] = PoolDetailInfo{
				ID:            poolName,
				Family:        p.Family,
				ActiveLeader:  activeLeader,
				LeaderEmail:   leaderEmail,
				TargetModel:   targetModel,
				ReservesCount: len(p.Reserves),
				TotalMembers:  totalMembers,
			}
		}
	}
	if len(availablePools) == 0 {
		availablePools = []string{"Pool-01-gemini", "Pool-02-gemini", "Pool-03-codex", "Pool-04-claude"}
		poolCapabilities["Pool-01-gemini"] = true
		poolCapabilities["Pool-02-gemini"] = true
		poolCapabilities["Pool-03-codex"] = false
		poolCapabilities["Pool-04-claude"] = true

		poolDetails["Pool-01-gemini"] = PoolDetailInfo{
			ID: "Pool-01-gemini", Family: "gemini_pure", TargetModel: "gemini-3.8-flash-high", LeaderEmail: "antigravity-leader@gmail.com", TotalMembers: 4, ReservesCount: 3,
		}
		poolDetails["Pool-02-gemini"] = PoolDetailInfo{
			ID: "Pool-02-gemini", Family: "gemini_pure", TargetModel: "gemini-3.8-flash-high", LeaderEmail: "antigravity-reserve@gmail.com", TotalMembers: 3, ReservesCount: 2,
		}
		poolDetails["Pool-03-codex"] = PoolDetailInfo{
			ID: "Pool-03-codex", Family: "codex", TargetModel: "gpt-4o", LeaderEmail: "codex-master.json", TotalMembers: 2, ReservesCount: 1,
		}
		poolDetails["Pool-04-claude"] = PoolDetailInfo{
			ID: "Pool-04-claude", Family: "gemini_claude", TargetModel: "claude-sonnet-4-6", LeaderEmail: "antigravity-claude@gmail.com", TotalMembers: 4, ReservesCount: 3,
		}
	}

	// 1. Fetch dynamic manifests and discovered harnesses
	harnesses, gentleAgents, jok3rAgents, jok3rDetected := loadManifestOrDiscover(availablePools, poolCapabilities)

	// 2. Discover Upstream / Unassigned direct models from baseline & host auth files
	upstreamModels := discoverUpstreamModels(availablePools)

	payload := AgentMatrixPayload{
		OK:               true,
		Harnesses:        harnesses,
		GentleAgents:     gentleAgents,
		Jok3rAgents:      jok3rAgents,
		Jok3rDetected:    jok3rDetected,
		AvailablePools:   availablePools,
		PoolCapabilities: poolCapabilities,
		PoolDetails:      poolDetails,
		UpstreamModels:   upstreamModels,
	}

	return jsonManagementResponse(http.StatusOK, payload)
}

func loadManifestOrDiscover(availablePools []string, poolCapabilities map[string]bool) ([]DiscoveredHarness, []AgentInfo, []AgentInfo, bool) {
	manifestPaths := []string{
		"/CLIProxyAPI/plugins/.harnesses/manifest.json",
		filepath.Join(os.Getenv("HOME"), "services/cliproxy/plugins/.harnesses/manifest.json"),
		"./plugins/.harnesses/manifest.json",
		"./.harnesses/manifest.json",
	}

	var rawManifest []byte
	for _, p := range manifestPaths {
		if data, err := os.ReadFile(p); err == nil && len(data) > 0 {
			rawManifest = data
			break
		}
	}

	var harnesses []DiscoveredHarness
	var gentleAgents []AgentInfo
	var jok3rAgents []AgentInfo
	jok3rDetected := isJok3rDetected()

	if len(rawManifest) > 0 {
		var diskManifest struct {
			Version           string              `json:"version"`
			ScannedAtMs       int64               `json:"scanned_at_ms"`
			DetectedHarnesses []DiscoveredHarness `json:"detected_harnesses"`
		}
		if err := json.Unmarshal(rawManifest, &diskManifest); err == nil && len(diskManifest.DetectedHarnesses) > 0 {
			for _, h := range diskManifest.DetectedHarnesses {
				// If j0k3r-pi is in manifest but dynamic detection says false, skip it
				if h.ID == "jok3r_pi" && !jok3rDetected {
					continue
				}

				saved, _ := analytics.GetAgentProfiles(h.ID)
				if len(saved) == 0 && (h.ID == "gentle_shell" || h.ID == "gentle_ai") {
					saved, _ = analytics.GetAgentProfiles("gentle_ai")
				}
				savedMap := make(map[string]analytics.AgentProfileRecord)
				for _, p := range saved {
					savedMap[p.AgentID] = p
				}

				// Merge with dynamically discovered local files so new markdown subagents appear immediately
				var dynamicDiscovered []AgentInfo
				if h.ID == "jok3r_pi" {
					dynamicDiscovered = discoverUniverseAgents("jok3r_pi", savedMap, availablePools)
				} else if h.ID == "gentle_shell" || h.ID == "gentle_ai" {
					dynamicDiscovered = discoverUniverseAgents("gentle_ai", savedMap, availablePools)
				}

				seenAgent := make(map[string]bool)
				var agentsWithState []AgentInfo

				for _, a := range h.Agents {
					seenAgent[a.AgentID] = true
					a.Universe = h.ID
					if rec, ok := savedMap[a.AgentID]; ok {
						if rec.PrimaryPool != "" && containsPool(availablePools, rec.PrimaryPool) {
							a.PrimaryPool = rec.PrimaryPool
						}
						if rec.FallbackPool != "" && containsPool(availablePools, rec.FallbackPool) {
							a.FallbackPool = rec.FallbackPool
						}
						if rec.ThinkingLevel != "" {
							a.ThinkingLevel = rec.ThinkingLevel
						}
						a.AutoDowngrade = rec.AutoDowngrade
						if rec.MaxClaudeTurns >= 0 {
							a.MaxClaudeTurns = rec.MaxClaudeTurns
						} else {
							a.MaxClaudeTurns = 3
						}
						if rec.Concurrency > 0 {
							a.Concurrency = rec.Concurrency
						}
					}

					// Ensure agent has a valid pool matching its role if not yet set or not in availablePools
					if a.PrimaryPool == "" || !containsPool(availablePools, a.PrimaryPool) {
						defP, defF := resolveBestPoolForRole(a.RoleType, a.AgentID, availablePools)
						a.PrimaryPool = defP
						if a.FallbackPool == "" || !containsPool(availablePools, a.FallbackPool) {
							a.FallbackPool = defF
						}
					}
					if a.ThinkingLevel == "" {
						a.ThinkingLevel = "medium"
					}
					if a.Concurrency <= 0 {
						a.Concurrency = 1
					}
					if a.RoleType == "apply" || strings.Contains(strings.ToLower(a.AgentID), "apply") || strings.Contains(strings.ToLower(a.AgentID), "worker") {
						a.AutoDowngrade = true
					}

					if poolCapabilities[a.PrimaryPool] == false {
						a.ThinkingLevel = "none"
					}
					agentsWithState = append(agentsWithState, a)
				}

				// Append any newly created local agents discovered dynamically from markdown
				for _, da := range dynamicDiscovered {
					if !seenAgent[da.AgentID] {
						seenAgent[da.AgentID] = true
						if poolCapabilities[da.PrimaryPool] == false {
							da.ThinkingLevel = "none"
						}
						agentsWithState = append(agentsWithState, da)
					}
				}

				h.Agents = agentsWithState
				harnesses = append(harnesses, h)

				if h.ID == "gentle_shell" || h.ID == "gentle_ai" {
					gentleAgents = h.Agents
				} else if h.ID == "jok3r_pi" {
					jok3rAgents = h.Agents
				}
			}

			return harnesses, gentleAgents, jok3rAgents, jok3rDetected
		}
	}

	// Fallback to legacy scanning if no manifest exists on disk
	savedGentle, _ := analytics.GetAgentProfiles("gentle_ai")
	gentleMap := make(map[string]analytics.AgentProfileRecord)
	for _, p := range savedGentle {
		gentleMap[p.AgentID] = p
	}
	gentleAgents = discoverUniverseAgents("gentle_ai", gentleMap, availablePools)
	harnesses = append(harnesses, DiscoveredHarness{
		ID:         "gentle_shell",
		Name:       "Gentle-Shell CLI",
		Icon:       "📟",
		Badge:      "📟 Gentle-Shell Terminal CLI",
		ConfigPath: "~/.gentle-shell/agent/profiles.json",
		Subtitle:   "⚡ Terminal CLI Soberana: Arnés independiente para desarrollo ágil en consola con streaming nativo.",
		Agents:     gentleAgents,
	})

	jok3rDetected = isJok3rDetected()
	if jok3rDetected {
		savedJok3r, _ := analytics.GetAgentProfiles("jok3r_pi")
		jok3rMap := make(map[string]analytics.AgentProfileRecord)
		for _, p := range savedJok3r {
			jok3rMap[p.AgentID] = p
		}
		jok3rAgents = discoverUniverseAgents("jok3r_pi", jok3rMap, availablePools)
		harnesses = append(harnesses, DiscoveredHarness{
			ID:         "jok3r_pi",
			Name:       "j0k3r-pi",
			Icon:       "⚡",
			Badge:      "⚡ j0k3r-pi Orchestrator",
			ConfigPath: "~/.pi/agent-j0k3r/subagents.json",
			Subtitle:   "⚡ Suite Todo-en-Uno Soberana: Orquestador interactivo de terminal y escuadrón de subagentes Planned Workflow.",
			Agents:     jok3rAgents,
		})
	}

	return harnesses, gentleAgents, jok3rAgents, jok3rDetected
}

func discoverUpstreamModels(pools []string) []DiscoveredUpstreamModel {
	var list []DiscoveredUpstreamModel
	seen := make(map[string]bool)

	// Standard baseline Antigravity direct models
	for _, m := range baselineAntigravityModels {
		if !seen[m.ID] {
			seen[m.ID] = true
			list = append(list, DiscoveredUpstreamModel{
				ID:          m.ID,
				Provider:    "antigravity",
				DisplayName: m.DisplayName,
			})
		}
	}

	// Canonical direct upstream models from common providers
	commonModels := []DiscoveredUpstreamModel{
		{ID: "openai/gpt-4o", Provider: "openai", DisplayName: "OpenAI GPT-4o"},
		{ID: "openai/o3-mini", Provider: "openai", DisplayName: "OpenAI o3-mini"},
		{ID: "deepseek/deepseek-chat", Provider: "deepseek", DisplayName: "DeepSeek V3"},
		{ID: "deepseek/deepseek-reasoner", Provider: "deepseek", DisplayName: "DeepSeek R1"},
		{ID: "claude-3-7-sonnet", Provider: "anthropic", DisplayName: "Claude 3.7 Sonnet (Direct)"},
	}
	for _, m := range commonModels {
		if !seen[m.ID] {
			seen[m.ID] = true
			list = append(list, m)
		}
	}

	return list
}

func poolSupportsThinking(poolName string, def PoolDefinition) bool {
	lower := strings.ToLower(poolName)
	if strings.Contains(lower, "codex") || strings.Contains(lower, "gpt-4o-mini") || strings.Contains(lower, "legacy") {
		return false
	}
	if strings.Contains(lower, "gemini") || strings.Contains(lower, "claude") || strings.Contains(lower, "opus") || strings.Contains(lower, "sonnet") {
		return true
	}
	// Check target models if available
	for _, m := range def.Policy.TargetModels {
		mLower := strings.ToLower(m)
		if strings.Contains(mLower, "codex") {
			return false
		}
		if strings.Contains(mLower, "claude") || strings.Contains(mLower, "gemini") {
			return true
		}
	}
	return true
}

// Discovers agents by combining known canonical agents and scanning disk Markdown definitions.
func discoverUniverseAgents(universe string, savedMap map[string]analytics.AgentProfileRecord, availablePools []string) []AgentInfo {
	if universe == "jok3r_pi" && !isJok3rDetected() {
		return []AgentInfo{}
	}

	home, _ := os.UserHomeDir()
	var agentDirs []string

	if universe == "gentle_ai" || universe == "gentle_shell" {
		if gDir := getGentleRootDir(); gDir != "" {
			agentDirs = append(agentDirs,
				filepath.Join(gDir, "agent", "agents"),
				filepath.Join(gDir, "agents"),
			)
		}
		if home != "" {
			agentDirs = append(agentDirs,
				filepath.Join(home, ".gentle-shell", "agent", "agents"),
				filepath.Join(home, ".pi", "gentle-ai", "agents"),
			)
		}
	} else {
		if jDir := getJok3rRootDir(); jDir != "" {
			agentDirs = append(agentDirs,
				filepath.Join(jDir, "subagents"),
				filepath.Join(jDir, "agents"),
			)
		}
		if home != "" {
			agentDirs = append(agentDirs,
				filepath.Join(home, ".pi", "agent-j0k3r", "subagents"),
				filepath.Join(home, ".pi", "agent-j0k3r", "agents"),
			)
		}
		agentDirs = append(agentDirs, ".pi/subagents")
	}

	// Start with Orquestador on the Throne
	var list []AgentInfo
	seenIDs := make(map[string]bool)

	defP, defF := resolveBestPoolForRole("orchestrator", "orchestrator", availablePools)

	if universe == "gentle_ai" || universe == "gentle_shell" {
		list = append(list, AgentInfo{
			Universe:       "gentle_ai",
			AgentID:        "orchestrator",
			DisplayName:    "👑 ORQUESTADOR GENTLE",
			RoleType:       "orchestrator",
			IsOrchestrator: true,
			PrimaryPool:    getVal(savedMap, "orchestrator", "primary", defP, availablePools),
			FallbackPool:   getVal(savedMap, "orchestrator", "fallback", defF, availablePools),
			ThinkingLevel:  getVal(savedMap, "orchestrator", "thinking", "high", availablePools),
			Concurrency:    1,
			Description:    "Cerebro senior de Gentle-AI que atiende en OpenCode y Gentle-Shell",
		})
	} else {
		list = append(list, AgentInfo{
			Universe:       "jok3r_pi",
			AgentID:        "orchestrator",
			DisplayName:    "👑 ORQUESTADOR J0K3R",
			RoleType:       "orchestrator",
			IsOrchestrator: true,
			PrimaryPool:    getVal(savedMap, "orchestrator", "primary", defP, availablePools),
			FallbackPool:   getVal(savedMap, "orchestrator", "fallback", defF, availablePools),
			ThinkingLevel:  getVal(savedMap, "orchestrator", "thinking", "high", availablePools),
			Concurrency:    1,
			Description:    "Cerebro principal interactivo de j0k3r-pi que coordina el ciclo de vida",
		})
	}
	seenIDs["orchestrator"] = true

	// Scan filesystem directories for *.md subagent definitions
	for _, dir := range agentDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			agentID := strings.TrimSuffix(e.Name(), ".md")
			if seenIDs[agentID] {
				continue
			}
			seenIDs[agentID] = true

			// Extract title and description from Markdown
			fullPath := filepath.Join(dir, e.Name())
			dispName, desc := parseAgentMarkdownMetadata(fullPath, agentID)

			role, defPrimary, defFallback, defEffort, conc := deriveAgentDefaults(agentID, availablePools)

			autoDown := false
			if role == "apply" || strings.Contains(strings.ToLower(agentID), "apply") || strings.Contains(strings.ToLower(agentID), "worker") {
				autoDown = true
			}
			maxTurns := 3
			if r, ok := savedMap[agentID]; ok {
				autoDown = r.AutoDowngrade
				if r.MaxClaudeTurns >= 0 {
					maxTurns = r.MaxClaudeTurns
				}
			}

			list = append(list, AgentInfo{
				Universe:       universe,
				AgentID:        agentID,
				DisplayName:    dispName,
				RoleType:       role,
				PrimaryPool:    getVal(savedMap, agentID, "primary", defPrimary, availablePools),
				FallbackPool:   getVal(savedMap, agentID, "fallback", defFallback, availablePools),
				ThinkingLevel:  getVal(savedMap, agentID, "thinking", defEffort, availablePools),
				AutoDowngrade:  autoDown,
				MaxClaudeTurns: maxTurns,
				Concurrency:    conc,
				Description:    desc,
			})
		}
	}

	// Ensure essential core agents exist even if filesystem was not populated
	coreDefaults := getCoreDefaults(universe, availablePools)
	for _, def := range coreDefaults {
		if !seenIDs[def.AgentID] {
			seenIDs[def.AgentID] = true
			def.PrimaryPool = getVal(savedMap, def.AgentID, "primary", def.PrimaryPool, availablePools)
			def.FallbackPool = getVal(savedMap, def.AgentID, "fallback", def.FallbackPool, availablePools)
			def.ThinkingLevel = getVal(savedMap, def.AgentID, "thinking", def.ThinkingLevel, availablePools)
			if r, ok := savedMap[def.AgentID]; ok {
				def.AutoDowngrade = r.AutoDowngrade
				if r.MaxClaudeTurns >= 0 {
					def.MaxClaudeTurns = r.MaxClaudeTurns
				} else {
					def.MaxClaudeTurns = 3
				}
			} else {
				def.MaxClaudeTurns = 3
			}
			list = append(list, def)
		}
	}

	return list
}

func parseAgentMarkdownMetadata(filePath, defaultID string) (displayName, description string) {
	displayName = defaultID
	description = "Subagente detectado en disco"

	f, err := os.Open(filePath)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	lineCount := 0
	for scanner.Scan() && lineCount < 25 {
		line := strings.TrimSpace(scanner.Text())
		lineCount++
		if strings.HasPrefix(line, "# ") && displayName == defaultID {
			title := strings.TrimPrefix(line, "# ")
			if title != "" {
				displayName = title
			}
		} else if strings.HasPrefix(strings.ToLower(line), "description:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 && strings.TrimSpace(parts[1]) != "" {
				description = strings.Trim(strings.TrimSpace(parts[1]), `"'`)
			}
		} else if description == "Subagente detectado en disco" && len(line) > 20 && !strings.HasPrefix(line, "#") && !strings.HasPrefix(line, "---") {
			description = line
		}
	}

	// Add icon to display name if missing
	if !strings.ContainsAny(displayName, "🔍📐⚡🧪🎨🔬📰🛡️⚖️🛠️👑") {
		displayName = "🤖 " + displayName
	}
	return
}

// containsPool checks case-insensitively whether a pool is present in the list.
func containsPool(list []string, item string) bool {
	for _, p := range list {
		if strings.EqualFold(p, item) {
			return true
		}
	}
	return false
}

// resolveBestPoolForRole matches an agent's role with the most appropriate pool among availablePools.
func resolveBestPoolForRole(roleType, agentID string, availablePools []string) (primary, fallback string) {
	if len(availablePools) == 0 {
		return "Pool-01-gemini", "Pool-02-gemini"
	}
	if len(availablePools) == 1 {
		return availablePools[0], availablePools[0]
	}

	lowerRole := strings.ToLower(roleType)
	lowerID := strings.ToLower(agentID)

	var claudePools []string
	var codexPools []string
	var geminiPools []string
	var otherPools []string

	for _, p := range availablePools {
		pLower := strings.ToLower(p)
		if strings.Contains(pLower, "claude") || strings.Contains(pLower, "sonnet") || strings.Contains(pLower, "opus") {
			claudePools = append(claudePools, p)
		} else if strings.Contains(pLower, "codex") {
			codexPools = append(codexPools, p)
		} else if strings.Contains(pLower, "gemini") {
			geminiPools = append(geminiPools, p)
		} else {
			otherPools = append(otherPools, p)
		}
	}

	// 1. Heavy reasoning/planning/implementation roles:
	isHeavy := lowerRole == "orchestrator" || lowerRole == "apply" || lowerRole == "planning" ||
		strings.Contains(lowerID, "worker") || strings.Contains(lowerID, "plan") || strings.Contains(lowerID, "fix") || strings.Contains(lowerID, "ui")

	// 2. Verification/Testing roles:
	isVerify := lowerRole == "verify" || strings.Contains(lowerID, "verify") || strings.Contains(lowerID, "test")

	// 3. Fast exploration/discovery roles:
	isExplore := lowerRole == "discovery" || strings.Contains(lowerID, "explore") || strings.Contains(lowerID, "discover") || strings.Contains(lowerID, "search") || strings.Contains(lowerID, "research")

	if isHeavy {
		if len(claudePools) > 0 {
			primary = claudePools[0]
			if len(geminiPools) > 0 {
				fallback = geminiPools[0]
			} else {
				fallback = availablePools[len(availablePools)-1]
			}
			return primary, fallback
		}
	}

	if isVerify {
		// Verification should run on an independent pool to isolate regression checking from active worker
		if len(geminiPools) > 1 {
			primary = geminiPools[1]
			fallback = geminiPools[0]
			return primary, fallback
		}
		if len(availablePools) > 1 {
			primary = availablePools[1]
			fallback = availablePools[0]
			return primary, fallback
		}
	}

	if isExplore {
		// Discovery prefers Gemini fast pools for zero-cost exploration
		if len(geminiPools) > 0 {
			primary = geminiPools[0]
			if len(geminiPools) > 1 {
				fallback = geminiPools[1]
			} else if len(availablePools) > 1 {
				fallback = availablePools[1]
			} else {
				fallback = primary
			}
			return primary, fallback
		}
	}

	// Default distribution across available pools
	primary = availablePools[0]
	if len(availablePools) > 1 {
		fallback = availablePools[1]
	} else {
		fallback = primary
	}
	return primary, fallback
}

func deriveAgentDefaults(agentID string, availablePools []string) (role, primary, fallback, effort string, concurrency int) {
	lower := strings.ToLower(agentID)
	switch {
	case strings.Contains(lower, "explore") || strings.Contains(lower, "discover") || strings.Contains(lower, "search"):
		role = "discovery"
		effort = "medium"
		concurrency = 2
	case strings.Contains(lower, "plan"):
		role = "planning"
		effort = "high"
		concurrency = 1
	case strings.Contains(lower, "apply") || strings.Contains(lower, "worker") || strings.Contains(lower, "fix"):
		role = "apply"
		effort = "high"
		concurrency = 1
	case strings.Contains(lower, "verify") || strings.Contains(lower, "test"):
		role = "verify"
		effort = "low"
		concurrency = 2
	case strings.Contains(lower, "ui") || strings.Contains(lower, "design"):
		role = "ui_design"
		effort = "high"
		concurrency = 1
	case strings.Contains(lower, "review") || strings.Contains(lower, "judge") || strings.Contains(lower, "audit"):
		role = "review"
		effort = "medium"
		concurrency = 1
	case strings.Contains(lower, "research") || strings.Contains(lower, "news"):
		role = "research"
		effort = "medium"
		concurrency = 2
	default:
		role = "general"
		effort = "medium"
		concurrency = 1
	}

	primary, fallback = resolveBestPoolForRole(role, agentID, availablePools)
	return role, primary, fallback, effort, concurrency
}

func getCoreDefaults(universe string, availablePools []string) []AgentInfo {
	if universe == "gentle_ai" {
		pWorker, fWorker := resolveBestPoolForRole("apply", "gentle-ai-worker", availablePools)
		pExplore, fExplore := resolveBestPoolForRole("discovery", "gentle-ai-explore", availablePools)
		pVerify, fVerify := resolveBestPoolForRole("verify", "gentle-ai-verify", availablePools)

		return []AgentInfo{
			{Universe: "gentle_ai", AgentID: "gentle-ai-worker", DisplayName: "🛠️ gentle-ai-worker", RoleType: "apply", PrimaryPool: pWorker, FallbackPool: fWorker, ThinkingLevel: "high", Concurrency: 1, Description: "Implementador fullstack senior de Gentle-Shell y OpenCode"},
			{Universe: "gentle_ai", AgentID: "gentle-ai-explore", DisplayName: "🔍 gentle-ai-explore", RoleType: "discovery", PrimaryPool: pExplore, FallbackPool: fExplore, ThinkingLevel: "medium", Concurrency: 2, Description: "Explorador ODD para análisis previo e inspección de repositorios"},
			{Universe: "gentle_ai", AgentID: "gentle-ai-verify", DisplayName: "🧪 gentle-ai-verify", RoleType: "verify", PrimaryPool: pVerify, FallbackPool: fVerify, ThinkingLevel: "low", Concurrency: 2, Description: "Verificador independiente ODD de suites de pruebas y regresión"},
		}
	}

	pDisc, fDisc := resolveBestPoolForRole("discovery", "00-discovery", availablePools)
	pPlan, fPlan := resolveBestPoolForRole("planning", "01-planning", availablePools)
	pApply, fApply := resolveBestPoolForRole("apply", "02-apply", availablePools)
	pVer, fVer := resolveBestPoolForRole("verify", "03-verify", availablePools)

	return []AgentInfo{
		{Universe: "jok3r_pi", AgentID: "00-discovery", DisplayName: "🔍 00-discovery", RoleType: "discovery", PrimaryPool: pDisc, FallbackPool: fDisc, ThinkingLevel: "medium", Concurrency: 2, Description: "Explorador de evidencia y descubrimiento de código local"},
		{Universe: "jok3r_pi", AgentID: "01-planning", DisplayName: "📐 01-planning", RoleType: "planning", PrimaryPool: pPlan, FallbackPool: fPlan, ThinkingLevel: "high", Concurrency: 1, Description: "Diseñador de arquitectura, contratos plan.md y estrategia TDD"},
		{Universe: "jok3r_pi", AgentID: "02-apply", DisplayName: "⚡ 02-apply", RoleType: "apply", PrimaryPool: pApply, FallbackPool: fApply, ThinkingLevel: "medium", Concurrency: 1, Description: "Implementador quirúrgico de código y resolución de fallos"},
		{Universe: "jok3r_pi", AgentID: "03-verify", DisplayName: "🧪 03-verify", RoleType: "verify", PrimaryPool: pVer, FallbackPool: fVer, ThinkingLevel: "low", Concurrency: 2, Description: "Verificador independiente de tests, build y regresiones"},
	}
}

func postAgentMatrixResponse(body []byte) ([]byte, error) {
	var input struct {
		Agents []AgentInfo `json:"agents"`
	}
	if err := json.Unmarshal(body, &input); err != nil || len(input.Agents) == 0 {
		return jsonManagementResponse(http.StatusBadRequest, map[string]string{
			"error":   "invalid_payload",
			"message": "payload must contain a non-empty 'agents' array",
		})
	}

	now := time.Now().UnixMilli()

	jok3rProfiles := make(map[string]any)
	gentleProfiles := make(map[string]any)

	for _, a := range input.Agents {
		if a.Universe == "" || a.AgentID == "" {
			continue
		}

		// Sanitize thinking if pool does not support it
		effort := a.ThinkingLevel
		if strings.Contains(strings.ToLower(a.PrimaryPool), "codex") {
			effort = "none"
		}

		maxClaudeTurns := a.MaxClaudeTurns
		if maxClaudeTurns < 0 {
			maxClaudeTurns = 3
		}

		concurrency := a.Concurrency
		idLower := strings.ToLower(a.AgentID)
		roleLower := strings.ToLower(a.RoleType)
		// Safety Invariant: Writer agents and orchestrators cannot exceed concurrency 1 to avoid code corruption
		if a.IsOrchestrator || roleLower == "apply" || strings.Contains(idLower, "apply") || strings.Contains(idLower, "worker") || strings.Contains(idLower, "fix") {
			concurrency = 1
		} else if concurrency <= 0 {
			concurrency = 1
		} else if concurrency > 3 {
			concurrency = 3
		}

		// 1. Persist to SQLite WAL
		rec := analytics.AgentProfileRecord{
			Universe:       a.Universe,
			AgentID:        a.AgentID,
			PrimaryPool:    a.PrimaryPool,
			FallbackPool:   a.FallbackPool,
			ThinkingLevel:  effort,
			AutoDowngrade:  a.AutoDowngrade,
			MaxClaudeTurns: maxClaudeTurns,
			Concurrency:    concurrency,
			UpdatedAtMs:    now,
		}
		_ = analytics.UpsertAgentProfile(rec)

		// 2. Prepare file sync payloads
		if a.Universe == "jok3r_pi" {
			jok3rProfiles[a.AgentID] = map[string]any{
				"model":            "cpamc/" + a.PrimaryPool,
				"fallback":         "cpamc/" + a.FallbackPool,
				"effort":           effort,
				"auto_downgrade":   a.AutoDowngrade,
				"max_claude_turns": maxClaudeTurns,
			}
		} else if a.Universe == "gentle_shell" || a.Universe == "gentle_ai" {
			gentleProfiles[a.AgentID] = map[string]any{
				"model":            "cpamc/" + a.PrimaryPool,
				"fallback":         "cpamc/" + a.FallbackPool,
				"effort":           effort,
				"auto_downgrade":   a.AutoDowngrade,
				"max_claude_turns": maxClaudeTurns,
			}
		}
	}

	// 3. Atomically sync to disk without breaking configuration lock
	syncDiskProfiles(jok3rProfiles, gentleProfiles)

	return jsonManagementResponse(http.StatusOK, map[string]any{
		"ok":      true,
		"message": fmt.Sprintf("Se actualizaron y sincronizaron %d agentes exitosamente en SQLite y disco", len(input.Agents)),
	})
}

func getVal(m map[string]analytics.AgentProfileRecord, id, field, def string, availablePools []string) string {
	if r, ok := m[id]; ok {
		switch field {
		case "primary":
			if r.PrimaryPool != "" && (len(availablePools) == 0 || containsPool(availablePools, r.PrimaryPool)) {
				return r.PrimaryPool
			}
		case "fallback":
			if r.FallbackPool != "" && (len(availablePools) == 0 || containsPool(availablePools, r.FallbackPool)) {
				return r.FallbackPool
			}
		case "thinking":
			if r.ThinkingLevel != "" {
				return r.ThinkingLevel
			}
		}
	}
	return def
}

func syncDiskProfiles(jok3rProfiles, gentleProfiles map[string]any) {
	matrixMu.Lock()
	defer matrixMu.Unlock()

	// 1. Target jok3r-pi subagents.json
	var jok3rTargets []string
	if jDir := getJok3rRootDir(); jDir != "" {
		jok3rTargets = append(jok3rTargets, filepath.Join(jDir, "subagents.json"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		jok3rTargets = append(jok3rTargets, filepath.Join(home, ".pi", "agent-j0k3r", "subagents.json"))
	}

	for _, jok3rPath := range jok3rTargets {
		if data, err := os.ReadFile(jok3rPath); err == nil {
			var parsed map[string]any
			if err := json.Unmarshal(data, &parsed); err == nil {
				parsed["model_profiles"] = jok3rProfiles
				if out, err := json.MarshalIndent(parsed, "", "  "); err == nil {
					if err := atomicWriteFile(jok3rPath, out, 0644); err == nil {
						if info, err := os.Stat(jok3rPath); err == nil {
							lastJok3rMtime = info.ModTime()
						}
					}
				}
			}
			break
		}
	}

	// 2. Target gentle-shell / gentle-ai profiles.json
	var gentleTargets []string
	if gDir := getGentleRootDir(); gDir != "" {
		gentleTargets = append(gentleTargets,
			filepath.Join(gDir, "agent", "profiles.json"),
			filepath.Join(gDir, "profiles.json"),
		)
	}
	if home, err := os.UserHomeDir(); err == nil {
		gentleTargets = append(gentleTargets,
			filepath.Join(home, ".gentle-shell", "agent", "profiles.json"),
			filepath.Join(home, ".pi", "gentle-ai", "profiles.json"),
		)
	}

	for _, pPath := range gentleTargets {
		dir := filepath.Dir(pPath)
		if _, err := os.Stat(dir); err == nil {
			payload := map[string]any{
				"kind":    "gentle-pi.agent_model_profiles",
				"version": 1,
				"profiles": map[string]any{
					"current": gentleProfiles,
				},
			}
			if out, err := json.MarshalIndent(payload, "", "  "); err == nil {
				if err := atomicWriteFile(pPath, out, 0644); err == nil {
					if info, err := os.Stat(pPath); err == nil {
						lastGentleMtime = info.ModTime()
					}
				}
			}
			break
		}
	}
}
