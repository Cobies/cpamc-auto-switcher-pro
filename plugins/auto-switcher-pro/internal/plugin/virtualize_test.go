package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// stubCaller is an in-memory implementation of the host bridge used to exercise
// Virtualize without a live CLIProxyAPI host.
type stubCaller struct {
	listFiles      []hostAuthFileEntry
	getJSON        json.RawMessage
	saveName       string
	savePath       string
	calls          []string
	lastGetAuth    string
	lastSaveReq    map[string]any
	lastDeleteName string
	err            error
}

func (s *stubCaller) call(method string, payload any) (json.RawMessage, error) {
	s.calls = append(s.calls, method)
	if s.err != nil {
		return nil, s.err
	}
	switch method {
	case hostMethodAuthList:
		raw, _ := json.Marshal(hostAuthListResult{Files: s.listFiles})
		return raw, nil
	case hostMethodAuthGet:
		if m, ok := payload.(map[string]any); ok {
			if v, ok := m["auth_index"].(string); ok {
				s.lastGetAuth = v
			}
		}
		raw, _ := json.Marshal(hostAuthGetResult{JSON: s.getJSON})
		return raw, nil
	case hostMethodAuthSave:
		// Mimic the JSON round-trip performed by the real host bridge so the
		// captured payload reflects concrete JSON types (e.g. []any).
		if roundTripped, err := roundTrip(payload); err != nil {
			return nil, err
		} else if m, ok := roundTripped.(map[string]any); ok {
			s.lastSaveReq = m
		}
		raw, _ := json.Marshal(hostAuthSaveResult{Name: s.saveName, Path: s.savePath})
		return raw, nil
	case hostMethodAuthDelete:
		if m, ok := payload.(map[string]any); ok {
			if v, ok := m["name"].(string); ok {
				s.lastDeleteName = v
			}
		}
		return json.RawMessage(`{"ok":true}`), nil
	}
	return nil, nil
}

func roundTrip(payload any) (any, error) {
	raw, errMarshal := json.Marshal(payload)
	if errMarshal != nil {
		return nil, errMarshal
	}
	var out any
	if errUnmarshal := json.Unmarshal(raw, &out); errUnmarshal != nil {
		return nil, errUnmarshal
	}
	return out, nil
}

func installStub(t *testing.T, s *stubCaller) {
	t.Helper()
	prev := hostCaller
	SetHostCaller(s.call)
	t.Cleanup(func() { SetHostCaller(prev) })
}

func TestVirtualize_ResolvesAuthIndexAndAppliesPrefixAndExclusions(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "acc.json", AuthIndex: "idx-123"}},
		getJSON:   json.RawMessage(`{"type":"antigravity","email":"a@b.c","prefix":"agy","excluded_models":["claude-x","gemini-a"]}`),
		saveName:  "acc.agy_clau.json",
		savePath:  "/auth/acc.agy_clau.json",
	}
	installStub(t, stub)

	got, err := Virtualize(VirtualizeRequest{
		SourceFileName: "acc.json",
		Name:           "acc.agy_clau.json",
		Prefix:         "agy_clau",
		ExcludedModels: []string{"gemini-a"},
	})
	if err != nil {
		t.Fatalf("Virtualize returned error: %v", err)
	}

	if stub.lastGetAuth != "idx-123" {
		t.Errorf("expected host.auth.get with auth_index idx-123, got %q", stub.lastGetAuth)
	}
	if len(stub.calls) != 3 || stub.calls[0] != hostMethodAuthList || stub.calls[1] != hostMethodAuthGet || stub.calls[2] != hostMethodAuthSave {
		t.Errorf("unexpected host call sequence: %v", stub.calls)
	}
	if stub.lastSaveReq == nil {
		t.Fatal("host.auth.save was not called with a payload")
	}
	if stub.lastSaveReq["name"] != "acc.agy_clau.json" {
		t.Errorf("expected save name acc.agy_clau.json, got %v", stub.lastSaveReq["name"])
	}
	meta, ok := stub.lastSaveReq["json"].(map[string]any)
	if !ok {
		t.Fatalf("expected save json object, got %T", stub.lastSaveReq["json"])
	}
	if meta["prefix"] != "agy_clau" {
		t.Errorf("expected prefix agy_clau, got %v", meta["prefix"])
	}
	if meta["email"] != "a@b.c" {
		t.Errorf("expected email preserved, got %v", meta["email"])
	}
	excl, ok := meta["excluded_models"].([]any)
	if !ok || len(excl) != 1 || excl[0] != "gemini-a" {
		t.Errorf("expected excluded_models [gemini-a], got %v", meta["excluded_models"])
	}
	if got.Name != "acc.agy_clau.json" || got.Path != "/auth/acc.agy_clau.json" || got.Prefix != "agy_clau" {
		t.Errorf("unexpected result: %+v", got)
	}
}

