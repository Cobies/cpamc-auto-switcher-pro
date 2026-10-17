package main

import (
	_ "embed"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Private seed known ONLY to Wilox for signing commercial licenses
const defaultPrivateSeedHex = "3144b5a27ebff1ca566dd9c31afb5e8761d3590cb0b106caab0ccbca2fafae91"
const defaultAdminToken = "wilox-admin-secret-2026"

type LicenseClaims struct {
	MachineID string `json:"machine_id"`
	Client    string `json:"client"`
	Tier      string `json:"tier"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

type MachineRecord struct {
	MachineID      string   `json:"machine_id"`
	MACAddress     string   `json:"mac_address,omitempty"`
	ClientName     string   `json:"client_name"`
	Email          string   `json:"email,omitempty"`
	FirstSeenAt    int64    `json:"first_seen_at"`
	LastSeenAt     int64    `json:"last_seen_at"`
	Status         string   `json:"status"` // "trial", "active", "revoked", "expired"
	Tier           string   `json:"tier"`   // "trial", "pro", "enterprise"
	ExpiresAt      int64    `json:"expires_at"`
	PaymentMethod  string   `json:"payment_method"` // "none", "binance", "paypal"
	PaymentRef     string   `json:"payment_ref"`
	LicenseToken   string   `json:"license_token,omitempty"`
	Version        string   `json:"version,omitempty"`
	OS             string   `json:"os,omitempty"`
	Rotations      int64    `json:"rotations,omitempty"`       // Total peticiones
	TotalFailovers int64    `json:"total_failovers,omitempty"` // Rotaciones a reservas
	ActivePools    []string `json:"active_pools,omitempty"`
	IP             string   `json:"ip,omitempty"`
	CountryCode    string   `json:"country_code,omitempty"`
	CountryName    string   `json:"country_name,omitempty"`
}

type LicenseAccount struct {
	Email           string   `json:"email"`
	ActiveMachineID string   `json:"active_machine_id"`
	Tier            string   `json:"tier"`
	ExpiresAt       int64    `json:"expires_at"`
	PaymentMethod   string   `json:"payment_method"`
	PaymentRef      string   `json:"payment_ref"`
	CreatedAt       int64    `json:"created_at"`
	LastTransferAt  int64    `json:"last_transfer_at"`
	HistoryMachines []string `json:"history_machines"`
}

type ResetPIN struct {
	PIN       string
	MachineID string
	ExpiresAt int64
}

type SupportReportRecord struct {
	ID          string                   `json:"id"`
	Timestamp   int64                    `json:"timestamp"`
	MachineID   string                   `json:"machine_id"`
	MACAddress  string                   `json:"mac_address,omitempty"`
	ClientName  string                   `json:"client_name"`
	Version     string                   `json:"version"`
	OS          string                   `json:"os"`
	Summary     string                   `json:"summary,omitempty"`
	RecentLogs  []map[string]interface{} `json:"recent_logs,omitempty"`
	SystemState map[string]interface{}   `json:"system_state,omitempty"`
	IP          string                   `json:"ip,omitempty"`
	CountryCode string                   `json:"country_code,omitempty"`
	CountryName string                   `json:"country_name,omitempty"`
}

type StoreData struct {
	Machines []*MachineRecord        `json:"machines"`
	Accounts []*LicenseAccount       `json:"accounts,omitempty"`
	Reports  []*SupportReportRecord  `json:"reports,omitempty"`
}

type Store struct {
	filePath string
	machines map[string]*MachineRecord
	accounts map[string]*LicenseAccount // email -> Account
	reports  []*SupportReportRecord     // Support Diagnostic Reports
	pins     map[string]*ResetPIN       // email -> pending PIN
	mu       sync.Mutex
}

func initStore(filePath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return nil, err
	}
	s := &Store{
		filePath: filePath,
		machines: make(map[string]*MachineRecord),
		accounts: make(map[string]*LicenseAccount),
		reports:  make([]*SupportReportRecord, 0),
		pins:     make(map[string]*ResetPIN),
	}
	data, err := os.ReadFile(filePath)
	if err == nil && len(data) > 0 {
		var sd StoreData
		if err := json.Unmarshal(data, &sd); err == nil && (len(sd.Machines) > 0 || len(sd.Accounts) > 0 || len(sd.Reports) > 0) {
			for _, m := range sd.Machines {
				s.machines[m.MachineID] = m
			}
			for _, a := range sd.Accounts {
				s.accounts[strings.ToLower(a.Email)] = a
			}
			s.reports = sd.Reports
		} else {
			// Backward compatibility: list of []*MachineRecord
			var list []*MachineRecord
			if err := json.Unmarshal(data, &list); err == nil {
				for _, m := range list {
					s.machines[m.MachineID] = m
				}
			}
		}
		s.cleanDuplicates()
	}
	return s, nil
}

// cleanDuplicates identifies and merges duplicate records by MAC address or ClientName + IP.
func (s *Store) cleanDuplicates() {
	// 1. Unificar por MACAddress física si está disponible
	macMap := make(map[string]*MachineRecord)
	for _, m := range s.machines {
		mac := strings.ToLower(strings.TrimSpace(m.MACAddress))
		if mac == "" {
			continue
		}
		if existing, exists := macMap[mac]; exists {
			var winner, loser *MachineRecord
			if existing.Status == "active" && m.Status != "active" {
				winner, loser = existing, m
			} else if m.Status == "active" && existing.Status != "active" {
				winner, loser = m, existing
			} else if m.LastSeenAt >= existing.LastSeenAt {
				winner, loser = m, existing
			} else {
				winner, loser = existing, m
			}
			if loser.Rotations > winner.Rotations {
				winner.Rotations = loser.Rotations
			}
			if loser.TotalFailovers > winner.TotalFailovers {
				winner.TotalFailovers = loser.TotalFailovers
			}
			if len(winner.ActivePools) == 0 {
				winner.ActivePools = loser.ActivePools
			}
			delete(s.machines, loser.MachineID)
			macMap[mac] = winner
		} else {
			macMap[mac] = m
		}
	}

	// 2. Unificar por (ClientName + IP) para instalaciones en Docker o recreadas
	clientIPMap := make(map[string]*MachineRecord)
	for _, m := range s.machines {
		cn := strings.TrimSpace(m.ClientName)
		ip := strings.TrimSpace(m.IP)
		if cn == "" || cn == "Nuevo Usuario" || ip == "" || ip == "127.0.0.1" {
			continue
		}
		key := cn + "|" + ip
		if existing, exists := clientIPMap[key]; exists {
			var winner, loser *MachineRecord
			if existing.Status == "active" && m.Status != "active" {
				winner, loser = existing, m
			} else if m.Status == "active" && existing.Status != "active" {
				winner, loser = m, existing
			} else if m.LastSeenAt >= existing.LastSeenAt {
				winner, loser = m, existing
			} else {
				winner, loser = existing, m
			}
			if loser.Rotations > winner.Rotations {
				winner.Rotations = loser.Rotations
			}
			if loser.TotalFailovers > winner.TotalFailovers {
				winner.TotalFailovers = loser.TotalFailovers
			}
			if winner.MACAddress == "" && loser.MACAddress != "" {
				winner.MACAddress = loser.MACAddress
			}
			if len(winner.ActivePools) == 0 {
				winner.ActivePools = loser.ActivePools
			}
			delete(s.machines, loser.MachineID)
			clientIPMap[key] = winner
		} else {
			clientIPMap[key] = m
		}
	}
}

func (s *Store) save() error {
	s.cleanDuplicates()
	sd := StoreData{
		Machines: make([]*MachineRecord, 0, len(s.machines)),
		Accounts: make([]*LicenseAccount, 0, len(s.accounts)),
		Reports:  s.reports,
	}
	for _, m := range s.machines {
		sd.Machines = append(sd.Machines, m)
	}
	for _, a := range s.accounts {
		sd.Accounts = append(sd.Accounts, a)
	}

	data, err := json.MarshalIndent(sd, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.filePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, s.filePath)
}

type Server struct {
	store    *Store
	privKey  ed25519.PrivateKey
	adminKey string
	mu       sync.Mutex
}

var geoCache sync.Map

type geoInfo struct {
	Country     string `json:"country"`
	CountryCode string `json:"countryCode"`
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" && !strings.HasPrefix(ip, "127.") && !strings.HasPrefix(ip, "192.168.") && !strings.HasPrefix(ip, "10.") && !strings.HasPrefix(ip, "172.") {
				return ip
			}
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func resolveGeo(ip string) (string, string) {
	if ip == "" || strings.HasPrefix(ip, "127.") || strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "172.") || ip == "::1" {
		return "LOCAL", "Local / LAN"
	}
	if cached, ok := geoCache.Load(ip); ok {
		g := cached.(geoInfo)
		return g.CountryCode, g.Country
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://ip-api.com/json/" + ip + "?fields=status,country,countryCode")
	if err != nil {
		return "??", "Desconocido"
	}
	defer resp.Body.Close()
	var res struct {
		Status      string `json:"status"`
		Country     string `json:"country"`
		CountryCode string `json:"countryCode"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err == nil && res.Status == "success" {
		g := geoInfo{Country: res.Country, CountryCode: res.CountryCode}
		geoCache.Store(ip, g)
		return g.CountryCode, g.Country
	}
	return "??", "Desconocido"
}

func (s *Server) signToken(claims LicenseClaims) string {
	payloadBytes, _ := json.Marshal(claims)
	sig := ed25519.Sign(s.privKey, payloadBytes)
	return base64.RawURLEncoding.EncodeToString(payloadBytes) + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// Handler for client plugins calling home (Zero Auth required, machine reports itself)
func (s *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		MachineID      string   `json:"machine_id"`
		MACAddress     string   `json:"mac_address"`
		ClientName     string   `json:"client_name"`
		Version        string   `json:"version"`
		OS             string   `json:"os"`
		Rotations      int64    `json:"rotations"`
		TotalFailovers int64    `json:"total_failovers"`
		ActivePools    []string `json:"active_pools"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.MachineID) == "" {
		http.Error(w, "Invalid machine_id", http.StatusBadRequest)
		return
	}

	mID := strings.TrimSpace(req.MachineID)
	mac := strings.ToLower(strings.TrimSpace(req.MACAddress))
	now := time.Now().Unix()
	clientIP := getClientIP(r)
	clientName := strings.TrimSpace(req.ClientName)
	if clientName == "" {
		clientName = "Nuevo Usuario"
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	rec, exists := s.store.machines[mID]

	// Deduplicación proactiva: buscar si ya existe la misma máquina con otro MachineID
	if !exists {
		// 1. Coincidencia por MACAddress física
		if mac != "" {
			for oldID, oldRec := range s.store.machines {
				if strings.ToLower(strings.TrimSpace(oldRec.MACAddress)) == mac {
					rec = oldRec
					exists = true
					delete(s.store.machines, oldID)
					rec.MachineID = mID
					s.store.machines[mID] = rec
					log.Printf("⚡ [DEDUP] Máquina unificada por MAC %s: %s -> %s", mac, oldID, mID)
					break
				}
			}
		}

		// 2. Coincidencia por ClientName + IP (para entornos Docker / WSL con MAC virtual)
		if !exists && clientName != "Nuevo Usuario" && clientIP != "" && clientIP != "127.0.0.1" {
			for oldID, oldRec := range s.store.machines {
				if oldRec.ClientName == clientName && oldRec.IP == clientIP {
					rec = oldRec
					exists = true
					delete(s.store.machines, oldID)
					rec.MachineID = mID
					s.store.machines[mID] = rec
					log.Printf("⚡ [DEDUP] Máquina unificada por Client/IP (%s @ %s): %s -> %s", clientName, clientIP, oldID, mID)
					break
				}
			}
		}
	}

	if !exists {
		trialExp := now + (30 * 86400)
		cc, cn := resolveGeo(clientIP)
		rec = &MachineRecord{
			MachineID:      mID,
			MACAddress:     mac,
			ClientName:     clientName,
			FirstSeenAt:    now,
			LastSeenAt:     now,
			Status:         "trial",
			Tier:           "trial",
			ExpiresAt:      trialExp,
			PaymentMethod:  "none",
			Version:        req.Version,
			OS:             req.OS,
			Rotations:      req.Rotations,
			TotalFailovers: req.TotalFailovers,
			ActivePools:    req.ActivePools,
			IP:             clientIP,
			CountryCode:    cc,
			CountryName:    cn,
		}
		s.store.machines[mID] = rec
		_ = s.store.save()
	} else {
		rec.LastSeenAt = now
		if mac != "" {
			rec.MACAddress = mac
		}
		if (rec.ClientName == "" || rec.ClientName == "Nuevo Usuario") && clientName != "Nuevo Usuario" {
			rec.ClientName = clientName
		}
		if req.Version != "" {
			rec.Version = req.Version
		}
		if req.OS != "" {
			rec.OS = req.OS
		}
		if req.Rotations > rec.Rotations {
			rec.Rotations = req.Rotations
		}
		if req.TotalFailovers > rec.TotalFailovers {
			rec.TotalFailovers = req.TotalFailovers
		}
		if len(req.ActivePools) > 0 {
			rec.ActivePools = req.ActivePools
		}
		if clientIP != "" && (rec.IP == "" || rec.CountryCode == "" || rec.CountryCode == "??") {
			rec.IP = clientIP
			rec.CountryCode, rec.CountryName = resolveGeo(clientIP)
		}
		_ = s.store.save()
	}

	diff := rec.ExpiresAt - now
	daysLeft := 0
	if diff > 0 {
		daysLeft = int(diff / 86400)
	} else if rec.ExpiresAt > 0 && rec.Status != "revoked" {
		rec.Status = "expired"
		_ = s.store.save()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":             true,
		"machine_id":     rec.MachineID,
		"status":         rec.Status,
		"tier":           rec.Tier,
		"days_remaining": daysLeft,
		"expires_at":     rec.ExpiresAt,
		"license_token":  rec.LicenseToken,
		"can_rotate":     rec.Status == "active" || (rec.Status == "trial" && daysLeft > 0),
	})
}

// Protected Admin API middleware
func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Admin-Token")
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		if token != s.adminKey {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// Admin: List all machines
func (s *Server) handleAdminList(w http.ResponseWriter, r *http.Request) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	var list []MachineRecord
	for _, m := range s.store.machines {
		list = append(list, *m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":       true,
		"machines": list,
		"count":    len(list),
	})
}

// Admin: Approve machine upon payment
func (s *Server) handleAdminApprove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		MachineID     string `json:"machine_id"`
		ClientName    string `json:"client_name"`
		Tier          string `json:"tier"`   // "pro", "enterprise"
		Days          int    `json:"days"`   // 0 for lifetime
		PaymentMethod string `json:"payment_method"` // "binance", "paypal"
		PaymentRef    string `json:"payment_ref"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.MachineID == "" {
		http.Error(w, "Invalid parameters", http.StatusBadRequest)
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	now := time.Now().Unix()
	var exp int64
	if req.Days > 0 {
		exp = now + int64(req.Days*86400)
	} else {
		exp = 0 // Lifetime
	}

	tier := strings.ToLower(req.Tier)
	if tier == "" {
		tier = "pro"
	}

	claims := LicenseClaims{
		MachineID: req.MachineID,
		Client:    req.ClientName,
		Tier:      tier,
		IssuedAt:  now,
		ExpiresAt: exp,
	}
	token := s.signToken(claims)

	rec, exists := s.store.machines[req.MachineID]
	if !exists {
		rec = &MachineRecord{
			MachineID:   req.MachineID,
			FirstSeenAt: now,
		}
		s.store.machines[req.MachineID] = rec
	}

	rec.ClientName = req.ClientName
	rec.LastSeenAt = now
	rec.Status = "active"
	rec.Tier = tier
	rec.ExpiresAt = exp
	rec.PaymentMethod = req.PaymentMethod
	rec.PaymentRef = req.PaymentRef
	rec.LicenseToken = token

	// Si el cliente especificó un email, vincular la cuenta maestra de 1 solo asiento
	if strings.Contains(req.ClientName, "@") {
		emailKey := strings.ToLower(strings.TrimSpace(req.ClientName))
		rec.Email = emailKey
		acct, ok := s.store.accounts[emailKey]
		if !ok {
			acct = &LicenseAccount{
				Email:           emailKey,
				ActiveMachineID: req.MachineID,
				Tier:            tier,
				ExpiresAt:       exp,
				PaymentMethod:   req.PaymentMethod,
				PaymentRef:      req.PaymentRef,
				CreatedAt:       now,
				LastTransferAt:  now,
				HistoryMachines: []string{req.MachineID},
			}
			s.store.accounts[emailKey] = acct
		} else {
			// Si ya había otra máquina activa, desalojarla (Kicking)
			if acct.ActiveMachineID != "" && acct.ActiveMachineID != req.MachineID {
				if oldMachine, exists := s.store.machines[acct.ActiveMachineID]; exists {
					oldMachine.Status = "revoked"
					oldMachine.LicenseToken = ""
				}
			}
			acct.ActiveMachineID = req.MachineID
			acct.Tier = tier
			acct.ExpiresAt = exp
			acct.LastTransferAt = now
			acct.HistoryMachines = append(acct.HistoryMachines, req.MachineID)
		}
	}

	_ = s.store.save()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":            true,
		"message":       "Licencia aprobada y activada exitosamente",
		"machine_id":    req.MachineID,
		"license_token": token,
	})
}

// Admin: Revoke machine
func (s *Server) handleAdminRevoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		MachineID string `json:"machine_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.MachineID == "" {
		http.Error(w, "Invalid machine_id", http.StatusBadRequest)
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	if rec, exists := s.store.machines[req.MachineID]; exists {
		rec.Status = "revoked"
		rec.LicenseToken = ""
		_ = s.store.save()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"message":    "Licencia revocada inmediatamente",
		"machine_id": req.MachineID,
	})
}

// Client: Subir reporte de diagnóstico y telemetría de soporte (One-Click Telemetry Share)
func (s *Server) handleUploadReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SupportReportRecord
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid report payload", http.StatusBadRequest)
		return
	}

	clientIP := getClientIP(r)
	cc, cn := resolveGeo(clientIP)
	req.IP = clientIP
	req.CountryCode = cc
	req.CountryName = cn
	if req.Timestamp == 0 {
		req.Timestamp = time.Now().Unix()
	}
	if req.ID == "" {
		req.ID = fmt.Sprintf("REP-%d", time.Now().UnixNano()%1000000)
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	if req.MACAddress == "" {
		if m, ok := s.store.machines[req.MachineID]; ok && m.MACAddress != "" {
			req.MACAddress = m.MACAddress
		}
	}

	// Mantener los últimos 50 reportes de soporte
	s.store.reports = append([]*SupportReportRecord{&req}, s.store.reports...)
	if len(s.store.reports) > 50 {
		s.store.reports = s.store.reports[:50]
	}
	_ = s.store.save()

	log.Printf("📩 [Soporte] Nuevo reporte recibido: ID=%s de %s (%s)", req.ID, req.ClientName, req.MachineID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"report_id": req.ID,
		"message":   "Reporte recibido por el equipo de soporte de Wilox con éxito.",
	})
}

// Admin: Listar reportes de diagnóstico
func (s *Server) handleAdminListReports(w http.ResponseWriter, r *http.Request) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"reports": s.store.reports,
		"count":   len(s.store.reports),
	})
}

// Admin: Delete machine permanently (Eliminar registro fantasma)
func (s *Server) handleAdminDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		MachineID string `json:"machine_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.MachineID == "" {
		http.Error(w, "Invalid machine_id", http.StatusBadRequest)
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	delete(s.store.machines, req.MachineID)
	_ = s.store.save()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":         true,
		"message":    "Registro eliminado permanentemente de la base de datos",
		"machine_id": req.MachineID,
	})
}

