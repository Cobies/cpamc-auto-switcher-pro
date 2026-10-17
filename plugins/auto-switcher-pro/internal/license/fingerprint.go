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

	// 1. Hardware MAC addresses (filtrando interfaces virtuales como veth, docker, br-, dummy)
	mac := GetMACAddress()
	if mac != "" {
		parts = append(parts, "mac:"+mac)
	}

	// 2. /etc/machine-id or /var/lib/dbus/machine-id (identificador único de instalación de OS)
	for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		if data, err := os.ReadFile(p); err == nil {
			trimmed := strings.TrimSpace(string(data))
			if len(trimmed) > 0 {
				parts = append(parts, "os:"+trimmed)
				break
			}
		}
	}

	// 3. Fallback to Hostname if machine-id and mac are not available
	if len(parts) == 0 {
		if h, err := os.Hostname(); err == nil && len(h) > 0 {
			parts = append(parts, "host:"+h)
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

// GetMACAddress returns the physical hardware MAC address.
// If already saved in the persistent license file on disk, it returns the stable saved MAC.
func GetMACAddress() string {
	// 0. Revisar si ya existe en el archivo de licencia persistente
	path := getLicenseStoragePath()
	if data, err := os.ReadFile(path); err == nil {
		var lf struct {
			MACAddress string `json:"mac_address"`
		}
		if err := json.Unmarshal(data, &lf); err == nil && len(strings.TrimSpace(lf.MACAddress)) > 0 {
			return strings.TrimSpace(lf.MACAddress)
		}
	}

	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	var fallbackMAC string
	for _, ifa := range ifaces {
		mac := strings.ToLower(strings.TrimSpace(ifa.HardwareAddr.String()))
		if len(mac) == 0 || (ifa.Flags&net.FlagLoopback != 0) {
			continue
		}
		name := strings.ToLower(ifa.Name)
		// Omitir puentes y adaptadores virtuales de Docker / Podman / VMs
		if strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "br-") ||
			strings.HasPrefix(name, "docker") ||
			strings.HasPrefix(name, "flannel") ||
			strings.HasPrefix(name, "cni") ||
			strings.HasPrefix(name, "dummy") {
			continue
		}
		if fallbackMAC == "" {
			fallbackMAC = mac
		}
		// Priorizar interfaces físicas ethernet o wifi estándar
		if strings.HasPrefix(name, "en") || strings.HasPrefix(name, "wl") || strings.HasPrefix(name, "et") {
			return mac
		}
	}

	return fallbackMAC
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
