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
	OrphanProviders     []OrphanProviderInfo  `json:"orphan_providers,omitempty"`
	ActivePoolsCount    int                   `json:"active_pools_count"`
	ConsoleVersionLocal string                `json:"console_version_local"`
	ConsoleLatestGithub string                `json:"console_latest_github"`
	ConsoleUpdateAvail  bool                  `json:"console_update_available"`
	Message             string                `json:"message"`
}

type OrphanProviderInfo struct {
	Name        string   `json:"name"`
	Prefix      string   `json:"prefix"`
	BaseURL     string   `json:"base_url,omitempty"`
	ModelsCount int      `json:"models_count"`
	Models      []string `json:"models,omitempty"`
	Reason      string   `json:"reason"`
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
	PurgedProviders []string `json:"purged_providers,omitempty"`
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
// Live deployed plugin binaries in the runtime plugins directory are NEVER
// orphans: inside the container, `plugins/` resolves to the CPAMC runtime
// directory where .so files legitimately live (2026-10-12 live-deletion incident).
// Stray .h headers remain orphans everywhere (headers are build-time only).
func scanOrphanArtifacts() []string {
	var candidates []string
	seen := make(map[string]struct{})

	runtimePluginsDir := resolveRuntimePluginsDir()

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
					if strings.HasSuffix(name, ".so") && isSameDir(runtimePluginsDir, dir) {
						// Live deployed plugin binary — never an orphan.
						continue
					}
					fullPath := filepath.Join(dir, name)
					absPath, absErr := filepath.Abs(fullPath)
					if absErr != nil {
						absPath = fullPath
					}
					cleanPath := filepath.Clean(absPath)
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

// resolveRuntimePluginsDir derives the directory where CPAMC loads deployed
// plugin binaries: <config-dir>/plugins (config.yaml lives at the app root).
func resolveRuntimePluginsDir() string {
	cfgPath := resolveConfigPath()
	if cfgPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(cfgPath), "plugins")
}

// isSameDir reports whether two paths point to the same directory.
func isSameDir(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return false
	}
	return filepath.Clean(absA) == filepath.Clean(absB)
}

func resolveConfigPath() string {
	if p := os.Getenv("AUTO_SWITCHER_CONFIG_PATH"); p != "" {
		return p
	}
	candidates := []string{
		"/CLIProxyAPI/config.yaml",
		"config.yaml",
		"../config.yaml",
		"../../config.yaml",
		"/home/wilox/services/cliproxy/config.yaml",
	}
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c
		}
	}
	return "/CLIProxyAPI/config.yaml"
}

// scanOrphanConfigProviders parses config.yaml dynamically and finds providers under
// api-keys.openai-compatibility that have no active authentication files in authDir
// and no corresponding active plugin.
func scanOrphanConfigProviders(configPath, authDir string) []OrphanProviderInfo {
	if configPath == "" {
		configPath = resolveConfigPath()
	}
	if authDir == "" {
		authDir = resolveAuthDir()
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil
	}

	// Dynamic, agnostic YAML parser: extract provider blocks under openai-compatibility
	blocks := extractOpenAICompatBlocks(string(content))
	if len(blocks) == 0 {
		return nil
	}

	// Read all auth files from authDir to check active provider references
	authProviders := make(map[string]struct{})
	authPrefixes := make(map[string]struct{})
	if entries, err := os.ReadDir(authDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			fData, err := os.ReadFile(filepath.Join(authDir, e.Name()))
			if err != nil {
				continue
			}
			var cred map[string]any
			if json.Unmarshal(fData, &cred) == nil {
				if prov, ok := cred["provider"].(string); ok && strings.TrimSpace(prov) != "" {
					authProviders[strings.ToLower(strings.TrimSpace(prov))] = struct{}{}
				}
				if typ, ok := cred["type"].(string); ok && strings.TrimSpace(typ) != "" {
					authProviders[strings.ToLower(strings.TrimSpace(typ))] = struct{}{}
				}
				if pfx, ok := cred["prefix"].(string); ok && strings.TrimSpace(pfx) != "" {
					authPrefixes[strings.ToLower(strings.TrimSpace(pfx))] = struct{}{}
				}
			}
		}
	}

	var orphans []OrphanProviderInfo
	for _, b := range blocks {
		provName := strings.ToLower(strings.TrimSpace(b.Name))
		provPrefix := strings.ToLower(strings.TrimSpace(b.Prefix))

		// Check if any auth file references this provider or prefix
		hasAuth := false
		if _, ok := authProviders[provName]; ok {
			hasAuth = true
		}
		if provPrefix != "" {
			if _, ok := authPrefixes[provPrefix]; ok {
				hasAuth = true
			}
		}

		// Also check if any auth file name matches (e.g. opencode-go-*.json, nvidia-*.json)
		if !hasAuth && authDir != "" {
			if entries, err := os.ReadDir(authDir); err == nil {
				for _, e := range entries {
					lowerName := strings.ToLower(e.Name())
					if strings.Contains(lowerName, provName) || (provPrefix != "" && strings.Contains(lowerName, provPrefix)) {
						hasAuth = true
						break
					}
				}
			}
		}

		if !hasAuth {
			orphans = append(orphans, OrphanProviderInfo{
				Name:        b.Name,
				Prefix:      b.Prefix,
				BaseURL:     b.BaseURL,
				ModelsCount: len(b.Models),
				Models:      b.Models,
				Reason:      "Sin cuentas de autenticación vinculadas en disco",
			})
		}
	}

	return orphans
}

