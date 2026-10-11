package plugin

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	maintenanceScanRoutePath   = "/auto-switcher-pro/maintenance/scan"
	maintenanceCleanRoutePath  = "/auto-switcher-pro/maintenance/clean"
	maintenanceUpdateRoutePath = "/auto-switcher-pro/maintenance/update-console"

	githubReleasesURL = "https://api.github.com/repos/router-for-me/Cli-Proxy-API-Management-Center/releases/latest"
	defaultStaticDir  = "/CLIProxyAPI/static"
)

// ScanResult summarizes findings from health inspection
type ScanResult struct {
	Ok                  bool                  `json:"ok"`
	Timestamp           string                `json:"timestamp"`
	TotalAuthFiles      int                   `json:"total_auth_files"`
	ResidualAccounts    []ResidualAccountInfo `json:"residual_accounts"`
	OrphanClones        []string              `json:"orphan_clones"`
	OrphanArtifacts     []string              `json:"orphan_artifacts,omitempty"`
	ActivePoolsCount    int                   `json:"active_pools_count"`
	ConsoleVersionLocal string                `json:"console_version_local"`
	ConsoleLatestGithub string                `json:"console_latest_github"`
	ConsoleUpdateAvail  bool                  `json:"console_update_available"`
	Message             string                `json:"message"`
}

type ResidualAccountInfo struct {
	FileName        string   `json:"file_name"`
	TotalExcluded   int      `json:"total_excluded"`
	ForeignExcluded int      `json:"foreign_excluded"`
	ForeignSample   []string `json:"foreign_sample"`
}

type CleanResult struct {
	Ok              bool     `json:"ok"`
	CleanedFiles    []string `json:"cleaned_files"`
	PurgedClones    []string `json:"purged_clones"`
	PurgedArtifacts []string `json:"purged_artifacts,omitempty"`
	Message         string   `json:"message"`
}

type UpdateConsoleResult struct {
	Ok          bool   `json:"ok"`
	PreviousMD5 string `json:"previous_md5"`
	NewMD5      string `json:"new_md5"`
	Version     string `json:"version"`
	Message     string `json:"message"`
}

func isMaintenancePath(path string) bool {
	normalized := strings.TrimSpace(path)
	if idx := strings.IndexAny(normalized, "?#"); idx != -1 {
		normalized = normalized[:idx]
	}
	normalized = strings.TrimRight(normalized, "/")
	return strings.HasSuffix(normalized, maintenanceScanRoutePath) ||
		strings.HasSuffix(normalized, maintenanceCleanRoutePath) ||
		strings.HasSuffix(normalized, maintenanceUpdateRoutePath)
}

// extractConsoleVersion attempts to parse semantic version from management.html
func extractConsoleVersion(htmlContent string) string {
	// Pattern 1: Official CPAMC UI footer version tile:
	// tileLabel...footer.version...tileValue,children:`v1.26.1`
	reFooter := regexp.MustCompile(`footer\.version[^}]+tileValue,\s*children:\s*[` + "`" + `"]([vV]?[0-9]+(?:\.[0-9]+)+)[` + "`" + `"]`)
	if m := reFooter.FindStringSubmatch(htmlContent); len(m) > 1 {
		return normalizeVersion(m[1])
	}

	// Pattern 2: Generic tileValue with version string
	reTile := regexp.MustCompile(`tileValue,\s*children:\s*[` + "`" + `"]([vV]?[0-9]+(?:\.[0-9]+)+)[` + "`" + `"]`)
	if m := reTile.FindStringSubmatch(htmlContent); len(m) > 1 {
		return normalizeVersion(m[1])
	}

	// Pattern 3: Explicit version field in JSON or JS
	reMeta := regexp.MustCompile(`["']version["']\s*:\s*["']([vV]?[0-9]+(?:\.[0-9]+)+)["']`)
	if m := reMeta.FindStringSubmatch(htmlContent); len(m) > 1 {
		return normalizeVersion(m[1])
	}

	return ""
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if !strings.HasPrefix(strings.ToLower(v), "v") {
		v = "v" + v
	}
	return v
}

// computeFileMD5 returns MD5 hash of a file
func computeFileMD5(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// isForeignModel reports if a model identifier belongs to a foreign non-antigravity provider
func isForeignModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return false
	}
	// Models legitimately offered by Antigravity (Google / Claude in antigravity package)
	if strings.Contains(m, "gemini") ||
		strings.Contains(m, "claude") ||
		strings.Contains(m, "sonnet") ||
		strings.Contains(m, "opus") ||
		strings.Contains(m, "haiku") {
		return false
	}
	// Everything else in CPAMC is from third-party non-antigravity providers
	// (OpenCode, NVIDIA NIM, GLM, Grok, Moonshot/Kimi, DeepSeek, Qwen, etc.)
	return true
}