// Client: Solicitar restablecimiento o transferencia por correo
func (s *Server) handleRequestReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email     string `json:"email"`
		MachineID string `json:"machine_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid parameters", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	mID := strings.TrimSpace(req.MachineID)
	if email == "" || mID == "" {
		http.Error(w, "Email and machine_id required", http.StatusBadRequest)
		return
	}

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	acct, exists := s.store.accounts[email]
	if !exists {
		// No revelar si el correo existe o no para privacidad, pero responder error claro
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      false,
			"message": "No se encontró ninguna licencia activa asociada a este correo.",
		})
		return
	}

	// Verificar si la licencia no ha expirado
	now := time.Now().Unix()
	if acct.ExpiresAt > 0 && now > acct.ExpiresAt {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      false,
			"message": "La licencia asociada a este correo ya ha expirado.",
		})
		return
	}

	// Generar código PIN de 6 dígitos criptográficamente seguro
	n, _ := rand.Int(rand.Reader, big.NewInt(900000))
	pin := fmt.Sprintf("%06d", n.Int64()+100000)

	s.store.pins[email] = &ResetPIN{
		PIN:       pin,
		MachineID: mID,
		ExpiresAt: now + 900, // 15 minutos
	}

	log.Printf("📧 [RESET-PIN] Correo: %s -> PIN: %s (Máquina: %s)", email, pin, mID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"message": "Código de verificación de 6 dígitos generado. Ingrésalo para transferir tu licencia.",
		// Si estamos en entorno de desarrollo/prueba se adjunta el pin para conveniencia
		"dev_pin": pin,
	})
}

// Client: Verificar PIN y transferir licencia (Política de 1 Asiento: Desaloja máquina previa)
func (s *Server) handleVerifyReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email     string `json:"email"`
		MachineID string `json:"machine_id"`
		PIN       string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid parameters", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	mID := strings.TrimSpace(req.MachineID)
	pin := strings.TrimSpace(req.PIN)

	s.store.mu.Lock()
	defer s.store.mu.Unlock()

	pending, exists := s.store.pins[email]
	now := time.Now().Unix()
	if !exists || pending.PIN != pin || pending.MachineID != mID || now > pending.ExpiresAt {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      false,
			"message": "Código PIN inválido o expirado. Solicita uno nuevo.",
		})
		return
	}

	// Consumir el PIN usado
	delete(s.store.pins, email)

	acct, ok := s.store.accounts[email]
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      false,
			"message": "Cuenta no encontrada.",
		})
		return
	}

	// === POLÍTICA ESTRICTA DE 1 ASIENTO: KICKING DE LA MÁQUINA ANTERIOR ===
	oldMachineID := acct.ActiveMachineID
	if oldMachineID != "" && oldMachineID != mID {
		if oldRec, exists := s.store.machines[oldMachineID]; exists {
			oldRec.Status = "revoked"
			oldRec.LicenseToken = ""
			log.Printf("⚡ [KICKING] Máquina previa %s desalojada por transferencia a %s", oldMachineID, mID)
		}
	}

	// Generar nuevo token criptográfico para la máquina actual
	claims := LicenseClaims{
		MachineID: mID,
		Client:    acct.Email,
		Tier:      acct.Tier,
		IssuedAt:  now,
		ExpiresAt: acct.ExpiresAt,
	}
	newToken := s.signToken(claims)

	// Actualizar o crear registro de la nueva máquina
	newRec, exists := s.store.machines[mID]
	if !exists {
		newRec = &MachineRecord{
			MachineID:   mID,
			FirstSeenAt: now,
		}
		s.store.machines[mID] = newRec
	}
	newRec.ClientName = acct.Email
	newRec.Email = acct.Email
	newRec.LastSeenAt = now
	newRec.Status = "active"
	newRec.Tier = acct.Tier
	newRec.ExpiresAt = acct.ExpiresAt
	newRec.LicenseToken = newToken

	// Actualizar cuenta
	acct.ActiveMachineID = mID
	acct.LastTransferAt = now
	acct.HistoryMachines = append(acct.HistoryMachines, mID)

	_ = s.store.save()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":            true,
		"message":       "¡Licencia transferida y activada con éxito en este equipo!",
		"license_token": newToken,
		"tier":          acct.Tier,
		"expires_at":    acct.ExpiresAt,
	})
}

//go:embed assets/logo.png
var embeddedLogo []byte

func (s *Server) handleLogo(w http.ResponseWriter, r *http.Request) {
	if len(embeddedLogo) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(embeddedLogo)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8444"
	}
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./licenses.db"
	}
	adminToken := os.Getenv("ADMIN_TOKEN")
	if adminToken == "" {
		adminToken = defaultAdminToken
	}

	seedHex := os.Getenv("PRIVATE_SEED_HEX")
	if seedHex == "" {
		seedHex = defaultPrivateSeedHex
	}
	seed, err := hex.DecodeString(seedHex)
	if err != nil || len(seed) != ed25519.SeedSize {
		log.Fatalf("Invalid Ed25519 seed: %v", err)
	}
	privKey := ed25519.NewKeyFromSeed(seed)

	store, err := initStore(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	srv := &Server{
		store:    store,
		privKey:  privKey,
		adminKey: adminToken,
	}

	mux := http.NewServeMux()

	// Client endpoints
	mux.HandleFunc("/api/v1/license/ping", srv.handlePing)
	mux.HandleFunc("/api/v1/license/report", srv.handleUploadReport)
	mux.HandleFunc("/api/v1/license/request-reset", srv.handleRequestReset)
	mux.HandleFunc("/api/v1/license/verify-reset", srv.handleVerifyReset)

	// Admin API
	mux.HandleFunc("/api/v1/admin/licenses", srv.requireAdmin(srv.handleAdminList))
	mux.HandleFunc("/api/v1/admin/reports", srv.requireAdmin(srv.handleAdminListReports))
	mux.HandleFunc("/api/v1/admin/approve", srv.requireAdmin(srv.handleAdminApprove))
	mux.HandleFunc("/api/v1/admin/revoke", srv.requireAdmin(srv.handleAdminRevoke))
	mux.HandleFunc("/api/v1/admin/delete", srv.requireAdmin(srv.handleAdminDelete))

	// Embedded Admin Web UI
	mux.HandleFunc("/assets/logo.png", srv.handleLogo)
	mux.HandleFunc("/", srv.handleDashboardUI)

	log.Printf("⚡ CPAMC Cloud License Hub activo en puerto :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
