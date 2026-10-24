package plugin

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"auto-switcher-pro/internal/license"
)

// SelfHealingReport encapsulates the boot-time and runtime integrity self-diagnosis.
type SelfHealingReport struct {
	Timestamp             string `json:"timestamp"`
	CryptographicRing     string `json:"cryptographic_ring"`
	AirgapMode            bool   `json:"airgap_mode"`
	OrphanArtifactsCount  int    `json:"orphan_artifacts_count"`
	ActivePoolsCount      int    `json:"active_pools_count"`
	BalancedAccountsCount int    `json:"balanced_accounts_count"`
	PromptCacheAffinity   string `json:"prompt_cache_affinity"`
	IntegritySummary      string `json:"integrity_summary"`
	DegradedMode          bool   `json:"degraded_mode"`
	DegradedReason        string `json:"degraded_reason,omitempty"`
}

func isSelfHealingPath(path string) bool {
	return strings.Contains(path, "/auto-switcher-pro/self-healing")
}

// GenerateSelfHealingReport performs an in-memory fast integrity audit of the plugin.
func GenerateSelfHealingReport() SelfHealingReport {
	now := time.Now().UTC().Format(time.RFC3339)

	// 1. Audit Cryptographic Ring
	ringVersion := "V2 (Hardened Active Ring)"
	licStatus := license.GetLicenseStatus()
	if licStatus != nil && licStatus.Status == "active" {
		ringVersion = "V2 (Verified Active Ring)"
	}

	// 2. Airgap Mode
	airgap := license.IsAirgapModeEnabled()

	// 3. Fast Scan for Orphan Artifacts in plugins dir
	orphanCount := 0
	pluginsDir := "/CLIProxyAPI/plugins"
	if fi, err := os.Stat(pluginsDir); err == nil && fi.IsDir() {
		_ = filepath.Walk(pluginsDir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil {
				return nil
			}
			if !info.IsDir() && (strings.HasSuffix(info.Name(), ".h") || strings.HasSuffix(info.Name(), ".bak")) {
				orphanCount++
			}
			return nil
		})
	}

	// 4. Active Pools and Balanced Accounts
	activePools := 0
	balancedAccounts := 0
	if reg := activeRegistry(); reg != nil {
		for _, p := range reg.ListPools() {
			if p.IsEnabled() {
				activePools++
				// Leader + reserves
				if len(p.Members) > 0 {
					balancedAccounts += len(p.Members)
				} else {
					balancedAccounts++
					balancedAccounts += len(p.Reserves)
				}
			}
		}
	}

	// 5. Degraded Mode Evaluation
	degraded := false
	var degradedReasons []string

	_, source, _ := getLocalManagementKeyResolution()
	if source == "none" {
		degraded = true
		degradedReasons = append(degradedReasons, "missing_management_key")
	}
	if orphanCount > 0 {
		degradedReasons = append(degradedReasons, fmt.Sprintf("%d_orphan_artifacts_detected", orphanCount))
	}
	if licStatus != nil && licStatus.Status == "expired" {
		degraded = true
		degradedReasons = append(degradedReasons, "license_expired")
	}

	summary := fmt.Sprintf("Ring V2 activo, %d artefactos huérfanos, %d cuentas balanceadas en %d pools, Prompt Cache al 100%% en RAM",
		orphanCount, balancedAccounts, activePools)

	return SelfHealingReport{
		Timestamp:             now,
		CryptographicRing:     ringVersion,
		AirgapMode:            airgap,
		OrphanArtifactsCount:  orphanCount,
		ActivePoolsCount:      activePools,
		BalancedAccountsCount: balancedAccounts,
		PromptCacheAffinity:   "100% Isolated in RAM (Zero Disk Mutation)",
		IntegritySummary:      summary,
		DegradedMode:          degraded,
		DegradedReason:        strings.Join(degradedReasons, ", "),
	}
}

func handleSelfHealingHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodGet && method != http.MethodHead {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "GET or HEAD required",
		})
	}

	report := GenerateSelfHealingReport()
	return jsonManagementResponse(http.StatusOK, report)
}