// scanOrphanArtifacts searches for stray build headers and shared libraries
// (.h, .so) located in plugin source directories instead of the designated bin/ output.
func scanOrphanArtifacts() []string {
	var candidates []string
	seen := make(map[string]struct{})

	targetDirs := []string{}
	if envDir := os.Getenv("AUTO_SWITCHER_PLUGIN_DIR"); envDir != "" {
		targetDirs = append(targetDirs, envDir)
	}
	targetDirs = append(targetDirs,
		"plugins/auto-switcher-pro",
		"plugins",
		".",
	)

	for _, dir := range targetDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasSuffix(name, ".h") || strings.HasSuffix(name, ".so") {
				if strings.Contains(name, "auto-switcher") || strings.Contains(name, "visual-profile") {
					fullPath := filepath.Join(dir, name)
					cleanPath := filepath.Clean(fullPath)
					if _, already := seen[cleanPath]; !already {
						seen[cleanPath] = struct{}{}
						candidates = append(candidates, cleanPath)
					}
				}
			}
		}
	}
	return candidates
}

// cleanOrphanArtifacts purges any detected orphan build artifacts.
func cleanOrphanArtifacts(artifacts []string) []string {
	var purged []string
	for _, art := range artifacts {
		if err := os.Remove(art); err == nil {
			purged = append(purged, art)
		}
	}
	return purged
}

func scanHealth(authDir, staticDir string) (ScanResult, error) {
	if authDir == "" {
		authDir = resolveAuthDir()
	}
	if staticDir == "" {
		staticDir = defaultStaticDir
	}

	res := ScanResult{
		Ok:        true,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	reg := DefaultRegistry()
	res.ActivePoolsCount = len(reg.ListPools())

	// 1. Scan auth credentials for foreign residuals
	entries, err := os.ReadDir(authDir)
	if err == nil {
		validCount := 0
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			validCount++
			data, readErr := os.ReadFile(filepath.Join(authDir, e.Name()))
			if readErr != nil {
				continue
			}
			var cred map[string]any
			if json.Unmarshal(data, &cred) != nil {
				continue
			}

			rawEx, _ := cred["excluded_models"].([]any)
			if len(rawEx) == 0 {
				rawEx, _ = cred["excludedModels"].([]any)
			}
			if len(rawEx) == 0 {
				continue
			}

			// Detect any accounts with exclusions or nested prefix residuals
			if len(rawEx) > 0 {
				foreignCount := 0
				var sample []string
				for _, item := range rawEx {
					s, ok := item.(string)
					if ok {
						// Any exclusion, foreign model, or nested prefix model is flagged for cleanup
						foreignCount++
						if len(sample) < 5 {
							sample = append(sample, s)
						}
					}
				}

				if foreignCount > 0 {
					res.ResidualAccounts = append(res.ResidualAccounts, ResidualAccountInfo{
						FileName:        e.Name(),
						TotalExcluded:   len(rawEx),
						ForeignExcluded: foreignCount,
						ForeignSample:   sample,
					})
				}
			}
		}
		res.TotalAuthFiles = validCount
	}

	// 2. Scan Console version from static/management.html
	mgmtPath := filepath.Join(staticDir, "management.html")
	if data, err := os.ReadFile(mgmtPath); err == nil {
		if ver := extractConsoleVersion(string(data)); ver != "" {
			res.ConsoleVersionLocal = ver
		} else if md5Hash, err := computeFileMD5(mgmtPath); err == nil {
			res.ConsoleVersionLocal = md5Hash[:8]
		}
	}
	if res.ConsoleVersionLocal == "" {
		res.ConsoleVersionLocal = "desconocido"
	}

	// 3. Check latest release from GitHub (timeout 3s)
	client := &http.Client{Timeout: 3 * time.Second}
	req, _ := http.NewRequest("GET", githubReleasesURL, nil)
	req.Header.Set("User-Agent", "AutoSwitcherPro-HealthCheck/1.0")
	if resp, err := client.Do(req); err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			var ghRelease struct {
				TagName string `json:"tag_name"`
			}
			if json.NewDecoder(resp.Body).Decode(&ghRelease) == nil {
				res.ConsoleLatestGithub = ghRelease.TagName
			}
		}
	}
	if res.ConsoleLatestGithub == "" {
		res.ConsoleLatestGithub = "v1.26.1"
	}

	if strings.TrimSpace(res.ConsoleLatestGithub) != "" &&
		res.ConsoleVersionLocal != "desconocido" &&
		normalizeVersion(res.ConsoleLatestGithub) != normalizeVersion(res.ConsoleVersionLocal) {
		res.ConsoleUpdateAvail = true
	}

	res.OrphanArtifacts = scanOrphanArtifacts()

	res.Message = fmt.Sprintf("Escaneo completado: %d cuentas con residuos detectadas.", len(res.ResidualAccounts))
	return res, nil
}