func TestVirtualize_PreservesExclusionsWhenNotProvided(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "acc.json", AuthIndex: "idx-1"}},
		getJSON:   json.RawMessage(`{"prefix":"agy","excluded_models":["keep-me"]}`),
		saveName:  "acc.agy_clau.json",
		savePath:  "/auth/acc.agy_clau.json",
	}
	installStub(t, stub)

	if _, err := Virtualize(VirtualizeRequest{
		SourceFileName: "acc.json",
		Prefix:         "agy_clau",
	}); err != nil {
		t.Fatalf("Virtualize returned error: %v", err)
	}
	meta := stub.lastSaveReq["json"].(map[string]any)
	excl, ok := meta["excluded_models"].([]any)
	if !ok || len(excl) != 1 || excl[0] != "keep-me" {
		t.Errorf("expected source exclusions preserved, got %v", meta["excluded_models"])
	}
}

func TestVirtualize_ComputesComplementaryExclusionsPreservingAccountLimits(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "acc.json", AuthIndex: "idx-1"}},
		getJSON:   json.RawMessage(`{"prefix":"agy","excluded_models":["claude-sonnet-4-6","claude-opus-4-6-thinking","gemini-3-flash"]}`),
		saveName:  "acc.agy_clau.json",
		savePath:  "/auth/acc.agy_clau.json",
	}
	installStub(t, stub)

	_, err := Virtualize(VirtualizeRequest{
		SourceFileName: "acc.json",
		Prefix:         "agy_clau",
		TargetModels:   []string{"claude-sonnet-4-6", "claude-opus-4-6-thinking"},
		OppositeModels: []string{"gemini-3-flash", "gemini-3.8-flash-high"},
	})
	if err != nil {
		t.Fatalf("Virtualize returned error: %v", err)
	}

	meta := stub.lastSaveReq["json"].(map[string]any)
	got := meta["excluded_models"].([]any)
	want := []string{"gemini-3-flash", "gemini-3.8-flash-high"}
	if len(got) != len(want) {
		t.Fatalf("expected exclusions %v, got %v", want, got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Fatalf("expected exclusions %v, got %v", want, got)
		}
	}
}

func TestVirtualize_ReleasesTargetFamilyByPatternWhenCatalogMisses(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "acc.json", AuthIndex: "idx-1"}},
		getJSON:   json.RawMessage(`{"prefix":"agy","excluded_models":["claude-sonnet-4-6","gemini-3-flash"]}`),
		saveName:  "acc.agy_clau.json",
		savePath:  "/auth/acc.agy_clau.json",
	}
	installStub(t, stub)

	_, err := Virtualize(VirtualizeRequest{
		SourceFileName: "acc.json",
		Prefix:         "agy_clau",
		TargetPatterns: []string{"claude", "gpt"},
	})
	if err != nil {
		t.Fatalf("Virtualize returned error: %v", err)
	}
	meta := stub.lastSaveReq["json"].(map[string]any)
	got := meta["excluded_models"].([]any)
	if len(got) != 1 || got[0] != "gemini-3-flash" {
		t.Fatalf("expected only gemini-3-flash excluded, got %v", got)
	}
}

func TestVirtualize_AcceptsEmailStyleFileNames(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "antigravity-user@gmail.com.json", AuthIndex: "idx-1"}},
		getJSON:   json.RawMessage(`{"prefix":"agy"}`),
		saveName:  "antigravity-user@gmail.com.agy_clau.json",
		savePath:  "/auth/antigravity-user@gmail.com.agy_clau.json",
	}
	installStub(t, stub)

	got, err := Virtualize(VirtualizeRequest{
		SourceFileName: "antigravity-user@gmail.com.json",
		Prefix:         "agy_clau",
	})
	if err != nil {
		t.Fatalf("Virtualize returned error: %v", err)
	}
	if got.Name != "antigravity-user@gmail.com.agy_clau.json" {
		t.Errorf("unexpected derived name: %q", got.Name)
	}
}

