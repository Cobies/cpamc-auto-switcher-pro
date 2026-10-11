package plugin

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
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

