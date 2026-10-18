package plugin

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	argonStatusRoutePath      = "/auto-switcher-pro/argon/status"
	argonSyncSessionRoutePath = "/auto-switcher-pro/argon/sync-session"
	defaultArgonDaemonURL     = "http://127.0.0.1:8319"
	maxArgonCookieBytes       = 64 * 1024 // 64 KB limit
)

var reArgonTime = regexp.MustCompile(`(\d{1,2}):(\d{2})`)

// Error classifications for Gemini Argon web automation
const (
	ArgonErrNone           = "NONE"
	ArgonErrRateLimit      = "RATE_LIMIT"
	ArgonErrCaptcha        = "CAPTCHA_BLOCKED"
	ArgonErrSessionExpired = "SESSION_EXPIRED"
	ArgonErrDaemonBusy     = "DAEMON_BUSY"
	ArgonErrTimeout        = "TIMEOUT"
	ArgonErrSelectorChange = "SELECTOR_CHANGED"
)

// ArgonAccountInfo models a single Google Gemini Argon web session.
type ArgonAccountInfo struct {
	AccountID    string  `json:"account_id"`
	AuthUser     string  `json:"authuser"` // e.g. "0", "1"
	Email        string  `json:"email"`
	Status       string  `json:"status"` // "ready", "cooldown", "expired", "busy", "captcha"
	QuotaPct     float64 `json:"quota_pct"`
	ResetAt      string  `json:"reset_at,omitempty"`
	ResetSeconds int64   `json:"reset_seconds,omitempty"`
	LastSyncAt   string  `json:"last_sync_at,omitempty"`
	HasCookies   bool    `json:"has_cookies"`
	ErrorMessage string  `json:"error_message,omitempty"`
}

// ArgonStatusResponse models the payload returned by /auto-switcher-pro/argon/status.
type ArgonStatusResponse struct {
	Ok           bool               `json:"ok"`
	DaemonStatus string             `json:"daemon_status"` // "online", "idle", "offline"
	DaemonURL    string             `json:"daemon_url"`
	IsBusy       bool               `json:"is_busy"`
	ActiveTask   string             `json:"active_task,omitempty"`
	MemoryMB     float64            `json:"memory_mb,omitempty"`
	Accounts     []ArgonAccountInfo `json:"accounts"`
	TotalActive  int                `json:"total_active"`
	InCooldown   int                `json:"in_cooldown"`
	Message      string             `json:"message"`
	Timestamp    string             `json:"timestamp"`
}

// SyncSessionPayload defines the schema for /auto-switcher-pro/argon/sync-session.
type SyncSessionPayload struct {
	Cookies    string `json:"cookies"` // raw cookie string or JSON dictionary
	AuthUser   string `json:"authuser,omitempty"`
	Email      string `json:"email,omitempty"`
	Label      string `json:"label,omitempty"`
	SaveToDisk bool   `json:"save_to_disk,omitempty"`
}

// ArgonSessionStore holds live in-memory Argon accounts and their statuses.
type ArgonSessionStore struct {
	mu           sync.RWMutex
	accounts     map[string]ArgonAccountInfo
	daemonURL    string
	httpClient   *http.Client
	statusReader func() ([]byte, error)
}

var (
	argonStoreOnce sync.Once
	globalArgon    *ArgonSessionStore
)

// GetArgonStore returns the singleton ArgonSessionStore.
func GetArgonStore() *ArgonSessionStore {
	argonStoreOnce.Do(func() {
		globalArgon = &ArgonSessionStore{
			accounts:  make(map[string]ArgonAccountInfo),
			daemonURL: defaultArgonDaemonURL,
			httpClient: &http.Client{
				Timeout: 350 * time.Millisecond, // ultra-fast non-blocking probe
			},
		}
	})
	return globalArgon
}

func isArgonPath(p string) bool {
	norm := strings.TrimSpace(p)
	return strings.Contains(norm, "/auto-switcher-pro/argon/")
}

