package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// AutonomousQuotaPoller periodically queries Google Antigravity for quota telemetry
// on all active pool member credentials, feeding PredictiveEngine in RAM without
// depending on active browser sessions or external CLI commands.
type AutonomousQuotaPoller struct {
	mu             sync.Mutex
	interval       time.Duration
	stopCh         chan struct{}
	running        bool
	client         *http.Client
	authDir        string
	antigravityURL string
	userAgent      string
}

var (
	defaultPollerInstance *AutonomousQuotaPoller
	defaultPollerOnce     sync.Once
)

const (
	defaultPollInterval = 5 * time.Minute
	cloudCodeQuotaURL   = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
	antigravityAgent    = "antigravity/hub/2.23.0 darwin/arm64"
)

// GetAutonomousQuotaPoller returns the singleton AutonomousQuotaPoller instance.
func GetAutonomousQuotaPoller() *AutonomousQuotaPoller {
	defaultPollerOnce.Do(func() {
		defaultPollerInstance = &AutonomousQuotaPoller{
			interval:       defaultPollInterval,
			client:         &http.Client{Timeout: 15 * time.Second},
			authDir:        resolveAuthDir(),
			antigravityURL: cloudCodeQuotaURL,
			userAgent:      antigravityAgent,
		}
	})
	return defaultPollerInstance
}

// Start launches the background polling goroutine.
func (p *AutonomousQuotaPoller) Start() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return
	}
	p.stopCh = make(chan struct{})
	p.running = true

	go p.pollLoop()
}

// Stop cleanly terminates the poller goroutine.
func (p *AutonomousQuotaPoller) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return
	}
	close(p.stopCh)
	p.running = false
}

func (p *AutonomousQuotaPoller) pollLoop() {
	// Initial poll on startup with small delay (2 seconds)
	select {
	case <-time.After(2 * time.Second):
		p.PollAllPoolAccounts(context.Background())
	case <-p.stopCh:
		return
	}

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			p.PollAllPoolAccounts(context.Background())
		case <-p.stopCh:
			return
		}
	}
}

// PollAllPoolAccounts inspects all active pool members and queries quota for each account.
func (p *AutonomousQuotaPoller) PollAllPoolAccounts(ctx context.Context) {
	registry := activeRegistry()
	if registry == nil {
		return
	}

	pools := registry.ListPools()
	if len(pools) == 0 {
		return
	}

	predEngine := GetPredictiveEngine()
	seenAccounts := make(map[string]struct{})

	type pollTask struct {
		memberFile string
		pool       PoolDefinition
	}
	var tasks []pollTask

	for _, pool := range pools {
		for _, member := range pool.AllMembers() {
			cleanMember := strings.TrimSpace(member)
			if cleanMember == "" {
				continue
			}
			if _, exists := seenAccounts[cleanMember]; exists {
				continue
			}
			seenAccounts[cleanMember] = struct{}{}
			tasks = append(tasks, pollTask{memberFile: cleanMember, pool: pool})
		}
	}

	if len(tasks) == 0 {
		return
	}

	// Concurrency Semaphore: max 3 concurrent outbound quota calls to prevent IP throttling
	sem := make(chan struct{}, 3)
	for _, task := range tasks {
		go func(t pollTask) {
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
				p.pollSingleAccount(ctx, t.memberFile, t.pool, predEngine)
			case <-ctx.Done():
				return
			}
		}(task)
	}
}

