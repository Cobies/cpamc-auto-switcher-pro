package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// TEST 1: Path traversal protection on AuthUser and Email
func TestSecurity_PathTraversalOnAuthUser(t *testing.T) {
	tempAuthDir, err := os.MkdirTemp("", "argon-sec-test-*")
	if err != nil {
		t.Fatalf("failed to create temp auth dir: %v", err)
	}
	defer os.RemoveAll(tempAuthDir)

	store := GetArgonStore()

	maliciousPayloads := []string{
		"../../evil",
		"../cron.d/pwn",
		"/etc/passwd",
		"0/../../../tmp/hacked",
		"0\\..\\..\\win",
	}

	for _, malAuth := range maliciousPayloads {
		t.Run("traversal_"+malAuth, func(t *testing.T) {
			_, err := store.IngestSession(SyncSessionPayload{
				Cookies:    "__Secure-1PSID=test_token_valid;",
				AuthUser:   malAuth,
				SaveToDisk: true,
			}, tempAuthDir)

			if err == nil {
				// If no error returned, verify it did NOT write outside tempAuthDir
				files, _ := filepath.Glob(filepath.Join(tempAuthDir, "..", "*evil*"))
				if len(files) > 0 {
					t.Fatalf("CRITICAL SECURITY VULNERABILITY: Path traversal succeeded with %q", malAuth)
				}
				// Verify target inside tempAuthDir is cleanly sanitized
				entries, _ := os.ReadDir(tempAuthDir)
				for _, e := range entries {
					if strings.Contains(e.Name(), "..") || strings.Contains(e.Name(), "/") {
						t.Fatalf("Unsafe file created in authDir: %s", e.Name())
					}
				}
			}
		})
	}
}

// TEST 2: Oversized cookie payload protection (DoS guard)
func TestSecurity_OversizedCookiePayload(t *testing.T) {
	store := GetArgonStore()

	// 2 MB cookie string
	hugeCookie := "__Secure-1PSID=" + strings.Repeat("A", 2*1024*1024)

	_, err := store.IngestSession(SyncSessionPayload{
		Cookies:  hugeCookie,
		AuthUser: "0",
	}, "")

	if err == nil {
		t.Errorf("expected rejection of oversized cookie payload (>64KB)")
	}
}

// TEST 3: Parser offset bug when code fence precedes tool_call fence
func TestBug_CodeFencePrecedingToolCall(t *testing.T) {
	// A response containing python code first, then the tool call
	mixedResponse := "Aquí tienes el código previo:\n```python\nprint('hello world')\n```\nY ahora llamamos a la herramienta:\n```tool_call\n{\n  \"name\": \"run_command\",\n  \"arguments\": {\"cmd\": \"ls -la\"}\n}\n```\nFin de la respuesta."

	calls, cleanText, hasTools := ParseSyntheticToolCalls(mixedResponse)
	if !hasTools {
		t.Fatalf("BUG: Tool call missed because preceding python code fence corrupted offset calculation")
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(calls))
	}
	if calls[0].Function.Name != "run_command" {
		t.Errorf("got %q, want run_command", calls[0].Function.Name)
	}
	if strings.Contains(cleanText, "```tool_call") {
		t.Errorf("cleanText still contains tool_call fence: %s", cleanText)
	}
}

// TEST 4: Escaped quotes and braces in JSON tool arguments
func TestBug_EscapedQuotesAndBracesInToolJSON(t *testing.T) {
	sample := "```tool_call\n{\n  \"name\": \"generate_json\",\n  \"arguments\": {\"template\": \"{\\\"nested\\\": true}\", \"raw\": \"a \\\"quote\\\" inside\"}\n}\n```"

	calls, _, hasTools := ParseSyntheticToolCalls(sample)
	if !hasTools {
		t.Fatalf("BUG: Failed to parse tool call with escaped quotes in arguments")
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(calls))
	}
	if calls[0].Function.Name != "generate_json" {
		t.Errorf("got %q, want generate_json", calls[0].Function.Name)
	}
}

// TEST 5: Concurrency stress test under high parallel load (-race)
func TestConcurrency_ArgonStoreRaceConditions(t *testing.T) {
	store := GetArgonStore()

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent Ingest
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			u := fmt.Sprintf("%d", idx%5)
			_, _ = store.IngestSession(SyncSessionPayload{
				Cookies:  fmt.Sprintf("__Secure-1PSID=token_%d;", idx),
				AuthUser: u,
				Email:    fmt.Sprintf("user%d@google.com", idx%5),
			}, "")
		}(i)
	}

	// Concurrent SetCooldown
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			u := fmt.Sprintf("argon_u%d", idx%5)
			store.SetAccountCooldown(u, ArgonErrRateLimit, int64(100+idx), "Rate limit hit")
		}(i)
	}

	// Concurrent ListAccounts
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = store.ListAccounts()
		}()
	}

	// Concurrent Error Classifications
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, _, _ = ClassifyArgonError(fmt.Sprintf("El límite se restablece a las %02d:%02d", idx%24, idx%60))
		}(i)
	}

	wg.Wait()
}