// ClassifyArgonError inspects DOM error messages from gemini.google.com and categorizes them.
func ClassifyArgonError(errText string) (errType string, isRetryable bool, cooldownSec int64) {
	lower := strings.ToLower(strings.TrimSpace(errText))
	if lower == "" {
		return ArgonErrNone, true, 0
	}

	// 1. Quota / Rate limit patterns (Spanish and English DOM strings)
	if strings.Contains(lower, "límite") || strings.Contains(lower, "limite") ||
		strings.Contains(lower, "restablece") || strings.Contains(lower, "rate limit") ||
		strings.Contains(lower, "quota exceeded") || strings.Contains(lower, "429") ||
		strings.Contains(lower, "too many requests") || strings.Contains(lower, "alcanzado el límite") {
		// Default to 1 hour cooldown if time is not parsed
		cd := int64(3600)
		// Try to parse hours/minutes if present
		if m := reArgonTime.FindStringSubmatch(lower); len(m) == 3 {
			h, _ := strconv.Atoi(m[1])
			min, _ := strconv.Atoi(m[2])
			now := time.Now()
			target := time.Date(now.Year(), now.Month(), now.Day(), h, min, 0, 0, now.Location())
			if target.Before(now) {
				target = target.Add(24 * time.Hour)
			}
			diff := int64(time.Until(target).Seconds())
			if diff > 0 && diff <= 86400 {
				cd = diff
			}
		}
		return ArgonErrRateLimit, false, cd
	}

	// 2. CAPTCHA / BotGuard / Challenge
	if strings.Contains(lower, "captcha") || strings.Contains(lower, "botguard") ||
		strings.Contains(lower, "verificación") || strings.Contains(lower, "security check") ||
		strings.Contains(lower, "suspicious") || strings.Contains(lower, "unusual traffic") {
		return ArgonErrCaptcha, false, 7200 // 2 hours
	}

	// 3. Session / Cookie expiration
	if strings.Contains(lower, "session expired") || strings.Contains(lower, "unauthorized") ||
		strings.Contains(lower, "inicia sesión") || strings.Contains(lower, "sign in") ||
		strings.Contains(lower, "login required") || strings.Contains(lower, "cookie") {
		return ArgonErrSessionExpired, false, 0
	}

	// 4. Daemon Busy
	if strings.Contains(lower, "isbusy") || strings.Contains(lower, "busy") ||
		strings.Contains(lower, "daemon busy") {
		return ArgonErrDaemonBusy, true, 10
	}

	// 5. Timeout
	if strings.Contains(lower, "timeout") || strings.Contains(lower, "socket hang up") ||
		strings.Contains(lower, "deadline exceeded") {
		return ArgonErrTimeout, true, 5
	}

	// 6. DOM Selector break
	if strings.Contains(lower, "selector") || strings.Contains(lower, "element not found") ||
		strings.Contains(lower, "input-area") {
		return ArgonErrSelectorChange, false, 3600
	}

	return ArgonErrNone, false, 0
}

// ProbeDaemon checks if the companion Playwright daemon is running on port 8319.
func (s *ArgonSessionStore) ProbeDaemon() (status string, isBusy bool, memMB float64, activeTask string) {
	var candidates []string
	if s.daemonURL != "" && s.daemonURL != defaultArgonDaemonURL {
		candidates = []string{s.daemonURL}
	} else {
		candidates = []string{
			"http://127.0.0.1:8319",
			"http://172.19.0.1:8319",
			"http://host.docker.internal:8319",
		}
	}

	seen := make(map[string]struct{})
	for _, targetURL := range candidates {
		trimmed := strings.TrimRight(strings.TrimSpace(targetURL), "/")
		if trimmed == "" {
			continue
		}
		if _, dup := seen[trimmed]; dup {
			continue
		}
		seen[trimmed] = struct{}{}

		resp, err := s.httpClient.Get(trimmed + "/health")
		if err != nil {
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			continue
		}

		// Save the working daemon URL for subsequent calls
		s.daemonURL = trimmed

		var data struct {
			Status     string  `json:"status"`
			IsBusy     bool    `json:"isBusy"`
			ActiveTask string  `json:"activeTask"`
			MemoryMB   float64 `json:"memoryMB"`
			Idle       bool    `json:"idle"`
		}

		err = json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()

		if err != nil {
			return "online", false, 0, ""
		}

		if data.Idle {
			return "idle", data.IsBusy, data.MemoryMB, data.ActiveTask
		}
		return "online", data.IsBusy, data.MemoryMB, data.ActiveTask
	}

	return "offline", false, 0, ""
}

