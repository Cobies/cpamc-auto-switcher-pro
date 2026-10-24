package plugin

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"auto-switcher-pro/internal/version"
)

const versionRoutePath = "/auto-switcher-pro/version"

var (
	pluginVersionCacheMu    sync.Mutex
	cachedPluginLatestTag   string
	cachedPluginLatestTime  time.Time
	cachedPluginUpdateAvail bool
)

func isVersionPath(path string) bool {
	norm := strings.TrimSpace(path)
	if idx := strings.IndexAny(norm, "?#"); idx != -1 {
		norm = norm[:idx]
	}
	norm = strings.TrimRight(norm, "/")
	return strings.HasSuffix(norm, versionRoutePath)
}

func handleVersionHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodGet && method != http.MethodHead {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "GET or HEAD method required",
		})
	}

	pluginVersionCacheMu.Lock()
	needFetch := time.Since(cachedPluginLatestTime) > 30*time.Minute || cachedPluginLatestTag == ""
	currentCachedTag := cachedPluginLatestTag
	currentUpdateAvail := cachedPluginUpdateAvail
	pluginVersionCacheMu.Unlock()

	latestTag := currentCachedTag
	updateAvailable := currentUpdateAvail

	if needFetch {
		client := &http.Client{Timeout: 4 * time.Second}
		ghReq, err := http.NewRequest(http.MethodGet, "https://api.github.com/repos/WiloxDev/cpamc-auto-switcher-pro/releases/latest", nil)
		if err == nil {
			ghReq.Header.Set("User-Agent", "Auto-Switcher-Pro/"+version.Version)
			ghReq.Header.Set("Accept", "application/vnd.github.v3+json")
			if res, err := client.Do(ghReq); err == nil && res.StatusCode == http.StatusOK {
				defer res.Body.Close()
				var ghRelease struct {
					TagName string `json:"tag_name"`
				}
				if err := json.NewDecoder(res.Body).Decode(&ghRelease); err == nil && ghRelease.TagName != "" {
					latestTag = ghRelease.TagName
					cleanLatest := strings.TrimPrefix(latestTag, "v")
					cleanCurrent := strings.TrimPrefix(version.Version, "v")
					updateAvailable = (cleanLatest != cleanCurrent && cleanLatest != "")

					pluginVersionCacheMu.Lock()
					cachedPluginLatestTag = latestTag
					cachedPluginLatestTime = time.Now()
					cachedPluginUpdateAvail = updateAvailable
					pluginVersionCacheMu.Unlock()
				}
			}
		}
	}

	if latestTag == "" {
		latestTag = "v" + version.Version
	}

	return jsonManagementResponse(http.StatusOK, map[string]any{
		"ok":               true,
		"current_version":  version.Version,
		"current_tag":      "v" + version.Version,
		"latest_tag":       latestTag,
		"update_available": updateAvailable,
		"github_repo":      "WiloxDev/cpamc-auto-switcher-pro",
		"releases_url":     "https://github.com/WiloxDev/cpamc-auto-switcher-pro/releases",
	})
}
