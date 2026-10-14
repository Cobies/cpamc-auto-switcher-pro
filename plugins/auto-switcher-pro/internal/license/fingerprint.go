package license

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strings"
)

// GetMachineID computes a deterministic hardware identifier for Linux/WSL/Docker.
func GetMachineID() string {
	// 0. Si ya existe un MachineID persistido en el archivo de licencia del disco, usarlo siempre (Invariable en Docker)
	path := getLicenseStoragePath()
	if data, err := os.ReadFile(path); err == nil {
		var lf struct {
			MachineID string `json:"machine_id"`
		}
		if err := json.Unmarshal(data, &lf); err == nil && len(strings.TrimSpace(lf.MachineID)) > 0 {
			return strings.TrimSpace(lf.MachineID)
		}
	}

	var parts []string

	// 1. /etc/machine-id or /var/lib/dbus/machine-id
	for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		if data, err := os.ReadFile(p); err == nil {
			trimmed := strings.TrimSpace(string(data))
			if len(trimmed) > 0 {
				parts = append(parts, trimmed)
				break
			}
		}
	}

	// 2. Hardware MAC addresses
	if ifaces, err := net.Interfaces(); err == nil {
		for _, ifa := range ifaces {
			if len(ifa.HardwareAddr) > 0 && (ifa.Flags&net.FlagLoopback == 0) {
				parts = append(parts, ifa.HardwareAddr.String())
				break
			}
		}
	}

	// 3. Fallback to Hostname if machine-id is not readable
	if len(parts) == 0 {
		if h, err := os.Hostname(); err == nil && len(h) > 0 {
			parts = append(parts, h)
		} else {
			parts = append(parts, "default-cpamc-host")
		}
	}

	raw := strings.Join(parts, "|")
	hash := sha256.Sum256([]byte(raw))
	hexStr := strings.ToUpper(hex.EncodeToString(hash[:]))

	// Format: CPA-XXXX-XXXX-XXXX
	return fmt.Sprintf("CPA-%s-%s-%s", hexStr[0:4], hexStr[4:8], hexStr[8:12])
}

// GetSystemIdentity returns "username@hostname" (e.g. wilox@soytec or Wilson@MacBook-Pro).
func GetSystemIdentity() string {
	username := strings.TrimSpace(os.Getenv("USER"))
	if username == "" {
		username = strings.TrimSpace(os.Getenv("USERNAME"))
	}
	if username == "" {
		username = "user"
	}

	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "pc"
	}

	return fmt.Sprintf("%s@%s", username, strings.TrimSpace(hostname))
}