// IngestSession stores an active cookie session for an authuser.
func (s *ArgonSessionStore) IngestSession(payload SyncSessionPayload, authDir string) (ArgonAccountInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rawCookies := strings.TrimSpace(payload.Cookies)
	if rawCookies == "" {
		return ArgonAccountInfo{}, fmt.Errorf("cookies vacías: se requiere token de sesión __Secure-1PSID")
	}

	if len(rawCookies) > maxArgonCookieBytes {
		return ArgonAccountInfo{}, fmt.Errorf("payload de cookies excede el límite seguro de %d bytes", maxArgonCookieBytes)
	}

	// Validate presence of critical Google cookies
	if !strings.Contains(rawCookies, "__Secure-1PSID") && !strings.Contains(rawCookies, "SID") {
		return ArgonAccountInfo{}, fmt.Errorf("formato inválido: no se detectó cookie __Secure-1PSID ni SID")
	}

	// Strict sanitization of AuthUser against path traversal and special characters
	rawAuthUser := strings.TrimSpace(payload.AuthUser)
	safeAuthUser := ""
	for _, r := range rawAuthUser {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' {
			safeAuthUser += string(r)
		}
	}
	if safeAuthUser == "" {
		safeAuthUser = "0"
	}
	authUser := safeAuthUser

	email := strings.TrimSpace(payload.Email)
	if email == "" {
		email = fmt.Sprintf("gemini-argon-u%s@google.com", authUser)
	}

	accID := fmt.Sprintf("argon_u%s", authUser)
	nowStr := time.Now().UTC().Format(time.RFC3339)

	acc := ArgonAccountInfo{
		AccountID:    accID,
		AuthUser:     authUser,
		Email:        email,
		Status:       "ready",
		QuotaPct:     100.0,
		LastSyncAt:   nowStr,
		HasCookies:   true,
		ErrorMessage: "",
	}

	s.accounts[accID] = acc

	// If requested or if authDir exists and save_to_disk is true,
	// persist atomically with ZERO mutations to excluded_models.
	if payload.SaveToDisk && authDir != "" {
		targetFile := filepath.Join(authDir, fmt.Sprintf("gemini-argon-u%s.json", authUser))
		cred := map[string]any{
			"provider":        "gemini-argon",
			"type":            "gemini_argon",
			"prefix":          "argon",
			"authuser":        authUser,
			"email":           email,
			"raw_cookies":     rawCookies,
			"cookie":          rawCookies,
			"excluded_models": []string{},
			"updated_at":      nowStr,
		}
		data, err := json.MarshalIndent(cred, "", "  ")
		if err == nil {
			_ = atomicWriteFile(targetFile, data, 0644)
		}
	}

	return acc, nil
}

// SetAccountCooldown sets a cooldown for an account based on error classification.
func (s *ArgonSessionStore) SetAccountCooldown(accID string, errType string, cooldownSec int64, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	acc, exists := s.accounts[accID]
	if !exists {
		return
	}

	acc.Status = "cooldown"
	acc.ErrorMessage = msg
	acc.QuotaPct = 0.0

	if cooldownSec > 0 {
		resetTime := time.Now().Add(time.Duration(cooldownSec) * time.Second)
		acc.ResetAt = resetTime.Format("15:04:05")
		acc.ResetSeconds = cooldownSec
	}

	s.accounts[accID] = acc
}

