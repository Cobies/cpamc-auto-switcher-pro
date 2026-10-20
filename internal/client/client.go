package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const AntigravityUserAgent = "antigravity/hub/2.23.0 darwin/arm64"

// Antigravity quota endpoints in fallback priority order
var AntigravityQuotaEndpoints = []string{
	"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
	"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
	"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
}

const CodexQuotaEndpoint = "https://chatgpt.com/backend-api/wham/usage"

var CodexHeaders = map[string]string{
	"Authorization": "Bearer $TOKEN$",
	"Content-Type":  "application/json",
	"Accept":        "application/json",
	"OpenAI-Beta":   "codex-1",
	"Originator":    "Codex Desktop",
	"User-Agent":    "codex-tui/0.154.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.154.0)",
}

// Client interacts with the CLIProxyAPI Management API.
type Client struct {
	baseURL        string
	mgmtKey        string
	httpClient     *http.Client
	projectIDCache sync.Map
}

// New creates a new Management API client.
func New(endpoint, mgmtKey string) (*Client, error) {
	clean := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if clean == "" {
		return nil, fmt.Errorf("empty endpoint")
	}
	u, err := url.Parse(clean)
	if err != nil {
		return nil, fmt.Errorf("invalid endpoint URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("endpoint must use http or https scheme: %s", clean)
	}

	return &Client{
		baseURL: clean,
		mgmtKey: strings.TrimSpace(mgmtKey),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// AuthFileEntry represents an entry returned by GET /v0/management/auth-files.
type AuthFileEntry struct {
	ID        string `json:"id"`
	AuthIndex string `json:"auth_index"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Provider  string `json:"provider"`
	Status    string `json:"status"`
	Disabled  bool   `json:"disabled"`
	Email     string `json:"email"`
	ProjectID string `json:"project_id"`
}

type listAuthFilesResponse struct {
	Files []AuthFileEntry `json:"files"`
}

// ListAuthFiles retrieves all configured auth files.
func (c *Client) ListAuthFiles(ctx context.Context) ([]AuthFileEntry, error) {
	reqURL := fmt.Sprintf("%s/v0/management/auth-files", c.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list auth files failed (%d): %s", resp.StatusCode, string(body))
	}

	var res listAuthFilesResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("decode auth files response: %w", err)
	}

	return res.Files, nil
}

// AuthFileMetadata holds attributes extracted from the downloaded auth file.
type AuthFileMetadata struct {
	Prefix           string
	ChatGPTAccountID string
	ProjectID        string
}

// GetAuthFileDetails downloads the raw credential JSON and extracts prefix and optional chatgpt_account_id.
// Secrets are discarded immediately from memory and never logged or persisted.
func (c *Client) GetAuthFileDetails(ctx context.Context, name string) (AuthFileMetadata, error) {
	var meta AuthFileMetadata
	reqURL := fmt.Sprintf("%s/v0/management/auth-files/download?name=%s", c.baseURL, url.QueryEscape(name))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return meta, fmt.Errorf("create download request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return meta, fmt.Errorf("execute download request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return meta, fmt.Errorf("download auth file failed (%d): %s", resp.StatusCode, string(body))
	}

	var rawMap map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rawMap); err != nil {
		return meta, fmt.Errorf("decode auth file JSON: %w", err)
	}

	// Extract prefix if present
	if prefixVal, ok := rawMap["prefix"]; ok && prefixVal != nil {
		if prefixStr, isStr := prefixVal.(string); isStr {
			meta.Prefix = strings.TrimSpace(prefixStr)
		}
	}

	// Extract project_id if present (direct, quota_project_id, or nested in installed / web)
	for _, key := range []string{"project_id", "projectId", "quota_project_id"} {
		if val, ok := rawMap[key]; ok && val != nil {
			if strVal, isStr := val.(string); isStr && strings.TrimSpace(strVal) != "" {
				meta.ProjectID = strings.TrimSpace(strVal)
				break
			}
		}
	}
	if meta.ProjectID == "" {
		for _, parentKey := range []string{"installed", "web"} {
			if nested, ok := rawMap[parentKey].(map[string]any); ok && nested != nil {
				for _, key := range []string{"project_id", "projectId", "quota_project_id"} {
					if val, ok := nested[key]; ok && val != nil {
						if strVal, isStr := val.(string); isStr && strings.TrimSpace(strVal) != "" {
							meta.ProjectID = strings.TrimSpace(strVal)
							break
						}
					}
				}
				if meta.ProjectID != "" {
					break
				}
			}
		}
	}
	if meta.ProjectID != "" {
		c.projectIDCache.Store(name, meta.ProjectID)
	}

	// Extract ChatGPT account ID if present
	for _, key := range []string{"chatgpt_account_id", "chatgptAccountId", "account_id", "accountId"} {
		if val, ok := rawMap[key]; ok && val != nil {
			if strVal, isStr := val.(string); isStr && strings.TrimSpace(strVal) != "" {
				meta.ChatGPTAccountID = strings.TrimSpace(strVal)
				break
			}
		}
	}

	return meta, nil
}

// GetAuthFilePrefix downloads the raw credential JSON and extracts only the "prefix" field.
// Secrets are discarded immediately from memory and never logged or persisted.
func (c *Client) GetAuthFilePrefix(ctx context.Context, name string) (string, error) {
	meta, err := c.GetAuthFileDetails(ctx, name)
	if err != nil {
		return "", err
	}
	return meta.Prefix, nil
}

// APICallRequest mirrors the body expected by POST /v0/management/api-call.
type APICallRequest struct {
	AuthIndex string            `json:"authIndex"`
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Header    map[string]string `json:"header,omitempty"`
	Data      string            `json:"data,omitempty"`
}

// APICallResponse envelopes the payload returned by /v0/management/api-call.
type APICallResponse struct {
	StatusCode int                 `json:"status_code"`
	Header     map[string][]string `json:"header"`
	Body       any                 `json:"body"`
}

// doAPICall sends a request through the management api-call proxy and unwraps the response envelope.
func (c *Client) doAPICall(ctx context.Context, apiReq APICallRequest) ([]byte, error) {
	bodyBytes, err := json.Marshal(apiReq)
	if err != nil {
		return nil, fmt.Errorf("marshal api-call request: %w", err)
	}

	reqURL := fmt.Sprintf("%s/v0/management/api-call", c.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create api-call request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute api-call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, fmt.Errorf("read response body: %w", readErr)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("management api-call returned %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse the management proxy response envelope
	var apiCallResp APICallResponse
	if err := json.Unmarshal(respBody, &apiCallResp); err != nil {
		// If not an envelope, use raw bytes directly
		return respBody, nil
	}

	// Check upstream status code inside the envelope
	if apiCallResp.StatusCode > 0 && (apiCallResp.StatusCode < 200 || apiCallResp.StatusCode >= 300) {
		return nil, fmt.Errorf("upstream returned %d: %v", apiCallResp.StatusCode, apiCallResp.Body)
	}

	// Extract the actual upstream body
	switch b := apiCallResp.Body.(type) {
	case string:
		return []byte(b), nil
	case nil:
		return respBody, nil
	default:
		marshaled, errMarshal := json.Marshal(b)
		if errMarshal != nil {
			return nil, fmt.Errorf("marshal unwrapped body: %w", errMarshal)
		}
		return marshaled, nil
	}
}

// DiscoverAntigravityProjectID discovers project_id dynamically via loadCodeAssist if not present in credentials.
func (c *Client) DiscoverAntigravityProjectID(ctx context.Context, authIndex string) (string, error) {
	if cached, ok := c.projectIDCache.Load(authIndex); ok {
		if str, isStr := cached.(string); isStr && str != "" {
			return str, nil
		}
	}

	apiReq := APICallRequest{
		AuthIndex: authIndex,
		Method:    http.MethodPost,
		URL:       "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
		Header: map[string]string{
			"Authorization": "Bearer $TOKEN$",
			"Content-Type":  "application/json",
			"User-Agent":    AntigravityUserAgent,
		},
		Data: `{"metadata":{"ideType":"ANTIGRAVITY"}}`,
	}

	respBytes, err := c.doAPICall(ctx, apiReq)
	if err != nil {
		return "", err
	}

	var res struct {
		CloudaicompanionProject string `json:"cloudaicompanionProject"`
		Project                 string `json:"project"`
	}
	if err := json.Unmarshal(respBytes, &res); err == nil {
		pID := strings.TrimSpace(res.CloudaicompanionProject)
		if pID == "" {
			pID = strings.TrimSpace(res.Project)
		}
		if pID != "" {
			c.projectIDCache.Store(authIndex, pID)
			return pID, nil
		}
	}

	return "", fmt.Errorf("project_id not found in loadCodeAssist response")
}

// PushLiveQuotaTelemetry sends evaluated live quota from headless / CLI directly to the Auto Switcher Pro predictive engine.
func (c *Client) PushLiveQuotaTelemetry(ctx context.Context, accountKey string, win5hPct, weeklyPct float64, win5hResetIn, weeklyResetIn int64) error {
	payload := map[string]any{
		"account_key":        accountKey,
		"window_5h_pct":      win5hPct,
		"weekly_pct":         weeklyPct,
		"window_5h_reset_in": win5hResetIn,
		"weekly_reset_in":    weeklyResetIn,
		"source":             "headless_cli",
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	reqURL := fmt.Sprintf("%s/v0/management/auto-switcher-pro/predictive/telemetry", c.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setHeaders(req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// GetQuotaSummary calls Antigravity's retrieveUserQuotaSummary via the management api-call proxy.
func (c *Client) GetQuotaSummary(ctx context.Context, authIndex, projectID string) ([]byte, error) {
	cleanPID := strings.TrimSpace(projectID)
	if cleanPID == "" {
		if cachedPID, ok := c.projectIDCache.Load(authIndex); ok {
			cleanPID = cachedPID.(string)
		} else {
			if discPID, err := c.DiscoverAntigravityProjectID(ctx, authIndex); err == nil && discPID != "" {
				cleanPID = discPID
			}
		}
	}

	var lastErr error

	for _, endpoint := range AntigravityQuotaEndpoints {
		payloadData := "{}"
		if cleanPID != "" {
			payloadData = fmt.Sprintf(`{"project":%q}`, cleanPID)
		}

		apiReq := APICallRequest{
			AuthIndex: authIndex,
			Method:    http.MethodPost,
			URL:       endpoint,
			Header: map[string]string{
				"Authorization": "Bearer $TOKEN$",
				"Content-Type":  "application/json",
				"User-Agent":    AntigravityUserAgent,
			},
			Data: payloadData,
		}

		bytes, err := c.doAPICall(ctx, apiReq)
		if err == nil {
			return bytes, nil
		}
		lastErr = err
	}

	return nil, fmt.Errorf("all antigravity quota endpoints failed: %w", lastErr)
}

// GetCodexQuotaSummary calls ChatGPT Codex usage endpoint via the management api-call proxy.
func (c *Client) GetCodexQuotaSummary(ctx context.Context, authIndex, chatgptAccountID string) ([]byte, error) {
	headers := make(map[string]string, len(CodexHeaders)+1)
	for k, v := range CodexHeaders {
		headers[k] = v
	}
	if strings.TrimSpace(chatgptAccountID) != "" {
		headers["Chatgpt-Account-Id"] = strings.TrimSpace(chatgptAccountID)
	}

	apiReq := APICallRequest{
		AuthIndex: authIndex,
		Method:    http.MethodGet,
		URL:       CodexQuotaEndpoint,
		Header:    headers,
	}

	bytes, err := c.doAPICall(ctx, apiReq)
	if err != nil {
		return nil, fmt.Errorf("codex quota request failed: %w", err)
	}
	return bytes, nil
}

// GetQuotaSummaryForProvider routes quota retrieval to the appropriate provider ("antigravity" or "codex").
func (c *Client) GetQuotaSummaryForProvider(ctx context.Context, provider, authIndex, projectOrAccountID string) ([]byte, error) {
	if strings.EqualFold(strings.TrimSpace(provider), "codex") {
		return c.GetCodexQuotaSummary(ctx, authIndex, projectOrAccountID)
	}
	return c.GetQuotaSummary(ctx, authIndex, projectOrAccountID)
}

// PatchAuthPrefix updates the prefix attribute of an auth record using PATCH /v0/management/auth-files/fields.
func (c *Client) PatchAuthPrefix(ctx context.Context, nameOrID, newPrefix string) error {
	payload := map[string]string{
		"name":   strings.TrimSpace(nameOrID),
		"prefix": strings.TrimSpace(newPrefix),
		"note":   strings.TrimSpace(newPrefix),
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal patch payload: %w", err)
	}

	reqURL := fmt.Sprintf("%s/v0/management/auth-files/fields", c.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, reqURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("create patch request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute patch request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("patch auth prefix failed (%d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func (c *Client) setHeaders(req *http.Request) {
	if c.mgmtKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.mgmtKey)
		req.Header.Set("X-Management-Key", c.mgmtKey)
	}
}
