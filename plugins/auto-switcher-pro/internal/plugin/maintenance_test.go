package plugin

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaintenanceScanAndClean(t *testing.T) {
	authDir := t.TempDir()
	staticDir := t.TempDir()

	// 1. Create a dummy management.html in staticDir
	mgmtFile := filepath.Join(staticDir, "management.html")
	_ = os.WriteFile(mgmtFile, []byte("<!doctype html><html><body>console</body></html>"), 0644)

	// 2. Create an account with residual foreign models
	credFile := filepath.Join(authDir, "antigravity-test@gmail.com.json")
	credContent := `{
		"account": "test@gmail.com",
		"provider": "antigravity",
		"excluded_models": [
			"gemini-2.5-pro",
			"nv/google/gemma-2b",
			"ocgo/kimi-k3",
			"nvidia/llama-3.1-nemotron-70b-instruct"
		]
	}`
	_ = os.WriteFile(credFile, []byte(credContent), 0644)

	// 3. Scan health
	scanRes, err := scanHealth(authDir, staticDir)
	if err != nil {
		t.Fatalf("scanHealth failed: %v", err)
	}
	if len(scanRes.ResidualAccounts) != 1 {
		t.Fatalf("expected 1 residual account, got %d", len(scanRes.ResidualAccounts))
	}
	account := scanRes.ResidualAccounts[0]
	if account.ForeignExcluded != 4 {
		t.Fatalf("expected 4 residual excluded models, got %d", account.ForeignExcluded)
	}

	// 4. Clean health
	cleanRes, err := cleanHealth(authDir)
	if err != nil {
		t.Fatalf("cleanHealth failed: %v", err)
	}
	if len(cleanRes.CleanedFiles) != 1 {
		t.Fatalf("expected 1 cleaned file, got %d", len(cleanRes.CleanedFiles))
	}

	// 5. Verify the file now is reset to factory default (0 excluded models)
	cleanedData, _ := os.ReadFile(credFile)
	var updatedCred map[string]any
	_ = json.Unmarshal(cleanedData, &updatedCred)
	updatedEx, _ := updatedCred["excluded_models"].([]any)
	if len(updatedEx) != 0 {
		t.Fatalf("unexpected cleaned exclusions (expected 0): %+v", updatedEx)
	}

	// 6. Rescan confirms zero residuals
	scanRes2, _ := scanHealth(authDir, staticDir)
	if len(scanRes2.ResidualAccounts) != 0 {
		t.Fatalf("expected 0 residual accounts after cleaning, got %d", len(scanRes2.ResidualAccounts))
	}
}

func TestExtractConsoleVersion(t *testing.T) {
	htmlSample := `
		(0,H.jsx)(` + "`" + `div` + "`" + `,{className:W9.tileLabel,children:e(` + "`" + `footer.version` + "`" + `)}),
		(0,H.jsx)(` + "`" + `div` + "`" + `,{className:W9.tileValue,children:` + "`" + `v1.26.1` + "`" + `})
	`
	ver := extractConsoleVersion(htmlSample)
	if ver != "v1.26.1" {
		t.Fatalf("expected v1.26.1, got %q", ver)
	}

	htmlSampleGeneric := `{"tileValue,children:"1.25.0"}`
	ver2 := extractConsoleVersion(htmlSampleGeneric)
	if ver2 != "v1.25.0" {
		t.Fatalf("expected v1.25.0, got %q", ver2)
	}

	if normalizeVersion("1.26.1") != "v1.26.1" {
		t.Fatalf("normalizeVersion failed: %q", normalizeVersion("1.26.1"))
	}
	if normalizeVersion("v1.26.1") != "v1.26.1" {
		t.Fatalf("normalizeVersion failed: %q", normalizeVersion("v1.26.1"))
	}
}

func TestMaintenanceHTTPDispatch(t *testing.T) {
	req := ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   maintenanceScanRoutePath,
	}
	rawResp, err := handleMaintenanceHTTP(req)
	if err != nil {
		t.Fatalf("handleMaintenanceHTTP failed: %v", err)
	}
	// OKEnvelope wraps the JSON in {"ok": true, "data": ...}
	var env map[string]any
	_ = json.Unmarshal(rawResp, &env)
	if okVal, ok := env["ok"].(bool); !ok || !okVal {
		t.Fatalf("expected envelope ok=true, got %v", env)
	}
}

