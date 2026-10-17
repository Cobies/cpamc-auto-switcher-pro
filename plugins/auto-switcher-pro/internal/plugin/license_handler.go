package plugin

import (
	"encoding/json"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"auto-switcher-pro/internal/license"
)

func isLicensePath(path string) bool {
	return strings.Contains(path, "/auto-switcher-pro/license/")
}

// getLocalManagementKey resolves the local management key from env or disk storage.
func getLocalManagementKey() string {
	// 1. Environment variables
	if k := os.Getenv("CLIPROXY_MANAGEMENT_KEY"); strings.TrimSpace(k) != "" {
		return strings.TrimSpace(k)
	}
	if k := os.Getenv("CPAMC_MANAGEMENT_KEY"); strings.TrimSpace(k) != "" {
		return strings.TrimSpace(k)
	}

	// 2. ~/.cliproxy_management_key
	if u, err := user.Current(); err == nil && u.HomeDir != "" {
		p := filepath.Join(u.HomeDir, ".cliproxy_management_key")
		if data, err := os.ReadFile(p); err == nil && len(strings.TrimSpace(string(data))) > 0 {
			return strings.TrimSpace(string(data))
		}
	}

	// 3. Common fallback locations
	for _, p := range []string{
		"/root/.cliproxy_management_key",
		".cliproxy_management_key",
		"/tmp/.cliproxy_management_key",
	} {
		if data, err := os.ReadFile(p); err == nil && len(strings.TrimSpace(string(data))) > 0 {
			return strings.TrimSpace(string(data))
		}
	}

	return ""
}

func handleLicenseHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}

	cleanPath := strings.Split(req.Path, "?")[0]

	switch {
	case strings.HasSuffix(cleanPath, "/session") || strings.HasSuffix(cleanPath, "/handshake"):
		if method != http.MethodGet {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "GET required",
			})
		}

		status := license.GetLicenseStatus()
		if status.Status != "trial" && status.Status != "active" {
			return jsonManagementResponse(http.StatusOK, map[string]interface{}{
				"ok":          false,
				"authorized":  false,
				"status":      status.Status,
				"machine_id":  status.MachineID,
				"mac_address": status.MACAddress,
				"message":     "La licencia de esta máquina ha expirado o no es válida.",
			})
		}

		key := getLocalManagementKey()
		return jsonManagementResponse(http.StatusOK, map[string]interface{}{
			"ok":             true,
			"authorized":     true,
			"status":         status.Status,
			"machine_id":     status.MachineID,
			"mac_address":    status.MACAddress,
			"days_remaining": status.DaysRemaining,
			"management_key": key,
		})

	case strings.HasSuffix(cleanPath, "/status"):
		if method != http.MethodGet {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "GET required",
			})
		}
		status := license.GetLicenseStatus()
		return jsonManagementResponse(http.StatusOK, status)

	case strings.HasSuffix(cleanPath, "/activate"):
		if method != http.MethodPost {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "POST required",
			})
		}

		type ActivateReq struct {
			Key string `json:"key"`
		}
		var body ActivateReq
		if len(req.Body) > 0 {
			_ = json.Unmarshal(req.Body, &body)
		}

		if strings.TrimSpace(body.Key) == "" {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "missing_key",
				"message": "Debes proporcionar una clave de activación",
			})
		}

		updatedStatus, err := license.ActivateKey(strings.TrimSpace(body.Key))
		if err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "activation_failed",
				"message": err.Error(),
			})
		}

		return jsonManagementResponse(http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "¡Licencia activada con éxito!",
			"license": updatedStatus,
		})

	case strings.HasSuffix(cleanPath, "/request-reset"):
		if method != http.MethodPost {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "POST required",
			})
		}
		type RequestResetReq struct {
			Email string `json:"email"`
		}
		var body RequestResetReq
		if len(req.Body) > 0 {
			_ = json.Unmarshal(req.Body, &body)
		}
		if strings.TrimSpace(body.Email) == "" {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "missing_email",
				"message": "Debes proporcionar tu correo electrónico",
			})
		}
		res, err := license.RequestReset(body.Email)
		if err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "request_failed",
				"message": err.Error(),
			})
		}
		return jsonManagementResponse(http.StatusOK, res)

	case strings.HasSuffix(cleanPath, "/verify-reset"):
		if method != http.MethodPost {
			return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
				"error":   "method_not_allowed",
				"message": "POST required",
			})
		}
		type VerifyResetReq struct {
			Email string `json:"email"`
			PIN   string `json:"pin"`
		}
		var body VerifyResetReq
		if len(req.Body) > 0 {
			_ = json.Unmarshal(req.Body, &body)
		}
		if strings.TrimSpace(body.Email) == "" || strings.TrimSpace(body.PIN) == "" {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "missing_parameters",
				"message": "Correo y código PIN son requeridos",
			})
		}
		updatedStatus, err := license.VerifyReset(body.Email, body.PIN)
		if err != nil {
			return jsonManagementResponse(http.StatusBadRequest, map[string]string{
				"error":   "verification_failed",
				"message": err.Error(),
			})
		}
		return jsonManagementResponse(http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "¡Licencia transferida y activada con éxito!",
			"license": updatedStatus,
		})

	default:
		return jsonManagementResponse(http.StatusNotFound, map[string]string{
			"error":   "not_found",
			"message": "license endpoint not found",
		})
	}
}
