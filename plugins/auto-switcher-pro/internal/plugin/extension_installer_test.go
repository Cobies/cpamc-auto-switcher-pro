package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestExtensionEndpoints(t *testing.T) {
	t.Run("GET /auto-switcher-pro/extension/detect", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodGet,
			Path:   "/auto-switcher-pro/extension/detect",
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		if err := json.Unmarshal(out, &env); err != nil {
			t.Fatalf("failed to unmarshal envelope: %v", err)
		}

		var resp ManagementResponsePayload
		if err := json.Unmarshal(env.Result, &resp); err != nil {
			t.Fatalf("failed to unmarshal resp: %v", err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200, got %d", resp.StatusCode)
		}

		bodyBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
		var det ExtensionDetectResponse
		_ = json.Unmarshal(bodyBytes, &det)
		if len(det.Targets) == 0 {
			t.Errorf("expected targets to be populated")
		}
		if !strings.Contains(det.CurlCommand, "install.sh") {
			t.Errorf("expected curl command to reference install.sh")
		}
	})

	t.Run("GET /auto-switcher-pro/extension/install.sh", func(t *testing.T) {
		req := ManagementRequestPayload{
			Method: http.MethodGet,
			Path:   "/auto-switcher-pro/extension/install.sh",
		}
		rawReq, _ := json.Marshal(req)
		out, err := HandleManagementHTTP(rawReq)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var env Envelope
		if err := json.Unmarshal(out, &env); err != nil {
			t.Fatalf("failed to unmarshal envelope: %v", err)
		}

		var resp ManagementResponsePayload
		if err := json.Unmarshal(env.Result, &resp); err != nil {
			t.Fatalf("failed to unmarshal resp: %v", err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200, got %d", resp.StatusCode)
		}

		scriptBytes, _ := base64.StdEncoding.DecodeString(resp.Body)
		script := string(scriptBytes)
		if !strings.Contains(script, "#!/usr/bin/env bash") {
			t.Errorf("expected bash shebang in script")
		}
		if !strings.Contains(script, "cpamc-auto-switcher") {
			t.Errorf("expected cpamc-auto-switcher in script")
		}
	})
}