func TestMaintenanceOrphanArtifactsDetectionAndClean(t *testing.T) {
	tempPluginDir := t.TempDir()
	t.Setenv("AUTO_SWITCHER_PLUGIN_DIR", tempPluginDir)

	// Create dummy orphan header and shared library in source directory
	headerFile := filepath.Join(tempPluginDir, "auto-switcher-pro-linux-amd64.h")
	soFile := filepath.Join(tempPluginDir, "auto-switcher-pro-linux-amd64.so")
	_ = os.WriteFile(headerFile, []byte("// orphan header"), 0644)
	_ = os.WriteFile(soFile, []byte("ELF binary dummy"), 0755)

	// Scan should detect both orphan artifacts
	orphans := scanOrphanArtifacts()
	if len(orphans) < 2 {
		t.Fatalf("expected at least 2 orphan artifacts, got %d (%v)", len(orphans), orphans)
	}

	// Clean should purge them
	purged := cleanOrphanArtifacts(orphans)
	if len(purged) < 2 {
		t.Fatalf("expected at least 2 purged artifacts, got %d (%v)", len(purged), purged)
	}

	// Confirm files are physically deleted
	if _, err := os.Stat(headerFile); !os.IsNotExist(err) {
		t.Fatalf("expected header file to be deleted, but it still exists")
	}
	if _, err := os.Stat(soFile); !os.IsNotExist(err) {
		t.Fatalf("expected so file to be deleted, but it still exists")
	}

	// Rescan should find 0 orphans
	orphansAfter := scanOrphanArtifacts()
	for _, o := range orphansAfter {
		if o == headerFile || o == soFile {
			t.Fatalf("orphan %s was not cleaned properly", o)
		}
	}
}