type openAICompatBlock struct {
	Name      string
	Prefix    string
	BaseURL   string
	Models    []string
	RawLines  string
	LineStart int
	LineEnd   int
}

// extractOpenAICompatBlocks parses openai-compatibility section agnostically
func extractOpenAICompatBlocks(yamlText string) []openAICompatBlock {
	lines := strings.Split(yamlText, "\n")
	var blocks []openAICompatBlock

	inCompat := false
	compatIndent := -1

	var curBlock *openAICompatBlock
	var curLines []string

	providerIndent := -1

	for idx, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			if curBlock != nil {
				curLines = append(curLines, line)
			}
			continue
		}

		lineIndent := len(line) - len(strings.TrimLeft(line, " "))

		if strings.HasPrefix(trimmed, "openai-compatibility:") {
			inCompat = true
			compatIndent = lineIndent
			providerIndent = -1
			continue
		}

		if inCompat {
			// If indent is less than or equal to openai-compatibility indent, section ended
			if lineIndent <= compatIndent && !strings.HasPrefix(trimmed, "-") {
				if curBlock != nil {
					curBlock.RawLines = strings.Join(curLines, "\n")
					curBlock.LineEnd = idx - 1
					blocks = append(blocks, *curBlock)
					curBlock = nil
					curLines = nil
				}
				inCompat = false
				providerIndent = -1
				continue
			}

			// New provider entry starts with "- " directly under openai-compatibility
			if strings.HasPrefix(trimmed, "- ") && (providerIndent == -1 || lineIndent == providerIndent) {
				if curBlock != nil {
					curBlock.RawLines = strings.Join(curLines, "\n")
					curBlock.LineEnd = idx - 1
					blocks = append(blocks, *curBlock)
				}
				providerIndent = lineIndent
				curBlock = &openAICompatBlock{LineStart: idx}
				curLines = []string{line}

				rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "- "))
				if strings.HasPrefix(rest, "name:") {
					curBlock.Name = strings.Trim(strings.TrimSpace(strings.TrimPrefix(rest, "name:")), `"'`)
				}
				continue
			}

			if curBlock != nil {
				curLines = append(curLines, line)
				if strings.HasPrefix(trimmed, "name:") && curBlock.Name == "" {
					curBlock.Name = strings.Trim(strings.TrimSpace(strings.TrimPrefix(trimmed, "name:")), `"'`)
				} else if strings.HasPrefix(trimmed, "prefix:") && curBlock.Prefix == "" {
					curBlock.Prefix = strings.Trim(strings.TrimSpace(strings.TrimPrefix(trimmed, "prefix:")), `"'`)
				} else if strings.HasPrefix(trimmed, "base-url:") && curBlock.BaseURL == "" {
					curBlock.BaseURL = strings.Trim(strings.TrimSpace(strings.TrimPrefix(trimmed, "base-url:")), `"'`)
				} else if strings.HasPrefix(trimmed, "- name:") {
					// model item (indented deeper than provider level)
					mName := strings.Trim(strings.TrimSpace(strings.TrimPrefix(trimmed, "- name:")), `"'`)
					curBlock.Models = append(curBlock.Models, mName)
				}
			}
		}
	}

	if curBlock != nil {
		curBlock.RawLines = strings.Join(curLines, "\n")
		curBlock.LineEnd = len(lines) - 1
		blocks = append(blocks, *curBlock)
	}

	return blocks
}

