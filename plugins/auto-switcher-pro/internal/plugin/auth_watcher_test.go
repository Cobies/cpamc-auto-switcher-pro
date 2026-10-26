package plugin

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAuthDirectoryWatcher_DetectsChangesAndEmitsEpoch(t *testing.T) {
	tempAuthDir, err := os.MkdirTemp("", "test_auth_dir_*")
	if err != nil {
		t.Fatalf("failed to create temp auth dir: %v", err)
	}
	defer os.RemoveAll(tempAuthDir)

	tempStateDir, err := os.MkdirTemp("", "test_state_dir_*")
	if err != nil {
		t.Fatalf("failed to create temp state dir: %v", err)
	}
	defer os.RemoveAll(tempStateDir)

	// Crear registry con path en tempStateDir
	stateFile := filepath.Join(tempStateDir, "auto-switcher-pro-state.json")
	reg := NewPoolRegistry(stateFile)
	previous := activeRegistry
	activeRegistry = func() *PoolRegistry { return reg }
	t.Cleanup(func() { activeRegistry = previous })

	watcher := &AuthDirectoryWatcher{
		authDir:  tempAuthDir,
		interval: 50 * time.Millisecond,
	}

	epochPath := filepath.Join(tempStateDir, "auto-switcher-pro.epoch")
	_ = os.Remove(epochPath)

	watcher.Start()
	defer watcher.Stop()

	// 1. Verificar estado baseline
	time.Sleep(100 * time.Millisecond)

	// 2. Crear una nueva cuenta en disco
	authAccount1 := filepath.Join(tempAuthDir, "account1.json")
	if err := os.WriteFile(authAccount1, []byte(`{"email":"user1@google.com"}`), 0644); err != nil {
		t.Fatalf("failed to write auth account: %v", err)
	}

	// 3. Esperar que el watcher detecte y emita epoch
	time.Sleep(200 * time.Millisecond)

	if _, err := os.Stat(epochPath); os.IsNotExist(err) {
		t.Errorf("expected epoch file %s to be created after adding auth account", epochPath)
	}

	// 4. Modificar la cuenta
	epochMod1, _ := os.Stat(epochPath)
	time.Sleep(50 * time.Millisecond)
	if err := os.WriteFile(authAccount1, []byte(`{"email":"user1@google.com","updated":true}`), 0644); err != nil {
		t.Fatalf("failed to update auth account: %v", err)
	}

	time.Sleep(200 * time.Millisecond)
	epochMod2, _ := os.Stat(epochPath)
	if epochMod1 != nil && epochMod2 != nil && epochMod1.ModTime() == epochMod2.ModTime() {
		t.Errorf("expected epoch file to be updated after modifying auth file")
	}
}