// RehydrateFromDisk scans authDir for existing gemini-argon-u*.json credentials
// and populates in-memory accounts if they aren't already present.
func (s *ArgonSessionStore) RehydrateFromDisk(authDir string) {
	if authDir == "" {
		return
	}
	files, err := os.ReadDir(authDir)
	if err != nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, fi := range files {
		name := fi.Name()
		if fi.IsDir() || !strings.HasPrefix(name, "gemini-argon-u") || !strings.HasSuffix(name, ".json") {
			continue
		}

		rawAuthUser := strings.TrimSuffix(strings.TrimPrefix(name, "gemini-argon-u"), ".json")
		accID := fmt.Sprintf("argon_u%s", rawAuthUser)
		if _, exists := s.accounts[accID]; exists {
			continue
		}

		fullPath := filepath.Join(authDir, name)
		data, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}

		var parsed struct {
			AuthUser   string `json:"authuser"`
			Email      string `json:"email"`
			RawCookies string `json:"raw_cookies"`
			Cookie     string `json:"cookie"`
		}
		if err := json.Unmarshal(data, &parsed); err != nil {
			continue
		}

		u := strings.TrimSpace(parsed.AuthUser)
		if u == "" {
			u = rawAuthUser
		}
		mail := strings.TrimSpace(parsed.Email)
		if mail == "" {
			mail = fmt.Sprintf("gemini-argon-u%s@google.com", u)
		}
		cookies := strings.TrimSpace(parsed.RawCookies)
		if cookies == "" {
			cookies = strings.TrimSpace(parsed.Cookie)
		}

		s.accounts[accID] = ArgonAccountInfo{
			AccountID:    accID,
			AuthUser:     u,
			Email:        mail,
			Status:       "ready",
			QuotaPct:     100.0,
			LastSyncAt:   time.Now().UTC().Format(time.RFC3339),
			HasCookies:   cookies != "",
			ErrorMessage: "",
		}
	}
}

// GetActiveReadySession finds the first ready in-memory account with valid session cookies.
func (s *ArgonSessionStore) GetActiveReadySession(authDir string) (cookies string, authUser string, email string, err error) {
	s.RehydrateFromDisk(authDir)

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, acc := range s.accounts {
		if acc.Status == "ready" && acc.HasCookies {
			// Read disk file if needed to fetch raw cookies
			if authDir != "" {
				targetFile := filepath.Join(authDir, fmt.Sprintf("gemini-argon-u%s.json", acc.AuthUser))
				if data, err := os.ReadFile(targetFile); err == nil {
					var diskObj struct {
						RawCookies string `json:"raw_cookies"`
						Cookie     string `json:"cookie"`
					}
					if json.Unmarshal(data, &diskObj) == nil {
						c := strings.TrimSpace(diskObj.RawCookies)
						if c == "" {
							c = strings.TrimSpace(diskObj.Cookie)
						}
						if c != "" {
							return c, acc.AuthUser, acc.Email, nil
						}
					}
				}
			}
			return "", acc.AuthUser, acc.Email, nil
		}
	}

	return "", "0", "", fmt.Errorf("no hay sesiones de Gemini Argon listas o con cookies válidas")
}

// ListAccounts returns all active/cooldown accounts in memory, plus any on-disk accounts.
func (s *ArgonSessionStore) ListAccounts() []ArgonAccountInfo {
	s.RehydrateFromDisk(resolveAuthDir())

	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]ArgonAccountInfo, 0, len(s.accounts))
	for _, acc := range s.accounts {
		// Update cooldown countdown if active
		if acc.Status == "cooldown" && acc.ResetSeconds > 0 {
			// Check if cooldown elapsed
			if acc.ResetAt != "" {
				if acc.ResetSeconds <= 0 {
					acc.Status = "ready"
					acc.QuotaPct = 100.0
					acc.ResetAt = ""
					acc.ErrorMessage = ""
				}
			}
		}
		list = append(list, acc)
	}

	return list
}

// DeleteAccount removes an account from memory and optionally deletes its file on disk.
func (s *ArgonSessionStore) DeleteAccount(authUser, authDir string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	safeAuthUser := ""
	for _, r := range strings.TrimSpace(authUser) {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' {
			safeAuthUser += string(r)
		}
	}
	if safeAuthUser == "" {
		safeAuthUser = "0"
	}

	accID := fmt.Sprintf("argon_u%s", safeAuthUser)
	_, exists := s.accounts[accID]
	if exists {
		delete(s.accounts, accID)
	}

	if authDir != "" {
		targetFile := filepath.Join(authDir, fmt.Sprintf("gemini-argon-u%s.json", safeAuthUser))
		_ = os.Remove(targetFile)
	}

	return exists
}

func handleArgonHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	store := GetArgonStore()
	normPath := strings.ToLower(strings.TrimSpace(req.Path))

	// 1. /auto-switcher-pro/argon/status
	if strings.HasSuffix(normPath, "/status") {
		if method != http.MethodGet {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "Sólo se permite GET en /auto-switcher-pro/argon/status",
			})
		}

		daemonStatus, isBusy, memMB, activeTask := store.ProbeDaemon()
		accounts := store.ListAccounts()

		activeCount := 0
		cooldownCount := 0
		for _, a := range accounts {
			if a.Status == "ready" {
				activeCount++
			} else if a.Status == "cooldown" || a.Status == "captcha" {
				cooldownCount++
			}
		}

		msg := "Argon Gateway activo."
		if daemonStatus == "offline" {
			msg = "Daemon companion Playwright offline en puerto 8319. Esperando inicio de servicio."
		}

		resp := ArgonStatusResponse{
			Ok:           true,
			DaemonStatus: daemonStatus,
			DaemonURL:    store.daemonURL,
			IsBusy:       isBusy,
			ActiveTask:   activeTask,
			MemoryMB:     memMB,
			Accounts:     accounts,
			TotalActive:  activeCount,
			InCooldown:   cooldownCount,
			Message:      msg,
			Timestamp:    time.Now().UTC().Format(time.RFC3339),
		}

		return jsonManagementResponse(http.StatusOK, resp)
	}

	// 2. /auto-switcher-pro/argon/sync-session
	if strings.HasSuffix(normPath, "/sync-session") {
		if method != http.MethodPost {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "Sólo se permite POST en /auto-switcher-pro/argon/sync-session",
			})
		}

		var payload SyncSessionPayload
		if err := json.Unmarshal(req.Body, &payload); err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "bad_request",
				"message": "Payload JSON malformado: " + err.Error(),
			})
		}

		authDir := resolveAuthDir()
		acc, err := store.IngestSession(payload, authDir)
		if err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "invalid_session",
				"message": err.Error(),
			})
		}

		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":      true,
			"account": acc,
			"message": fmt.Sprintf("Sesión Google Gemini Argon (/u/%s) sincronizada exitosamente.", acc.AuthUser),
		})
	}

	// 3. /auto-switcher-pro/argon/delete-session
	if strings.HasSuffix(normPath, "/delete-session") {
		if method != http.MethodDelete && method != http.MethodPost {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "Sólo se permite DELETE o POST en /auto-switcher-pro/argon/delete-session",
			})
		}

		authUser := "0"
		if len(req.Body) > 0 {
			var body struct {
				AuthUser string `json:"authuser"`
			}
			if err := json.Unmarshal(req.Body, &body); err == nil && body.AuthUser != "" {
				authUser = body.AuthUser
			}
		}

		authDir := resolveAuthDir()
		store.DeleteAccount(authUser, authDir)

		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":      true,
			"message": fmt.Sprintf("Sesión /u/%s eliminada de RAM y disco.", authUser),
		})
	}

	return jsonManagementResponse(http.StatusNotFound, map[string]string{
		"error":   "not_found",
		"message": "Ruta de Argon Gateway no encontrada",
	})
}

// C-ABI Executor structures for CPAMC integration
type argonExecutorRequest struct {
	Model          string              `json:"Model"`
	Stream         bool                `json:"Stream"`
	Headers        map[string][]string `json:"Headers"`
	Payload        json.RawMessage     `json:"Payload"`
	StorageJSON    json.RawMessage     `json:"StorageJSON"`
	AuthMetadata   map[string]any      `json:"AuthMetadata"`
	AuthAttributes map[string]string   `json:"AuthAttributes"`
	StreamID       string              `json:"stream_id,omitempty"`
	HostCallbackID string              `json:"host_callback_id,omitempty"`
}