func (p *AutonomousQuotaPoller) pollSingleAccount(ctx context.Context, memberFile string, pool PoolDefinition, predEngine *PredictiveEngine) {
	authPath := filepath.Join(p.authDir, memberFile)
	data, err := os.ReadFile(authPath)
	if err != nil {
		return
	}

	var cred struct {
		Type        string `json:"type"`
		Provider    string `json:"provider"`
		AccessToken string `json:"access_token"`
		Token       string `json:"token"`
		ProjectID   string `json:"project_id"`
		Email       string `json:"email"`
	}
	if err := json.Unmarshal(data, &cred); err != nil {
		return
	}

	// Only antigravity / google-cloud-code accounts support retrieveUserQuotaSummary
	prov := strings.ToLower(strings.TrimSpace(cred.Provider))
	typ := strings.ToLower(strings.TrimSpace(cred.Type))
	if prov != "" && prov != "antigravity" && prov != "google" {
		return
	}
	if typ != "" && typ != "antigravity" && typ != "google" && !strings.Contains(typ, "code") {
		return
	}

	token := cred.AccessToken
	if token == "" {
		token = cred.Token
	}
	if token == "" {
		return
	}

	bodyJSON := "{}"
	if cred.ProjectID != "" {
		bodyJSON = fmt.Sprintf(`{"project":%q}`, cred.ProjectID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.antigravityURL, strings.NewReader(bodyJSON))
	if err != nil {
		return
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", p.userAgent)

	resp, err := p.client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// If 429 or exhausted, register reactive cooldown immediately
		if resp.StatusCode == http.StatusTooManyRequests {
			accountEmail := cred.Email
			if accountEmail == "" {
				accountEmail = strings.TrimSuffix(strings.TrimPrefix(memberFile, "antigravity-"), ".json")
			}
			predEngine.SetCooldown(accountEmail, 15*time.Minute)
		}
		return
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}

	// Parse Google quota payload with model family isolation
	p.ingestQuotaPayload(respBody, memberFile, cred.Email, pool, predEngine)
}

func (p *AutonomousQuotaPoller) ingestQuotaPayload(payload []byte, memberFile, email string, pool PoolDefinition, predEngine *PredictiveEngine) {
	var parsed struct {
		Groups []struct {
			DisplayName string `json:"displayName"`
			Name        string `json:"name"`
			Buckets     []struct {
				DisplayName       string   `json:"displayName"`
				Label             string   `json:"label"`
				Window            string   `json:"window"`
				RemainingFraction *float64 `json:"remainingFraction"`
			} `json:"buckets"`
		} `json:"groups"`
	}

	if err := json.Unmarshal(payload, &parsed); err != nil {
		return
	}

	fam := strings.ToLower(familyCanonicalShortName(pool.Family, pool.BasePrefix))
	isClaude := fam == "claude"
	isGemini := fam == "gemini"

	var worst5h *float64
	var worstWeekly *float64

	for _, g := range parsed.Groups {
		grpName := strings.ToLower(g.DisplayName)
		if grpName == "" {
			grpName = strings.ToLower(g.Name)
		}

		if isGemini && !strings.Contains(grpName, "gemini") {
			continue
		}
		if isClaude && !strings.Contains(grpName, "claude") && !strings.Contains(grpName, "gpt") {
			continue
		}

		for _, b := range g.Buckets {
			if b.RemainingFraction == nil {
				continue
			}
			remPct := *b.RemainingFraction * 100.0
			bName := strings.ToLower(b.DisplayName + " " + b.Label + " " + b.Window)

			if strings.Contains(bName, "5") || strings.Contains(bName, "five") {
				if worst5h == nil || remPct < *worst5h {
					worst5h = &remPct
				}
			} else if strings.Contains(bName, "week") {
				if worstWeekly == nil || remPct < *worstWeekly {
					worstWeekly = &remPct
				}
			}
		}
	}

	if worst5h != nil || worstWeekly != nil {
		w5h := 100.0
		if worst5h != nil {
			w5h = *worst5h
		}
		weekly := 100.0
		if worstWeekly != nil {
			weekly = *worstWeekly
		}

		accountKey := email
		if accountKey == "" {
			accountKey = strings.TrimSuffix(strings.TrimPrefix(memberFile, "antigravity-"), ".json")
		}

		predEngine.RecordLiveQuota(AccountQuotaTelemetry{
			AccountKey:  accountKey,
			Window5hPct: w5h,
			WeeklyPct:   weekly,
			UpdatedAt:   time.Now(),
		})
	}
}
