package analytics

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	dbInstance *sql.DB
	dbOnce     sync.Once
	dbPath     string
	dbMu       sync.RWMutex
)

// resolveDBPath locates the writable storage directory for rotations.db.
func resolveDBPath() string {
	candidates := []string{
		"/CLIProxyAPI/plugins/rotations.db",
		filepath.Join(os.Getenv("HOME"), "services/cliproxy/plugins/rotations.db"),
		filepath.Join(os.Getenv("HOME"), ".local/share/auto-switcher-pro/rotations.db"),
		"./rotations.db",
	}
	for _, p := range candidates {
		dir := filepath.Dir(p)
		if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
			return p
		}
	}
	return "./rotations.db"
}

// InitDB initializes SQLite in WAL mode and sets up the pool_rotations table.
func InitDB() (*sql.DB, error) {
	var initErr error
	dbOnce.Do(func() {
		if dbPath == "" {
			dbPath = resolveDBPath()
		}
		_ = os.MkdirAll(filepath.Dir(dbPath), 0755)

		dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)", dbPath)
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			initErr = err
			return
		}

		db.SetMaxOpenConns(5)
		db.SetMaxIdleConns(2)
		db.SetConnMaxLifetime(time.Hour)

		schema := `
		CREATE TABLE IF NOT EXISTS pool_rotations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp INTEGER NOT NULL,
			pool_id TEXT DEFAULT '',
			pool_prefix TEXT NOT NULL,
			selected_account TEXT NOT NULL,
			account_email TEXT NOT NULL,
			is_failover INTEGER NOT NULL,
			cascade_index INTEGER NOT NULL,
			target_model TEXT NOT NULL,
			status_code INTEGER DEFAULT 200
		);
		CREATE INDEX IF NOT EXISTS idx_rotations_ts ON pool_rotations(timestamp);
		CREATE INDEX IF NOT EXISTS idx_rotations_pool ON pool_rotations(pool_prefix);
		CREATE INDEX IF NOT EXISTS idx_rotations_account ON pool_rotations(account_email);
		`
		if _, err := db.Exec(schema); err != nil {
			initErr = fmt.Errorf("failed to init schema: %w", err)
			return
		}
		// Idempotent backward-compatible migration for existing databases
		_, _ = db.Exec(`ALTER TABLE pool_rotations ADD COLUMN pool_id TEXT DEFAULT '';`)
		_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_rotations_pool_id ON pool_rotations(pool_id);`)

		dbInstance = db
	})

	if initErr != nil {
		return nil, initErr
	}
	return dbInstance, nil
}

// RotationEvent represents a single routed request event.
type RotationEvent struct {
	Timestamp       int64  // Unix epoch in milliseconds
	PoolID          string // Sovereign Pool Identifier (e.g. "pool_agy_01")
	PoolPrefix      string
	SelectedAccount string
	AccountEmail    string
	IsFailover      bool
	CascadeIndex    int
	TargetModel     string
	StatusCode      int
}

// RecordEvent asynchronously records a rotation event into SQLite without blocking request dispatch.
func RecordEvent(evt RotationEvent) {
	db, err := InitDB()
	if err != nil || db == nil {
		return
	}

	if evt.Timestamp == 0 {
		evt.Timestamp = time.Now().UnixMilli()
	}
	if evt.StatusCode == 0 {
		evt.StatusCode = 200
	}

	isFailoverInt := 0
	if evt.IsFailover {
		isFailoverInt = 1
	}

	go func() {
		stmt := `INSERT INTO pool_rotations (
			timestamp, pool_id, pool_prefix, selected_account, account_email, is_failover, cascade_index, target_model, status_code
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		_, _ = db.Exec(stmt,
			evt.Timestamp,
			evt.PoolID,
			evt.PoolPrefix,
			evt.SelectedAccount,
			evt.AccountEmail,
			isFailoverInt,
			evt.CascadeIndex,
			evt.TargetModel,
			evt.StatusCode,
		)
	}()
}