type argonExecutorResponse struct {
	Payload  json.RawMessage     `json:"Payload"`
	Headers  map[string][]string `json:"Headers,omitempty"`
	Metadata map[string]any      `json:"Metadata,omitempty"`
}

type argonExecutorStreamResponse struct {
	Headers map[string][]string `json:"Headers,omitempty"`
	Chunks  []argonStreamChunk  `json:"Chunks,omitempty"`
}

type argonStreamChunk struct {
	Payload []byte `json:"Payload,omitempty"`
	Error   string `json:"Error,omitempty"`
}

// HandleArgonExecuteRPC handles CPAMC's executor.execute and executor.execute_stream RPC calls.
func HandleArgonExecuteRPC(request []byte, isStream bool) (any, error) {
	var req argonExecutorRequest
	if len(request) > 0 {
		if err := json.Unmarshal(request, &req); err != nil {
			return nil, fmt.Errorf("invalid executor request: %w", err)
		}
	}

	store := GetArgonStore()
	authDir := resolveAuthDir()

	// Extract credentials: first from req.StorageJSON if present, else from store
	var cookies, authUser, email string
	if len(req.StorageJSON) > 0 {
		var st struct {
			RawCookies string `json:"raw_cookies"`
			Cookie     string `json:"cookie"`
			AuthUser   string `json:"authuser"`
			Email      string `json:"email"`
		}
		if json.Unmarshal(req.StorageJSON, &st) == nil {
			c := strings.TrimSpace(st.RawCookies)
			if c == "" {
				c = strings.TrimSpace(st.Cookie)
			}
			if c != "" {
				cookies = c
				authUser = st.AuthUser
				email = st.Email
			}
		}
	}

	if cookies == "" {
		var err error
		cookies, authUser, email, err = store.GetActiveReadySession(authDir)
		if err != nil {
			return nil, fmt.Errorf("gemini argon session error: %w", err)
		}
	}

	if authUser == "" {
		authUser = "0"
	}

	// Parse incoming chat request payload
	var chatReq struct {
		Model           string            `json:"model"`
		Messages        []map[string]any  `json:"messages"`
		Tools           json.RawMessage   `json:"tools,omitempty"`
		ReasoningEffort string            `json:"reasoning_effort,omitempty"`
	}
	if len(req.Payload) > 0 {
		_ = json.Unmarshal(req.Payload, &chatReq)
	}

	targetModel := "gemini-4-argon"
	if req.Model != "" {
		targetModel = req.Model
	} else if chatReq.Model != "" {
		targetModel = chatReq.Model
	}

	runnerInput := map[string]any{
		"model":            targetModel,
		"upstream_model":   "gemini-4-argon",
		"messages":         chatReq.Messages,
		"credential":       cookies,
		"authuser":         authUser,
		"email":            email,
		"reasoning_effort": chatReq.ReasoningEffort,
	}
	if len(chatReq.Tools) > 0 && string(chatReq.Tools) != "null" {
		var toolsParsed any
		if json.Unmarshal(chatReq.Tools, &toolsParsed) == nil {
			runnerInput["tools"] = toolsParsed
		}
	}

	inBytes, err := json.Marshal(runnerInput)
	if err != nil {
		return nil, fmt.Errorf("failed to encode runner input: %w", err)
	}

	// Dispatch to companion Playwright daemon with fallback candidates
	daemonURLs := []string{
		store.daemonURL,
		"http://172.19.0.1:8319",
		"http://127.0.0.1:8319",
		"http://host.docker.internal:8319",
	}

	var daemonOutput []byte
	var lastErr error

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	for _, dURL := range daemonURLs {
		targetEndpoint := strings.TrimRight(dURL, "/") + "/generate"
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetEndpoint, bytes.NewReader(inBytes))
		if err != nil {
			lastErr = err
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 90 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			lastErr = err
			continue
		}

		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode != http.StatusOK {
			var errEnv map[string]any
			if json.Unmarshal(body, &errEnv) == nil {
				if errMsg, ok := errEnv["error"].(string); ok && errMsg != "" {
					// Classify error and set cooldown if necessary
					errType, _, cooldownSec := ClassifyArgonError(errMsg)
					if errType != ArgonErrNone {
						store.SetAccountCooldown(fmt.Sprintf("argon_u%s", authUser), errType, cooldownSec, errMsg)
					}
					lastErr = fmt.Errorf("daemon error (%s): %s", errType, errMsg)
					break
				}
			}
			lastErr = fmt.Errorf("daemon returned HTTP %d: %s", resp.StatusCode, string(body))
			continue
		}

		daemonOutput = body
		break
	}

	if len(daemonOutput) == 0 {
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("failed to communicate with companion Playwright daemon on port 8319")
	}

	if !isStream {
		return argonExecutorResponse{
			Payload: daemonOutput,
			Headers: map[string][]string{
				"Content-Type": {"application/json"},
			},
		}, nil
	}

	// Format into streaming SSE chunks for CPAMC
	chunks, err := formatArgonStreamChunks(daemonOutput, targetModel)
	if err != nil {
		return nil, err
	}

	return argonExecutorStreamResponse{
		Headers: map[string][]string{
			"Content-Type":  {"text/event-stream"},
			"Cache-Control": {"no-cache"},
		},
		Chunks: chunks,
	}, nil
}

