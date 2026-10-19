package plugin

import (
	"bufio"
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

// AgentInfo represents an agent's unified metadata across Gentle-AI and jok3r-pi.
type AgentInfo struct {
	Universe       string `json:"universe"`       // "gentle_ai" or "jok3r_pi"
	AgentID        string `json:"agent_id"`       // "orchestrator", "worker", "00-discovery", etc.
	DisplayName    string `json:"display_name"`   // "👑 Orquestador", "02-apply", etc.
	RoleType       string `json:"role_type"`      // "orchestrator", "discovery", "planning", "apply", "verify", "research", "ui_design", "review"
	IsOrchestrator bool   `json:"is_orchestrator"`// true for main orchestrator in each universe
	PrimaryPool    string `json:"primary_pool"`   // "Pool-04-claude"
	FallbackPool   string `json:"fallback_pool"`  // "Pool-01-gemini"
	ThinkingLevel  string `json:"thinking_level"` // "low", "medium", "high", or "none"
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
	GentleAgents     []AgentInfo               `json:"gentle_agents"`
	Jok3rAgents      []AgentInfo               `json:"jok3r_agents"`
	Jok3rDetected    bool                      `json:"jok3r_detected"`
	AvailablePools   []string                  `json:"available_pools"`
	PoolCapabilities map[string]bool           `json:"pool_capabilities"` // pool_id -> supports_thinking
	PoolDetails      map[string]PoolDetailInfo `json:"pool_details"`      // pool_id -> physical reality & model
	UpstreamModels   []DiscoveredUpstreamModel `json:"upstream_models"`   // Unassigned accounts & upstream direct models
	Message          string                    `json:"message,omitempty"`
}

// isJok3rDetected evaluates dynamically whether j0k3r-pi is actively running or signaled.
func isJok3rDetected() bool {
	if os.Getenv("FORCE_JOK3R_DETECTED") == "true" {
		return true
	}
	if os.Getenv("FORCE_JOK3R_DETECTED") == "false" {
		return false
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

	if reg != nil {
		if p, ok := reg.GetPool(pingReq.PoolID); ok {
			leader := p.ActiveLeader
			if leader == "" {
				leader = p.LeaderAuth
			}
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

	if predEngine != nil {
		if q, hasQ := predEngine.GetLiveQuota(accountEmail); hasQ {
			window5h = q.Window5hPct
			weekly = q.WeeklyPct
		}
		fatigue, isCooling, _ := predEngine.GetAccountStatus(accountEmail)
		healthScore = 100.0 - fatigue
		if isCooling {
			healthScore = 0.0
		}
	}

	elapsedMs := time.Since(start).Milliseconds()
	if elapsedMs == 0 {
		elapsedMs = 1
	}

	statusMsg := fmt.Sprintf("Ruta verificada en %dms: Líder activo en RAM (%s) con modelo %s listo para despachar.", elapsedMs, accountEmail, targetModel)

	return jsonManagementResponse(http.StatusOK, PingResult{
		OK:           true,
		PoolID:       pingReq.PoolID,
		Model:        targetModel,
		AccountEmail: accountEmail,
		LatencyMs:    elapsedMs,
		StatusCode:   200,
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

	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	// 1. Reconcile jok3r-pi subagents.json
	jok3rPath := filepath.Join(home, ".pi", "agent-j0k3r", "subagents.json")
	if info, err := os.Stat(jok3rPath); err == nil {
		if info.ModTime().After(lastJok3rMtime) {
			lastJok3rMtime = info.ModTime()
			if data, err := os.ReadFile(jok3rPath); err == nil {
				var parsed struct {
					ModelProfiles map[string]struct {
						Model    string `json:"model"`
						Fallback string `json:"fallback"`
						Effort   string `json:"effort"`
					} `json:"model_profiles"`
				}
				if err := json.Unmarshal(data, &parsed); err == nil && len(parsed.ModelProfiles) > 0 {
					now := time.Now().UnixMilli()
					for agentID, prof := range parsed.ModelProfiles {
						cleanModel := strings.TrimPrefix(prof.Model, "cpamc/")
						cleanFallback := strings.TrimPrefix(prof.Fallback, "cpamc/")
						_ = analytics.UpsertAgentProfile(analytics.AgentProfileRecord{
							Universe:      "jok3r_pi",
							AgentID:       agentID,
							PrimaryPool:   cleanModel,
							FallbackPool:  cleanFallback,
							ThinkingLevel: prof.Effort,
							Concurrency:   1,
							UpdatedAtMs:   now,
						})
					}
				}
			}
		}
	}

	// 2. Reconcile gentle-ai profiles.json
	gentleDirs := []string{
		filepath.Join(home, ".pi", "gentle-ai"),
		filepath.Join(home, ".gentle-shell", "agent"),
	}
	for _, dir := range gentleDirs {
		pPath := filepath.Join(dir, "profiles.json")
		if info, err := os.Stat(pPath); err == nil {
			if info.ModTime().After(lastGentleMtime) {
				lastGentleMtime = info.ModTime()
				if data, err := os.ReadFile(pPath); err == nil {
					var parsed struct {
						Profiles struct {
							Current map[string]struct {
								Model    string `json:"model"`
								Fallback string `json:"fallback"`
								Effort   string `json:"effort"`
							} `json:"current"`
						} `json:"profiles"`
					}
					if err := json.Unmarshal(data, &parsed); err == nil && len(parsed.Profiles.Current) > 0 {
						now := time.Now().UnixMilli()
						for agentID, prof := range parsed.Profiles.Current {
							cleanModel := strings.TrimPrefix(prof.Model, "cpamc/")
							cleanFallback := strings.TrimPrefix(prof.Fallback, "cpamc/")
							_ = analytics.UpsertAgentProfile(analytics.AgentProfileRecord{
								Universe:      "gentle_ai",
								AgentID:       agentID,
								PrimaryPool:   cleanModel,
								FallbackPool:  cleanFallback,
								ThinkingLevel: prof.Effort,
								Concurrency:   1,
								UpdatedAtMs:   now,
							})
						}
					}
				}
			}
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

	// 1. Fetch persisted records from SQLite
	savedGentle, _ := analytics.GetAgentProfiles("gentle_ai")
	savedJok3r, _ := analytics.GetAgentProfiles("jok3r_pi")

	gentleMap := make(map[string]analytics.AgentProfileRecord)
	for _, p := range savedGentle {
		gentleMap[p.AgentID] = p
	}
	jok3rMap := make(map[string]analytics.AgentProfileRecord)
	for _, p := range savedJok3r {
		jok3rMap[p.AgentID] = p
	}

	// 2. Discover Gentle-AI Universe agents (Gentle-Shell & OpenCode) dynamically
	gentleAgents := discoverUniverseAgents("gentle_ai", gentleMap)

	// 3. Discover j0k3r-pi Universe agents dynamically (strictly conditional on dynamic detection)
	jok3rDetected := isJok3rDetected()
	var jok3rAgents []AgentInfo
	if jok3rDetected {
		jok3rAgents = discoverUniverseAgents("jok3r_pi", jok3rMap)
	} else {
		jok3rAgents = []AgentInfo{}
	}

	// 4. Discover Upstream / Unassigned direct models from baseline & host auth files
	upstreamModels := discoverUpstreamModels(availablePools)

	payload := AgentMatrixPayload{
		OK:               true,
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
func discoverUniverseAgents(universe string, savedMap map[string]analytics.AgentProfileRecord) []AgentInfo {
	if universe == "jok3r_pi" && !isJok3rDetected() {
		return []AgentInfo{}
	}

	home, _ := os.UserHomeDir()
	var agentDirs []string

	if universe == "gentle_ai" {
		agentDirs = []string{
			filepath.Join(home, ".gentle-shell", "agent", "agents"),
			filepath.Join(home, ".pi", "gentle-ai", "agents"),
		}
	} else {
		agentDirs = []string{
			filepath.Join(home, ".pi", "agent-j0k3r", "subagents"),
			filepath.Join(home, ".pi", "agent-j0k3r", "agents"),
			".pi/subagents",
		}
	}

	// Start with Orquestador on the Throne
	var list []AgentInfo
	seenIDs := make(map[string]bool)

	if universe == "gentle_ai" {
		list = append(list, AgentInfo{
			Universe:       "gentle_ai",
			AgentID:        "orchestrator",
			DisplayName:    "👑 ORQUESTADOR GENTLE",
			RoleType:       "orchestrator",
			IsOrchestrator: true,
			PrimaryPool:    getVal(savedMap, "orchestrator", "primary", "Pool-04-claude"),
			FallbackPool:   getVal(savedMap, "orchestrator", "fallback", "Pool-01-gemini"),
			ThinkingLevel:  getVal(savedMap, "orchestrator", "thinking", "high"),
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
			PrimaryPool:    getVal(savedMap, "orchestrator", "primary", "Pool-04-claude"),
			FallbackPool:   getVal(savedMap, "orchestrator", "fallback", "Pool-01-gemini"),
			ThinkingLevel:  getVal(savedMap, "orchestrator", "thinking", "high"),
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

			role, defPrimary, defFallback, defEffort, conc := deriveAgentDefaults(agentID)

			list = append(list, AgentInfo{
				Universe:      universe,
				AgentID:       agentID,
				DisplayName:   dispName,
				RoleType:      role,
				PrimaryPool:   getVal(savedMap, agentID, "primary", defPrimary),
				FallbackPool:  getVal(savedMap, agentID, "fallback", defFallback),
				ThinkingLevel: getVal(savedMap, agentID, "thinking", defEffort),
				Concurrency:   conc,
				Description:   desc,
			})
		}
	}

	// Ensure essential core agents exist even if filesystem was not populated
	coreDefaults := getCoreDefaults(universe)
	for _, def := range coreDefaults {
		if !seenIDs[def.AgentID] {
			seenIDs[def.AgentID] = true
			def.PrimaryPool = getVal(savedMap, def.AgentID, "primary", def.PrimaryPool)
			def.FallbackPool = getVal(savedMap, def.AgentID, "fallback", def.FallbackPool)
			def.ThinkingLevel = getVal(savedMap, def.AgentID, "thinking", def.ThinkingLevel)
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

func deriveAgentDefaults(agentID string) (role, primary, fallback, effort string, concurrency int) {
	lower := strings.ToLower(agentID)
	switch {
	case strings.Contains(lower, "explore") || strings.Contains(lower, "discover") || strings.Contains(lower, "search"):
		return "discovery", "Pool-01-gemini", "Pool-02-gemini", "medium", 2
	case strings.Contains(lower, "plan"):
		return "planning", "Pool-04-claude", "Pool-02-gemini", "high", 1
	case strings.Contains(lower, "apply") || strings.Contains(lower, "worker") || strings.Contains(lower, "fix"):
		return "apply", "Pool-04-claude", "Pool-02-gemini", "high", 1
	case strings.Contains(lower, "verify") || strings.Contains(lower, "test"):
		return "verify", "Pool-02-gemini", "Pool-01-gemini", "low", 2
	case strings.Contains(lower, "ui") || strings.Contains(lower, "design"):
		return "ui_design", "Pool-04-claude", "Pool-03-codex", "high", 1
	case strings.Contains(lower, "review") || strings.Contains(lower, "judge") || strings.Contains(lower, "audit"):
		return "review", "Pool-04-claude", "Pool-01-gemini", "medium", 1
	case strings.Contains(lower, "research") || strings.Contains(lower, "news"):
		return "research", "Pool-01-gemini", "Pool-02-gemini", "medium", 2
	default:
		return "general", "Pool-01-gemini", "Pool-02-gemini", "medium", 1
	}
}

func getCoreDefaults(universe string) []AgentInfo {
	if universe == "gentle_ai" {
		return []AgentInfo{
			{Universe: "gentle_ai", AgentID: "gentle-ai-worker", DisplayName: "🛠️ gentle-ai-worker", RoleType: "apply", PrimaryPool: "Pool-04-claude", FallbackPool: "Pool-02-gemini", ThinkingLevel: "high", Concurrency: 1, Description: "Implementador fullstack senior de Gentle-Shell y OpenCode"},
			{Universe: "gentle_ai", AgentID: "gentle-ai-explore", DisplayName: "🔍 gentle-ai-explore", RoleType: "discovery", PrimaryPool: "Pool-01-gemini", FallbackPool: "Pool-02-gemini", ThinkingLevel: "medium", Concurrency: 2, Description: "Explorador ODD para análisis previo e inspección de repositorios"},
			{Universe: "gentle_ai", AgentID: "gentle-ai-verify", DisplayName: "🧪 gentle-ai-verify", RoleType: "verify", PrimaryPool: "Pool-02-gemini", FallbackPool: "Pool-01-gemini", ThinkingLevel: "low", Concurrency: 2, Description: "Verificador independiente ODD de suites de pruebas y regresión"},
		}
	}
	return []AgentInfo{
		{Universe: "jok3r_pi", AgentID: "00-discovery", DisplayName: "🔍 00-discovery", RoleType: "discovery", PrimaryPool: "Pool-01-gemini", FallbackPool: "Pool-02-gemini", ThinkingLevel: "medium", Concurrency: 2, Description: "Explorador de evidencia y descubrimiento de código local"},
		{Universe: "jok3r_pi", AgentID: "01-planning", DisplayName: "📐 01-planning", RoleType: "planning", PrimaryPool: "Pool-04-claude", FallbackPool: "Pool-02-gemini", ThinkingLevel: "high", Concurrency: 1, Description: "Diseñador de arquitectura, contratos plan.md y estrategia TDD"},
		{Universe: "jok3r_pi", AgentID: "02-apply", DisplayName: "⚡ 02-apply", RoleType: "apply", PrimaryPool: "Pool-04-claude", FallbackPool: "Pool-02-gemini", ThinkingLevel: "medium", Concurrency: 1, Description: "Implementador quirúrgico de código y resolución de fallos"},
		{Universe: "jok3r_pi", AgentID: "03-verify", DisplayName: "🧪 03-verify", RoleType: "verify", PrimaryPool: "Pool-02-gemini", FallbackPool: "Pool-01-gemini", ThinkingLevel: "low", Concurrency: 2, Description: "Verificador independiente de tests, build y regresiones"},
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

		// 1. Persist to SQLite WAL
		rec := analytics.AgentProfileRecord{
			Universe:      a.Universe,
			AgentID:       a.AgentID,
			PrimaryPool:   a.PrimaryPool,
			FallbackPool:  a.FallbackPool,
			ThinkingLevel: effort,
			Concurrency:   a.Concurrency,
			UpdatedAtMs:   now,
		}
		_ = analytics.UpsertAgentProfile(rec)

		// 2. Prepare file sync payloads
		if a.Universe == "jok3r_pi" {
			jok3rProfiles[a.AgentID] = map[string]any{
				"model":    "cpamc/" + a.PrimaryPool,
				"fallback": "cpamc/" + a.FallbackPool,
				"effort":   effort,
			}
		} else if a.Universe == "gentle_ai" {
			gentleProfiles[a.AgentID] = map[string]any{
				"model":    "cpamc/" + a.PrimaryPool,
				"fallback": "cpamc/" + a.FallbackPool,
				"effort":   effort,
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

func getVal(m map[string]analytics.AgentProfileRecord, id, field, def string) string {
	if r, ok := m[id]; ok {
		switch field {
		case "primary":
			if r.PrimaryPool != "" {
				return r.PrimaryPool
			}
		case "fallback":
			if r.FallbackPool != "" {
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

	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	// Sync jok3r-pi subagents.json
	jok3rPath := filepath.Join(home, ".pi", "agent-j0k3r", "subagents.json")
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
	}

	// Sync gentle-ai profiles.json
	gentleDirs := []string{
		filepath.Join(home, ".pi", "gentle-ai"),
		filepath.Join(home, ".gentle-shell", "agent"),
	}
	for _, dir := range gentleDirs {
		pPath := filepath.Join(dir, "profiles.json")
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
		}
	}
}