// cleanOrphanConfigProviders creates a backup and rewrites config.yaml removing orphan providers
func cleanOrphanConfigProviders(configPath, authDir string) ([]string, error) {
	if configPath == "" {
		configPath = resolveConfigPath()
	}
	if authDir == "" {
		authDir = resolveAuthDir()
	}

	orphans := scanOrphanConfigProviders(configPath, authDir)
	if len(orphans) == 0 {
		return nil, nil
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	// 1. Create atomic backup with timestamp
	timestamp := time.Now().UTC().Format("20060102-150405")
	backupPath := fmt.Sprintf("%s.bak-pre-clean-%s", configPath, timestamp)
	if err := atomicWriteFile(backupPath, content, 0644); err != nil {
		return nil, fmt.Errorf("crear backup de config: %w", err)
	}

	orphanNames := make(map[string]struct{})
	for _, o := range orphans {
		orphanNames[strings.ToLower(strings.TrimSpace(o.Name))] = struct{}{}
	}

	// Refined rewrite: remove blocks cleanly
	cleanYAML := removeOrphanBlocksCleanly(string(content), orphanNames)

	// Structural sanity guards: a legitimate purge keeps every root section
	// and only shrinks the openai-compatibility list. A fixed size threshold
	// would wrongly block full purges (real config drops to ~12% of its size).
	if len(cleanYAML) == 0 || !strings.Contains(cleanYAML, "openai-compatibility") {
		return nil, fmt.Errorf("resultado de limpieza inválido: se aborta para proteger config.yaml")
	}
	if rootKey := firstRootYAMLKey(string(content)); rootKey != "" && !strings.Contains(cleanYAML, rootKey+":") {
		return nil, fmt.Errorf("la limpieza perdería la sección raíz %q: se aborta para proteger config.yaml", rootKey)
	}

	// 2. Atomic write to config.yaml via temporary file + rename
	if err := atomicWriteFile(configPath, []byte(cleanYAML), 0644); err != nil {
		return nil, fmt.Errorf("guardar config.yaml limpio: %w", err)
	}

	var cleanedResult []string
	for _, o := range orphans {
		cleanedResult = append(cleanedResult, o.Name)
	}

	return cleanedResult, nil
}

// atomicWriteFile writes data to a temporary file in the same directory, syncs to disk,
// and atomically renames it to destination, preventing truncated or half-written files.
func atomicWriteFile(dest string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(dest)
	tmpFile, err := os.CreateTemp(dir, ".auto-switcher-atomic-*.tmp")
	if err != nil {
		return fmt.Errorf("crear archivo temporal: %w", err)
	}
	tmpName := tmpFile.Name()

	defer func() {
		if tmpName != "" {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("escribir archivo temporal: %w", err)
	}

	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("sincronizar a disco: %w", err)
	}

	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("cerrar archivo temporal: %w", err)
	}

	if err := os.Chmod(tmpName, perm); err != nil {
		return fmt.Errorf("ajustar permisos: %w", err)
	}

	if err := os.Rename(tmpName, dest); err != nil {
		return fmt.Errorf("renombrar atomico: %w", err)
	}

	tmpName = "" // Success, disarm defer cleanup
	return nil
}

func removeOrphanBlocksCleanly(yamlText string, orphanNames map[string]struct{}) string {
	blocks := extractOpenAICompatBlocks(yamlText)
	if len(blocks) == 0 {
		return yamlText
	}

	lines := strings.Split(yamlText, "\n")
	linesToRemove := make(map[int]struct{})

	keptBlocks := 0
	for _, b := range blocks {
		lower := strings.ToLower(strings.TrimSpace(b.Name))
		if _, isOrphan := orphanNames[lower]; isOrphan {
			for i := b.LineStart; i <= b.LineEnd; i++ {
				linesToRemove[i] = struct{}{}
			}
		} else {
			keptBlocks++
		}
	}

	var out []string
	for i, l := range lines {
		if _, remove := linesToRemove[i]; remove {
			continue
		}
		// When every provider was purged, collapse the section to an empty
		// list in place. The previous regex approach silently failed when the
		// section sat at end-of-file (the real 2026-10-12 config layout),
		// leaving a dangling `openai-compatibility:` null key.
		if keptBlocks == 0 && strings.HasPrefix(strings.TrimSpace(l), "openai-compatibility:") {
			indent := l[:len(l)-len(strings.TrimLeft(l, " "))]
			out = append(out, indent+"openai-compatibility: []")
			continue
		}
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}

// cleanOrphanArtifacts purges any detected orphan build artifacts.
func cleanOrphanArtifacts(artifacts []string) []string {
	var purged []string
	runtimePluginsDir := resolveRuntimePluginsDir()
	for _, art := range artifacts {
		// Defense in depth: never delete a shared library from the runtime
		// plugins directory — those are live deployed plugins.
		if strings.HasSuffix(art, ".so") && isSameDir(runtimePluginsDir, filepath.Dir(art)) {
			continue
		}
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
	res.OrphanProviders = scanOrphanConfigProviders("", authDir)

	res.Message = fmt.Sprintf("Escaneo completado: %d cuentas con residuos detectadas.", len(res.ResidualAccounts))
	if len(res.OrphanProviders) > 0 {
		res.Message += fmt.Sprintf(" Se detectaron %d proveedor(es) huérfano(s) en config.yaml.", len(res.OrphanProviders))
	}
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

	purgedProviders, provErr := cleanOrphanConfigProviders("", authDir)
	if provErr == nil && len(purgedProviders) > 0 {
		res.PurgedProviders = purgedProviders
		res.Message += fmt.Sprintf(" Se purgaron %d proveedor(es) huérfano(s) de config.yaml.", len(purgedProviders))
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

// firstRootYAMLKey returns the first top-level mapping key of a YAML document.
// Used as a structural guard: any legitimate section purge must preserve it.
func firstRootYAMLKey(yamlText string) string {
	for _, line := range strings.Split(yamlText, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "-") {
			continue
		}
		if idx := strings.Index(trimmed, ":"); idx > 0 && !strings.HasPrefix(line, " ") {
			return trimmed[:idx]
		}
	}
	return ""
}
