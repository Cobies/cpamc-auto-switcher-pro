package plugin

import (
	"encoding/json"
	"fmt"
	"net/http"
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
	daemonURL := s.daemonURL
	if daemonURL == "" {
		daemonURL = defaultArgonDaemonURL
	}

	resp, err := s.httpClient.Get(daemonURL + "/health")
	if err != nil {
		return "offline", false, 0, ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "offline", false, 0, ""
	}

	var data struct {
		Status     string  `json:"status"`
		IsBusy     bool    `json:"isBusy"`
		ActiveTask string  `json:"activeTask"`
		MemoryMB   float64 `json:"memoryMB"`
		Idle       bool    `json:"idle"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		// Valid HTTP 200 response from daemon even if JSON varies
		return "online", false, 0, ""
	}

	if data.Idle {
		return "idle", data.IsBusy, data.MemoryMB, data.ActiveTask
	}
	return "online", data.IsBusy, data.MemoryMB, data.ActiveTask
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

// ListAccounts returns all active/cooldown accounts in memory, plus any on-disk accounts.
func (s *ArgonSessionStore) ListAccounts() []ArgonAccountInfo {
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

	// If no in-memory accounts registered yet, supply default virtual u/0 account for display
	if len(list) == 0 {
		list = append(list, ArgonAccountInfo{
			AccountID:  "argon_u0",
			AuthUser:   "0",
			Email:      "gemini-argon-default@google.com",
			Status:     "ready",
			QuotaPct:   100.0,
			HasCookies: false,
		})
	}

	return list
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

	return jsonManagementResponse(http.StatusNotFound, map[string]string{
		"error":   "not_found",
		"message": "Ruta de Argon Gateway no encontrada",
	})
}
