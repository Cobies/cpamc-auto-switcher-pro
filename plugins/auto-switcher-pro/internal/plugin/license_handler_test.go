package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

func TestLicenseHTTP_StatusAndValidation(t *testing.T) {
	t.Run("GET /auto-switcher-pro/license/status", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodGet,
			Path:   "/auto-switcher-pro/license/status",
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		_ = json.Unmarshal(out, &env)
		var resp ManagementResponsePayload
		_ = json.Unmarshal(env.Result, &resp)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200, got %d", resp.StatusCode)
		}

		bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
		var status map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &status)
		if status["machine_id"] == nil || status["machine_id"] == "" {
			t.Errorf("expected machine_id in response")
		}
		if status["can_rotate"] != true {
			t.Errorf("expected can_rotate=true in initial trial state")
		}
	})

	t.Run("POST /auto-switcher-pro/license/activate invalid key fails", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodPost,
			Path:   "/auto-switcher-pro/license/activate",
			Body:   []byte(`{"key":"invalid.key.structure"}`),
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		_ = json.Unmarshal(out, &env)
		var resp ManagementResponsePayload
		_ = json.Unmarshal(env.Result, &resp)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("expected 400 for bad key, got %d", resp.StatusCode)
		}
	})
}