func formatArgonStreamChunks(payload []byte, model string) ([]argonStreamChunk, error) {
	var resp struct {
		ID      string `json:"id"`
		Model   string `json:"model"`
		Choices []struct {
			Index   int `json:"index"`
			Message struct {
				Role      string          `json:"role"`
				Content   *string         `json:"content"`
				ToolCalls json.RawMessage `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &resp); err != nil || len(resp.Choices) == 0 {
		return nil, fmt.Errorf("invalid Gemini response payload: %w", err)
	}

	choice := resp.Choices[0]
	chunkID := resp.ID
	if chunkID == "" {
		b := make([]byte, 6)
		_, _ = rand.Read(b)
		chunkID = fmt.Sprintf("chatcmpl-gw-%x", b)
	}

	chunks := make([]argonStreamChunk, 0, 4)

	// 1. Initial role chunk
	roleDelta := map[string]any{
		"id":      chunkID,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{
			{
				"index":         0,
				"delta":         map[string]any{"role": "assistant"},
				"finish_reason": nil,
			},
		},
	}
	r1, _ := json.Marshal(roleDelta)
	chunks = append(chunks, argonStreamChunk{Payload: append([]byte("data: "), append(r1, []byte("\n\n")...)...)})

	// 2. Content delta chunk
	contentDelta := map[string]any{
		"id":      chunkID,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{
			{
				"index": 0,
				"delta": func() map[string]any {
					d := make(map[string]any)
					if choice.Message.Content != nil {
						d["content"] = *choice.Message.Content
					}
					if len(choice.Message.ToolCalls) > 0 && string(choice.Message.ToolCalls) != "null" {
						d["tool_calls"] = choice.Message.ToolCalls
					}
					return d
				}(),
				"finish_reason": nil,
			},
		},
	}
	r2, _ := json.Marshal(contentDelta)
	chunks = append(chunks, argonStreamChunk{Payload: append([]byte("data: "), append(r2, []byte("\n\n")...)...)})

	// 3. Finish chunk
	finishReason := choice.FinishReason
	if finishReason == "" {
		finishReason = "stop"
	}
	finalDelta := map[string]any{
		"id":      chunkID,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{
			{
				"index":         0,
				"delta":         map[string]any{},
				"finish_reason": finishReason,
			},
		},
	}
	r3, _ := json.Marshal(finalDelta)
	chunks = append(chunks, argonStreamChunk{Payload: append([]byte("data: "), append(r3, []byte("\n\n")...)...)})

	// 4. Final [DONE] chunk
	chunks = append(chunks, argonStreamChunk{Payload: []byte("data: [DONE]\n\n")})

	return chunks, nil
}