func TestVirtualize_DerivesTargetNameFromSource(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "account-alpha.json", AuthIndex: "idx-9"}},
		getJSON:   json.RawMessage(`{"prefix":"agy"}`),
		saveName:  "account-alpha.agy_clau.json",
		savePath:  "/auth/account-alpha.agy_clau.json",
	}
	installStub(t, stub)

	got, err := Virtualize(VirtualizeRequest{
		SourceFileName: "account-alpha.json",
		Prefix:         "agy_clau",
	})
	if err != nil {
		t.Fatalf("Virtualize returned error: %v", err)
	}
	if stub.lastSaveReq["name"] != "account-alpha.agy_clau.json" {
		t.Errorf("expected derived name account-alpha.agy_clau.json, got %v", stub.lastSaveReq["name"])
	}
	if got.Name != "account-alpha.agy_clau.json" {
		t.Errorf("unexpected result name: %q", got.Name)
	}
}

func TestVirtualize_ValidationErrors(t *testing.T) {
	stub := &stubCaller{listFiles: []hostAuthFileEntry{{Name: "acc.json", AuthIndex: "idx-1"}}}
	installStub(t, stub)

	cases := []struct {
		name string
		req  VirtualizeRequest
	}{
		{"missing source", VirtualizeRequest{Prefix: "agy_clau"}},
		{"missing prefix", VirtualizeRequest{SourceFileName: "acc.json"}},
		{"unsafe name", VirtualizeRequest{SourceFileName: "acc.json", Name: "../evil.json", Prefix: "agy_clau"}},
		{"non-json name", VirtualizeRequest{SourceFileName: "acc.json", Name: "evil.txt", Prefix: "agy_clau"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Virtualize(tc.req); err == nil {
				t.Fatalf("expected validation error for %s", tc.name)
			}
		})
	}
}

func TestVirtualize_UnknownSourceFile(t *testing.T) {
	stub := &stubCaller{listFiles: []hostAuthFileEntry{{Name: "other.json", AuthIndex: "idx-1"}}}
	installStub(t, stub)

	_, err := Virtualize(VirtualizeRequest{SourceFileName: "missing.json", Prefix: "agy_clau"})
	if err == nil || !strings.Contains(err.Error(), "missing.json") {
		t.Fatalf("expected unknown source error mentioning the file, got %v", err)
	}
}

func TestVirtualize_RequiresHostCaller(t *testing.T) {
	prev := hostCaller
	SetHostCaller(nil)
	t.Cleanup(func() { SetHostCaller(prev) })

	_, err := Virtualize(VirtualizeRequest{SourceFileName: "acc.json", Prefix: "agy_clau"})
	if err == nil || !strings.Contains(err.Error(), "host bridge") {
		t.Fatalf("expected host bridge error, got %v", err)
	}
}

func TestHandleManagementHTTP_VirtualizeRoute(t *testing.T) {
	stub := &stubCaller{
		listFiles: []hostAuthFileEntry{{Name: "acc.json", AuthIndex: "idx-1"}},
		getJSON:   json.RawMessage(`{"prefix":"agy"}`),
		saveName:  "acc.agy_clau.json",
		savePath:  "/auth/acc.agy_clau.json",
	}
	installStub(t, stub)

	body, _ := json.Marshal(VirtualizeRequest{
		SourceFileName: "acc.json",
		Name:           "acc.agy_clau.json",
		Prefix:         "agy_clau",
	})
	req, _ := json.Marshal(ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/virtualize",
		Body:   body,
	})

	raw, err := HandleManagementHTTP(req)
	if err != nil {
		t.Fatalf("HandleManagementHTTP returned error: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got %s", string(raw))
	}
	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("failed to decode response payload: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	decoded, err := base64.StdEncoding.DecodeString(resp.Body)
	if err != nil {
		t.Fatalf("response body is not base64: %v", err)
	}
	var result VirtualizeResponse
	if err := json.Unmarshal(decoded, &result); err != nil {
		t.Fatalf("failed to decode result: %v", err)
	}
	if !result.OK || result.Name != "acc.agy_clau.json" || result.Prefix != "agy_clau" {
		t.Errorf("unexpected result: %+v", result)
	}
}

func TestHandleManagementHTTP_VirtualizeReportsPluginError(t *testing.T) {
	stub := &stubCaller{listFiles: []hostAuthFileEntry{{Name: "other.json", AuthIndex: "idx-1"}}}
	installStub(t, stub)

	body, _ := json.Marshal(VirtualizeRequest{SourceFileName: "missing.json", Prefix: "agy_clau"})
	req, _ := json.Marshal(ManagementRequestPayload{
		Method: http.MethodPost,
		Path:   "/v0/management/auto-switcher-pro/virtualize",
		Body:   body,
	})
	raw, err := HandleManagementHTTP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got %s", string(raw))
	}
	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	decoded, _ := base64.StdEncoding.DecodeString(resp.Body)
	var result VirtualizeResponse
	if err := json.Unmarshal(decoded, &result); err != nil {
		t.Fatalf("failed to decode result: %v", err)
	}
	if result.OK || result.Error != "virtualize_failed" || !strings.Contains(result.Message, "missing.json") {
		t.Errorf("expected structured failure, got %+v", result)
	}
}

