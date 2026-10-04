package plugin

import "encoding/json"

// HostCaller invokes a CLIProxyAPI host callback by method name and returns the
// unwrapped result payload. The cgo entry point installs the real implementation;
// tests substitute in-memory stubs.
type HostCaller func(method string, payload any) (json.RawMessage, error)

var hostCaller HostCaller

// SetHostCaller installs the host bridge. A nil value disables host callbacks.
func SetHostCaller(c HostCaller) {
	hostCaller = c
}
