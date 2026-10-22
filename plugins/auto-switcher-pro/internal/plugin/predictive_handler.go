package plugin

import (
	"encoding/json"
	"net/http"
	"strings"
)

const predictiveRoutePath = "/auto-switcher-pro/predictive"

func isPredictivePath(p string) bool {
	norm := strings.TrimSpace(p)
	return strings.Contains(norm, predictiveRoutePath)
}

func handlePredictiveHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	pe := GetPredictiveEngine()
	normPath := strings.ToLower(strings.TrimSpace(req.Path))

	// Sub-ruta dedicada para estimación de recuperación (/auto-switcher-pro/predictive/eta)
	if strings.Contains(normPath, "/eta") {
		if method == http.MethodGet {
			return jsonManagementResponse(http.StatusOK, map[string]interface{}{
				"ok":   true,
				"etas": pe.GetAllRecoveryETAs(),
			})
		}
	}

	// Sub-ruta dedicada para telemetría viva de cuotas (/auto-switcher-pro/predictive/telemetry o /quota)
	if strings.Contains(normPath, "/telemetry") || strings.Contains(normPath, "/quota") {
		if method == http.MethodGet {
			return jsonManagementResponse(http.StatusOK, map[string]interface{}{
				"ok":     true,
				"quotas": pe.GetAllLiveQuotas(),
			})
		}
		if method == http.MethodPost {
			var single AccountQuotaTelemetry
			if err := json.Unmarshal(req.Body, &single); err == nil && single.AccountKey != "" {
				pe.RecordLiveQuota(single)
				return jsonManagementResponse(http.StatusOK, map[string]interface{}{
					"ok":      true,
					"message": "Telemetría de cuota registrada con éxito",
					"quota":   single,
				})
			}
			var batch struct {
				Quotas []AccountQuotaTelemetry `json:"quotas"`
			}
			if err := json.Unmarshal(req.Body, &batch); err == nil && len(batch.Quotas) > 0 {
				for _, q := range batch.Quotas {
					pe.RecordLiveQuota(q)
				}
				return jsonManagementResponse(http.StatusOK, map[string]interface{}{
					"ok":      true,
					"count":   len(batch.Quotas),
					"message": "Lote de telemetría registrado con éxito",
				})
			}
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "invalid_payload",
				"message": "Formato de telemetría de cuota inválido",
			})
		}
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "Método no permitido",
		})
	}

	if method == http.MethodGet {
		cfg := pe.GetConfig()
		reg := activeRegistry()
		pools := reg.ListPools()

		type AccountFatigue struct {
			Email       string  `json:"email"`
			FatiguePct  float64 `json:"fatigue_pct"`
			IsCooling   bool    `json:"is_cooling"`
			MinutesLeft int     `json:"minutes_left"`
		}

		accs := make([]AccountFatigue, 0)
		for _, p := range pools {
			allAccs := append([]string{p.LeaderAuth}, p.Reserves...)
			for _, auth := range allAccs {
				email := strings.TrimSuffix(strings.TrimPrefix(auth, "antigravity-"), ".json")
				fatigue, cooling, left := pe.GetAccountStatus(email)
				accs = append(accs, AccountFatigue{
					Email:       email,
					FatiguePct:  fatigue,
					IsCooling:   cooling,
					MinutesLeft: left,
				})
			}
		}

		return jsonManagementResponse(http.StatusOK, map[string]interface{}{
			"ok":       true,
			"config":   cfg,
			"accounts": accs,
		})
	}

	if method == http.MethodPost {
		var newCfg PredictiveConfig
		if len(req.Body) > 0 {
			if err := json.Unmarshal(req.Body, &newCfg); err != nil {
				return jsonManagementResponse(http.StatusBadRequest, map[string]string{
					"error":   "invalid_json",
					"message": "Configuración JSON inválida",
				})
			}
		}

		pe.SetConfig(newCfg)

		return jsonManagementResponse(http.StatusOK, map[string]interface{}{
			"ok":     true,
			"config": pe.GetConfig(),
		})
	}

	return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
		"error":   "method_not_allowed",
		"message": "Método no permitido",
	})
}