// TEST 6: Complete End-to-End Sequence & Hybrid Failover Flow
func TestSequence_EndToEndHybridFailover(t *testing.T) {
	tempAuthDir, err := os.MkdirTemp("", "argon-seq-test-*")
	if err != nil {
		t.Fatalf("temp dir error: %v", err)
	}
	defer os.RemoveAll(tempAuthDir)

	// Step 1: Ingest 2 accounts via sync session
	store := GetArgonStore()
	acc0, err := store.IngestSession(SyncSessionPayload{
		Cookies:    "__Secure-1PSID=valid_account_0;",
		AuthUser:   "0",
		Email:      "account0@gmail.com",
		SaveToDisk: true,
	}, tempAuthDir)
	if err != nil {
		t.Fatalf("ingest acc0 error: %v", err)
	}

	acc1, err := store.IngestSession(SyncSessionPayload{
		Cookies:    "__Secure-1PSID=valid_account_1;",
		AuthUser:   "1",
		Email:      "account1@gmail.com",
		SaveToDisk: true,
	}, tempAuthDir)
	if err != nil {
		t.Fatalf("ingest acc1 error: %v", err)
	}

	// Verify both accounts are ready
	if acc0.Status != "ready" || acc1.Status != "ready" {
		t.Fatalf("expected both accounts ready initially")
	}

	// Step 2: Simulate account 0 hitting rate limit ("límite se restablece a las 20:00")
	errType0, _, cd0 := ClassifyArgonError("Has alcanzado tu cuota. El límite se restablece a las 20:00.")
	if errType0 != ArgonErrRateLimit {
		t.Errorf("expected RATE_LIMIT, got %s", errType0)
	}
	store.SetAccountCooldown("argon_u0", errType0, cd0, "Límite alcanzado")

	accountsAfter0 := store.ListAccounts()
	var state0, state1 string
	for _, a := range accountsAfter0 {
		if a.AuthUser == "0" {
			state0 = a.Status
		}
		if a.AuthUser == "1" {
			state1 = a.Status
		}
	}
	if state0 != "cooldown" {
		t.Errorf("acc0 should be in cooldown, got %s", state0)
	}
	if state1 != "ready" {
		t.Errorf("acc1 should remain ready, got %s", state1)
	}

	// Step 3: Simulate account 1 also hitting rate limit
	errType1, _, cd1 := ClassifyArgonError("Rate limit exceeded 429")
	store.SetAccountCooldown("argon_u1", errType1, cd1, "Cuota agotada")

	// Step 4: Simulate schedulerPickCascade with both Argon accounts in cooldown
	// Pool definition for Argon
	reg := NewPoolRegistry(t.TempDir() + "/argon-test.json")
	poolArgon := PoolDefinition{
		ID:         "Pool-01-argon",
		Family:     "gemini_argon",
		BasePrefix: "argon",
		Members:    []string{"gemini-argon-u0.json", "gemini-argon-u1.json"},
		Policy: PoolPolicy{
			TargetModels: []string{"web-gemini/gemini-4-argon"},
		},
	}
	_ = reg.SavePool(poolArgon)

	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return reg }
	t.Cleanup(func() { activeRegistry = previous })

	// Available candidates host offers (only Antigravity candidate is healthy; argon accounts are absent/filtered)
	req := schedulerPickRequest{
		Provider: "antigravity",
		Model:    "gemini-4-argon",
		Options: schedulerOptions{
			Metadata: map[string]any{
				"requested_model": "Pool-01-argon",
			},
		},
		Candidates: []schedulerCandidate{
			{ID: "antigravity-backup@gmail.com.json", Provider: "antigravity", Status: "active"},
		},
	}

	pickResp := handleSchedulerPick(req)

	// Step 5: Verify Hybrid Failover took over to Antigravity without dropping
	if !pickResp.Handled {
		t.Fatalf("Hybrid failover should have handled the request when Argon accounts are exhausted")
	}
	if pickResp.AuthID != "antigravity-backup@gmail.com.json" {
		t.Errorf("expected failover to Antigravity candidate, got %s", pickResp.AuthID)
	}
}