func TestUniversalOrphanProvidersInConfigScanAndClean(t *testing.T) {
	tempDir := t.TempDir()
	authDir := filepath.Join(tempDir, "auth")
	_ = os.MkdirAll(authDir, 0755)
	configPath := filepath.Join(tempDir, "config.yaml")

	// Sample config with 3 providers under openai-compatibility:
	// 1. "provider-alpha": No auth file on disk -> ORPHAN
	// 2. "provider-beta": Has auth file beta.json -> ACTIVE
	// 3. "provider-gamma": No auth file on disk -> ORPHAN
	configYamlContent := `
server:
  port: 8317
api-keys:
  openai-compatibility:
    - name: provider-alpha
      prefix: alpha
      base-url: https://alpha.ai/v1
      models:
        - name: alpha-model-1
          alias: alpha-model-1
        - name: alpha-model-2
          alias: alpha-model-2
      keys:
        - api-key: sk-alpha
    - name: provider-beta
      prefix: beta
      base-url: https://beta.ai/v1
      models:
        - name: beta-model-1
          alias: beta-model-1
      keys:
        - api-key: sk-beta
    - name: provider-gamma
      prefix: gamma
      base-url: https://gamma.ai/v1
      models:
        - name: gamma-model-1
          alias: gamma-model-1
      keys:
        - api-key: sk-gamma
other-config: true
`
	_ = os.WriteFile(configPath, []byte(configYamlContent), 0644)

	// Create auth file only for provider-beta
	betaAuth := filepath.Join(authDir, "provider-beta.json")
	_ = os.WriteFile(betaAuth, []byte(`{"account":"beta@test.com","provider":"provider-beta"}`), 0644)

	// Set env overrides for test
	t.Setenv("AUTO_SWITCHER_CONFIG_PATH", configPath)

	// 1. Scan orphan providers
	orphans := scanOrphanConfigProviders(configPath, authDir)
	if len(orphans) != 2 {
		t.Fatalf("expected 2 orphan providers (alpha and gamma), got %d: %+v", len(orphans), orphans)
	}

	names := []string{orphans[0].Name, orphans[1].Name}
	if names[0] != "provider-alpha" && names[1] != "provider-alpha" {
		t.Fatalf("expected provider-alpha to be identified as orphan, got %+v", names)
	}
	if names[0] != "provider-gamma" && names[1] != "provider-gamma" {
		t.Fatalf("expected provider-gamma to be identified as orphan, got %+v", names)
	}

	// 2. Clean orphan providers
	cleaned, err := cleanOrphanConfigProviders(configPath, authDir)
	if err != nil {
		t.Fatalf("cleanOrphanConfigProviders failed: %v", err)
	}
	if len(cleaned) != 2 {
		t.Fatalf("expected 2 cleaned providers, got %d: %+v", len(cleaned), cleaned)
	}

	// 3. Verify backup file was created
	backups, _ := filepath.Glob(filepath.Join(tempDir, "config.yaml.bak-pre-clean-*"))
	if len(backups) == 0 {
		t.Fatalf("expected backup file config.yaml.bak-pre-clean-* to be created")
	}

	// 4. Verify config.yaml now only contains provider-beta and preserves other-config
	newContent, _ := os.ReadFile(configPath)
	strContent := string(newContent)
	if strings.Contains(strContent, "provider-alpha") {
		t.Fatalf("expected provider-alpha to be removed, but still found in config")
	}
	if strings.Contains(strContent, "provider-gamma") {
		t.Fatalf("expected provider-gamma to be removed, but still found in config")
	}
	if !strings.Contains(strContent, "provider-beta") {
		t.Fatalf("expected provider-beta to be preserved, but missing from config")
	}
	if !strings.Contains(strContent, "other-config: true") {
		t.Fatalf("expected other-config to be preserved, but missing from config")
	}

	// 5. Rescan confirms 0 orphan providers
	orphansAfter := scanOrphanConfigProviders(configPath, authDir)
	if len(orphansAfter) != 0 {
		t.Fatalf("expected 0 orphan providers after clean, got %d: %+v", len(orphansAfter), orphansAfter)
	}

	// 6. Verify atomic write safety: no leftover .auto-switcher-atomic-*.tmp files exist
	tmpFiles, _ := filepath.Glob(filepath.Join(tempDir, ".auto-switcher-atomic-*.tmp"))
	if len(tmpFiles) != 0 {
		t.Fatalf("expected 0 leftover atomic temp files, got %d: %+v", len(tmpFiles), tmpFiles)
	}
}

func TestCleanOrphanProvidersNeverTruncatesWhenSectionIsLast(t *testing.T) {
	tempDir := t.TempDir()
	authDir := filepath.Join(tempDir, "auth")
	_ = os.MkdirAll(authDir, 0755)
	configPath := filepath.Join(tempDir, "config.yaml")

	// Fixture reproduces the REAL production layout (2026-10-12 incident):
	// openai-compatibility is the LAST section of the file and all its
	// providers are orphans.
	configYamlContent := `plugins:
    enabled: true
    dir: plugins
server:
    port: 8317
api-keys:
    openai-compatibility:
        - name: provider-alpha
          prefix: alpha
          base-url: https://alpha.ai/v1
          models:
            - name: alpha-model-1
              alias: alpha-model-1
          keys:
            - api-key: sk-alpha
              weight: 1
        - name: provider-gamma
          prefix: gamma
          base-url: https://gamma.ai/v1
          models:
            - name: gamma-model-1
              alias: gamma-model-1
          keys:
            - api-key: sk-gamma
              weight: 1
`
	_ = os.WriteFile(configPath, []byte(configYamlContent), 0644)

	cleaned, err := cleanOrphanConfigProviders(configPath, authDir)
	if err != nil {
		t.Fatalf("cleanOrphanConfigProviders failed: %v", err)
	}
	if len(cleaned) != 2 {
		t.Fatalf("expected 2 purged providers, got %d: %+v", len(cleaned), cleaned)
	}

	newContent, _ := os.ReadFile(configPath)
	s := string(newContent)
	// Regression: the cleaned config must keep the full header and collapse
	// the section to [] — never a dangling tail fragment.
	if !strings.Contains(s, "plugins:") {
		t.Fatalf("cleaned config lost root section 'plugins:' (truncation regression):\n%s", s)
	}
	if !strings.Contains(s, "server:") {
		t.Fatalf("cleaned config lost root section 'server:' (truncation regression):\n%s", s)
	}
	if !strings.Contains(s, "openai-compatibility: []") {
		t.Fatalf("expected 'openai-compatibility: []' at end-of-file layout:\n%s", s)
	}
	if strings.Contains(s, "provider-alpha") || strings.Contains(s, "provider-gamma") {
		t.Fatalf("purged providers still present in cleaned config:\n%s", s)
	}
}