func cleanHealth(authDir string) (CleanResult, error) {
	if authDir == "" {
		authDir = resolveAuthDir()
	}

	res := CleanResult{
		Ok:      true,
		Message: "Limpieza ejecutada exitosamente.",
	}

	entries, err := os.ReadDir(authDir)
	if err != nil {
		return res, err
	}

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		filePath := filepath.Join(authDir, e.Name())
		data, readErr := os.ReadFile(filePath)
		if readErr != nil {
			continue
		}
		var cred map[string]any
		if json.Unmarshal(data, &cred) != nil {
			continue
		}

		rawEx, hasEx := cred["excluded_models"].([]any)
		if !hasEx {
			rawEx, _ = cred["excludedModels"].([]any)
		}
		if len(rawEx) == 0 {
			continue
		}

		// Barrido a estado por defecto OAuth: resetea excluded_models a []
		// devolviendo la cuenta al estado inicial de fábrica de CPAMC
		cred["excluded_models"] = []string{}
		delete(cred, "excludedModels")
		newData, err := json.MarshalIndent(cred, "", "  ")
		if err == nil {
			_ = os.WriteFile(filePath, newData, 0644)
			res.CleanedFiles = append(res.CleanedFiles, e.Name())
		}
	}

	// 2. Sanear el estado de los pools en auto-switcher-pro-state.json:
	// eliminar modelos de otros proveedores en excluded_models y desanidar prefijos en target_models
	reg := DefaultRegistry()
	pools := reg.ListPools()
	for _, p := range pools {
		dirty := false
		if len(p.Policy.ExcludedModels) > 0 {
			p.Policy.ExcludedModels = []string{}
			dirty = true
		}
		seenTargets := make(map[string]struct{})
		cleanedTargets := make([]string, 0, len(p.Policy.TargetModels))
		for _, t := range p.Policy.TargetModels {
			bare := cleanBareModelID(t)
			if bare != "" {
				if _, dup := seenTargets[bare]; !dup {
					seenTargets[bare] = struct{}{}
					cleanedTargets = append(cleanedTargets, bare)
				}
			}
		}
		if len(cleanedTargets) != len(p.Policy.TargetModels) {
			dirty = true
			p.Policy.TargetModels = cleanedTargets
		}
		if dirty {
			_ = reg.SavePool(p)
		}
	}

	res.Message = fmt.Sprintf("Se limpiaron %d archivo(s) de credenciales y el estado de los pools quedó saneado.", len(res.CleanedFiles))

	orphans := scanOrphanArtifacts()
	if len(orphans) > 0 {
		res.PurgedArtifacts = cleanOrphanArtifacts(orphans)
		if len(res.PurgedArtifacts) > 0 {
			res.Message += fmt.Sprintf(" Se purgaron %d artefacto(s) de compilación huérfano(s).", len(res.PurgedArtifacts))
		}
	}

	return res, nil
}