func TestHandleManagementHTTP_VirtualizeRejectsGET(t *testing.T) {
	stub := &stubCaller{}
	installStub(t, stub)

	req, _ := json.Marshal(ManagementRequestPayload{
		Method: http.MethodGet,
		Path:   "/v0/management/auto-switcher-pro/virtualize",
	})
	raw, err := HandleManagementHTTP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got %s", string(raw))
	}
	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 for GET, got %d", resp.StatusCode)
	}
}

func TestManagementRegister_DeclaresVirtualizeRoute(t *testing.T) {
	raw, err := HandlePluginMethod("management.register", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got %s", string(raw))
	}
	var payload struct {
		Routes []struct {
			Method string `json:"Method"`
			Path   string `json:"Path"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(env.Result, &payload); err != nil {
		t.Fatalf("failed to decode management.register payload: %v", err)
	}
	found := false
	for _, r := range payload.Routes {
		if r.Method == http.MethodPost && r.Path == virtualizeRoutePath {
			found = true
		}
	}
	if !found {
		t.Errorf("expected POST %s in routes, got %+v", virtualizeRoutePath, payload.Routes)
	}
}

func TestDeleteVirtual_DeletesAuthFileViaHost(t *testing.T) {
	stub := &stubCaller{}
	installStub(t, stub)

	err := DeleteVirtual("antigravity-user@gmail.com.agy_son.json")
	if err != nil {
		t.Fatalf("DeleteVirtual failed: %v", err)
	}
	if stub.lastDeleteName != "antigravity-user@gmail.com.agy_son.json" {
		t.Errorf("expected deleted name %q, got %q", "antigravity-user@gmail.com.agy_son.json", stub.lastDeleteName)
	}
}

func TestHandleManagementHTTP_VirtualizeRouteDelete(t *testing.T) {
	stub := &stubCaller{}
	installStub(t, stub)

	req, _ := json.Marshal(ManagementRequestPayload{
		Method: http.MethodDelete,
		Path:   "/v0/management/auto-switcher-pro/virtualize?name=antigravity-user%40gmail.com.agy_son.json",
	})
	raw, err := HandleManagementHTTP(req)
	if err != nil {
		t.Fatalf("HandleManagementHTTP failed: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK {
		t.Fatalf("expected OK envelope, got %s", string(raw))
	}
	var resp ManagementResponsePayload
	if err := json.Unmarshal(env.Result, &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if stub.lastDeleteName != "antigravity-user@gmail.com.agy_son.json" {
		t.Errorf("expected deleted name %q, got %q", "antigravity-user@gmail.com.agy_son.json", stub.lastDeleteName)
	}
}

func TestComputeSpecialistExclusions(t *testing.T) {
	allModels := []string{
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.0-flash",
		"gemini-2.5-pro",
		"  ",
	}
	targetModel := "gemini-2.5-pro"

	result := ComputeSpecialistExclusions(allModels, targetModel)
	expected := []string{"gemini-2.0-flash", "gemini-2.5-flash"}

	if len(result) != len(expected) {
		t.Fatalf("expected %d exclusions, got %d: %+v", len(expected), len(result), result)
	}
	for i, v := range expected {
		if result[i] != v {
			t.Errorf("at index %d: expected %s, got %s", i, v, result[i])
		}
	}
}

func TestComputeSpecialistExclusions_TargetNotInList(t *testing.T) {
	allModels := []string{"claude-3-7-sonnet", "claude-3-5-haiku"}
	result := ComputeSpecialistExclusions(allModels, "other-model")
	expected := []string{"claude-3-5-haiku", "claude-3-7-sonnet"}

	if len(result) != len(expected) {
		t.Fatalf("expected %d, got %d", len(expected), len(result))
	}
	for i, v := range expected {
		if result[i] != v {
			t.Errorf("expected %s, got %s", v, result[i])
		}
	}
}

func TestComputeSpecialistExclusions_Empty(t *testing.T) {
	result := ComputeSpecialistExclusions(nil, "gemini-2.5-pro")
	if len(result) != 0 {
		t.Fatalf("expected empty, got %+v", result)
	}
}