func TestScanOrphanArtifactsNeverFlagsLivePluginInRuntimeDir(t *testing.T) {
	// Regression of the 2026-10-12 incident: the user clicked "Limpiar
	// artefactos" and the live plugin binary was deleted from the runtime
	// plugins directory. Live .so files there must never be flagged.
	tempDir := t.TempDir()
	runtimePlugins := filepath.Join(tempDir, "plugins")
	_ = os.MkdirAll(runtimePlugins, 0755)
	configPath := filepath.Join(tempDir, "config.yaml")
	_ = os.WriteFile(configPath, []byte("server:\n    port: 8317\n"), 0644)

	liveSO := filepath.Join(runtimePlugins, "auto-switcher-pro-linux-amd64.so")
	_ = os.WriteFile(liveSO, []byte("ELF live plugin"), 0755)
	strayH := filepath.Join(runtimePlugins, "auto-switcher-pro-linux-amd64.h")
	_ = os.WriteFile(strayH, []byte("// stray header"), 0644)

	t.Setenv("AUTO_SWITCHER_CONFIG_PATH", configPath)
	t.Chdir(tempDir) // makes the "plugins" scan target resolve to runtimePlugins

	orphans := scanOrphanArtifacts()
	for _, o := range orphans {
		if filepath.Clean(o) == filepath.Clean(liveSO) {
			t.Fatalf("live plugin binary must never be flagged as orphan: %+v", orphans)
		}
	}
	foundStray := false
	for _, o := range orphans {
		if filepath.Clean(o) == filepath.Clean(strayH) {
			foundStray = true
		}
	}
	if !foundStray {
		t.Fatalf("stray header in runtime dir must still be flagged: %+v", orphans)
	}

	// Clean must also never remove the live binary (defense in depth).
	_ = cleanOrphanArtifacts(orphans)
	if _, err := os.Stat(liveSO); err != nil {
		t.Fatalf("live plugin binary was deleted by cleanOrphanArtifacts: %v", err)
	}
	if _, err := os.Stat(strayH); !os.IsNotExist(err) {
		t.Fatalf("stray header should have been purged, but still exists")
	}
}

func TestReplaceOrCopyFile(t *testing.T) {
	tempDir := t.TempDir()
	src := filepath.Join(tempDir, "source.html")
	dest := filepath.Join(tempDir, "dest.html")

	_ = os.WriteFile(src, []byte("<!doctype html>v1.26.4"), 0644)
	_ = os.WriteFile(dest, []byte("<!doctype html>v1.26.1"), 0644)

	if err := replaceOrCopyFile(src, dest, 0644); err != nil {
		t.Fatalf("replaceOrCopyFile failed: %v", err)
	}

	content, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest failed: %v", err)
	}
	if string(content) != "<!doctype html>v1.26.4" {
		t.Fatalf("expected <!doctype html>v1.26.4, got %q", string(content))
	}
}

func TestAtomicWriteFileOverwritesExisting(t *testing.T) {
	tempDir := t.TempDir()
	dest := filepath.Join(tempDir, "test.yaml")
	_ = os.WriteFile(dest, []byte("initial: data\n"), 0644)

	newData := []byte("updated: data\n")
	if err := atomicWriteFile(dest, newData, 0644); err != nil {
		t.Fatalf("atomicWriteFile failed: %v", err)
	}

	readBack, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read destination failed: %v", err)
	}
	if string(readBack) != string(newData) {
		t.Fatalf("expected %q, got %q", string(newData), string(readBack))
	}

	// Verify no temporary files left in tempDir
	entries, _ := os.ReadDir(tempDir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".auto-switcher-atomic-") {
			t.Fatalf("residual atomic temp file found: %s", e.Name())
		}
	}
}