func updateConsole(staticDir string) (UpdateConsoleResult, error) {
	if staticDir == "" {
		staticDir = defaultStaticDir
	}

	mgmtPath := filepath.Join(staticDir, "management.html")
	bakPath := filepath.Join(staticDir, "management.html.bak")
	tmpPath := filepath.Join(staticDir, "management.html.tmp")

	res := UpdateConsoleResult{Ok: false}

	// 1. Compute current MD5
	prevMD5, _ := computeFileMD5(mgmtPath)
	res.PreviousMD5 = prevMD5

	// 2. Fetch latest download URL from GitHub releases
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", githubReleasesURL, nil)
	req.Header.Set("User-Agent", "AutoSwitcherPro-Updater/1.0")
	ghResp, err := client.Do(req)
	if err != nil {
		return res, fmt.Errorf("contactar GitHub API: %w", err)
	}
	defer ghResp.Body.Close()

	if ghResp.StatusCode != http.StatusOK {
		return res, fmt.Errorf("GitHub API respondió HTTP %d", ghResp.StatusCode)
	}

	var ghRelease struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(ghResp.Body).Decode(&ghRelease); err != nil {
		return res, fmt.Errorf("decodificar release de GitHub: %w", err)
	}

	res.Version = ghRelease.TagName
	downloadURL := ""
	for _, asset := range ghRelease.Assets {
		if asset.Name == "management.html" {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		return res, fmt.Errorf("asset management.html no encontrado en release %s", ghRelease.TagName)
	}

	// 3. Download asset to temporary file
	dlReq, _ := http.NewRequest("GET", downloadURL, nil)
	dlReq.Header.Set("User-Agent", "AutoSwitcherPro-Updater/1.0")
	dlResp, err := client.Do(dlReq)
	if err != nil {
		return res, fmt.Errorf("descargar asset: %w", err)
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != http.StatusOK {
		return res, fmt.Errorf("descarga falló con HTTP %d", dlResp.StatusCode)
	}

	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		return res, fmt.Errorf("crear archivo temporal: %w", err)
	}
	nBytes, err := io.Copy(tmpFile, dlResp.Body)
	tmpFile.Close()
	if err != nil || nBytes < 100000 {
		_ = os.Remove(tmpPath)
		return res, fmt.Errorf("archivo descargado inválido o corrupto (bytes: %d)", nBytes)
	}

	// 4. Verify downloaded file is valid HTML
	tmpData, _ := os.ReadFile(tmpPath)
	if !strings.Contains(strings.ToLower(string(tmpData[:1000])), "<!doctype html") {
		_ = os.Remove(tmpPath)
		return res, fmt.Errorf("el archivo descargado no es un HTML válido")
	}

	// 5. Create backup of current management.html
	if curData, err := os.ReadFile(mgmtPath); err == nil {
		_ = os.WriteFile(bakPath, curData, 0644)
	}

	// 6. Atomic replacement
	if err := os.Rename(tmpPath, mgmtPath); err != nil {
		// Rollback if failed
		if bakData, bErr := os.ReadFile(bakPath); bErr == nil {
			_ = os.WriteFile(mgmtPath, bakData, 0644)
		}
		return res, fmt.Errorf("reemplazo atómico falló: %w", err)
	}

	newMD5, _ := computeFileMD5(mgmtPath)
	res.Ok = true
	res.NewMD5 = newMD5
	res.Message = fmt.Sprintf("CPAMC Console actualizado exitosamente a la versión %s.", ghRelease.TagName)
	return res, nil
}

func handleMaintenanceHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}

	switch {
	case strings.HasSuffix(req.Path, maintenanceScanRoutePath):
		if method != http.MethodGet {
			return methodNotAllowedResponse()
		}
		scan, err := scanHealth("", "")
		if err != nil {
			return errorJSONResponse(http.StatusInternalServerError, err.Error())
		}
		raw, _ := json.Marshal(scan)
		return successJSONResponse(raw)

	case strings.HasSuffix(req.Path, maintenanceCleanRoutePath):
		if method != http.MethodPost {
			return methodNotAllowedResponse()
		}
		clean, err := cleanHealth("")
		if err != nil {
			return errorJSONResponse(http.StatusInternalServerError, err.Error())
		}
		raw, _ := json.Marshal(clean)
		return successJSONResponse(raw)

	case strings.HasSuffix(req.Path, maintenanceUpdateRoutePath):
		if method != http.MethodPost {
			return methodNotAllowedResponse()
		}
		update, err := updateConsole("")
		if err != nil {
			return errorJSONResponse(http.StatusInternalServerError, err.Error())
		}
		raw, _ := json.Marshal(update)
		return successJSONResponse(raw)

	default:
		return notFoundResponse()
	}
}

func successJSONResponse(body []byte) ([]byte, error) {
	var parsed any
	_ = json.Unmarshal(body, &parsed)
	return jsonManagementResponse(http.StatusOK, parsed)
}

func errorJSONResponse(code int, msg string) ([]byte, error) {
	return jsonManagementResponse(code, map[string]any{"ok": false, "error": msg})
}

func methodNotAllowedResponse() ([]byte, error) {
	return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
}

func notFoundResponse() ([]byte, error) {
	return jsonManagementResponse(http.StatusNotFound, map[string]string{"error": "not_found"})
}
