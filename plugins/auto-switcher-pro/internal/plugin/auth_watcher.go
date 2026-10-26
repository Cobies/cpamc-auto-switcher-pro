package plugin

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// EmitGlobalEpoch updates the atomic epoch signal both on disk and in /dev/shm.
// This triggers reactive zero-latency hot-reload in connected Pi agents and web UIs.
func EmitGlobalEpoch() {
	epochData := []byte(fmt.Sprintf("%d", time.Now().UnixNano()))

	// 1. Shared memory (/dev/shm) for <5ms IPC notification
	if fi, err := os.Stat("/dev/shm"); err == nil && fi.IsDir() {
		shmEpoch := "/dev/shm/auto-switcher-pro.epoch"
		tmpShm := fmt.Sprintf("%s.tmp.%d", shmEpoch, time.Now().UnixNano())
		if err := os.WriteFile(tmpShm, epochData, 0644); err == nil {
			_ = os.Rename(tmpShm, shmEpoch)
		}
	}

	// 2. State directory
	reg := activeRegistry()
	if reg != nil && reg.filePath != "" {
		dir := filepath.Dir(reg.filePath)
		if dir != "" && dir != "." {
			epochFile := filepath.Join(dir, "auto-switcher-pro.epoch")
			tmpEpoch := fmt.Sprintf("%s.tmp.%d", epochFile, time.Now().UnixNano())
			if err := os.WriteFile(tmpEpoch, epochData, 0644); err == nil {
				_ = os.Rename(tmpEpoch, epochFile)
			}
		}
	}
}

// AuthDirectoryWatcher scans the CPAMC credentials directory for added, modified,
// or removed auth .json files, emitting an atomic epoch signal on state changes.
type AuthDirectoryWatcher struct {
	mu          sync.Mutex
	authDir     string
	stopCh      chan struct{}
	running     bool
	lastDigest  string
	interval    time.Duration
}

var (
	defaultWatcherInstance *AuthDirectoryWatcher
	defaultWatcherOnce     sync.Once
)

// GetAuthDirectoryWatcher returns the singleton watcher instance.
func GetAuthDirectoryWatcher() *AuthDirectoryWatcher {
	defaultWatcherOnce.Do(func() {
		defaultWatcherInstance = &AuthDirectoryWatcher{
			authDir:  resolveAuthDir(),
			interval: 1 * time.Second,
		}
	})
	return defaultWatcherInstance
}

// Start launches the watcher goroutine.
func (w *AuthDirectoryWatcher) Start() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.running {
		return
	}
	w.stopCh = make(chan struct{})
	w.running = true
	// Initialize baseline digest
	w.lastDigest = w.computeDigest()

	go w.watchLoop()
}

// Stop cleanly halts the watcher goroutine.
func (w *AuthDirectoryWatcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running {
		return
	}
	close(w.stopCh)
	w.running = false
}

func (w *AuthDirectoryWatcher) watchLoop() {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			current := w.computeDigest()
			w.mu.Lock()
			if current != "" && current != w.lastDigest {
				w.lastDigest = current
				w.mu.Unlock()
				// Sincronizar pools podando cuentas obsoletas y emitir epoch
				if reg := activeRegistry(); reg != nil {
					_, _ = reg.PruneStaleAccounts("")
				}
				EmitGlobalEpoch()
			} else {
				w.mu.Unlock()
			}
		case <-w.stopCh:
			return
		}
	}
}

func (w *AuthDirectoryWatcher) computeDigest() string {
	dir := w.authDir
	if dir == "" {
		return ""
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}

	var parts []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s:%d:%d", entry.Name(), info.Size(), info.ModTime().UnixNano()))
	}

	if len(parts) == 0 {
		return "empty"
	}
	sort.Strings(parts)
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{'\n'})
	}
	return hex.EncodeToString(h.Sum(nil))
}
