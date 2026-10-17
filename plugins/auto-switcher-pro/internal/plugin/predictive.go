package plugin

import (
	"strings"
	"sync"
	"time"
)

// PredictiveConfig define la configuración del motor predictivo
type PredictiveConfig struct {
	Enabled       bool    `json:"enabled"`
	MaxReqsPerHour int     `json:"max_reqs_per_hour"` // Default: 80
	ThresholdPct   float64 `json:"threshold_pct"`      // Default: 80.0 (%)
	CoolingMinutes int     `json:"cooling_minutes"`    // Default: 15
}

// DefaultPredictiveConfig devuelve los valores seguros por defecto
func DefaultPredictiveConfig() PredictiveConfig {
	return PredictiveConfig{
		Enabled:        true,
		MaxReqsPerHour: 80,
		ThresholdPct:   80.0,
		CoolingMinutes: 15,
	}
}

// RequestRecord almacena una llamada en la ventana móvil
type RequestRecord struct {
	Timestamp time.Time
}

// AccountQuotaTelemetry almacena la telemetría viva de cuotas de una cuenta
type AccountQuotaTelemetry struct {
	AccountKey      string    `json:"account_key"`       // filename o email
	Window5hPct     float64   `json:"window_5h_pct"`      // 0.0 - 100.0 (% cuota restante 5h)
	WeeklyPct       float64   `json:"weekly_pct"`         // 0.0 - 100.0 (% cuota restante semanal)
	Window5hResetIn int64     `json:"window_5h_reset_in"` // segundos restantes para refresco 5h
	WeeklyResetIn   int64     `json:"weekly_reset_in"`    // segundos restantes para refresco semanal
	Plan            string    `json:"plan,omitempty"`     // e.g. "Pro", "Free"
	UpdatedAt       time.Time `json:"updated_at"`
}

// normalizeAccountKey normaliza un identificador de cuenta para búsqueda insensible a formato
func normalizeAccountKey(k string) string {
	lower := strings.ToLower(strings.TrimSpace(k))
	lower = strings.TrimPrefix(lower, "antigravity-")
	lower = strings.TrimSuffix(lower, ".json")
	return lower
}

// PredictiveEngine gestiona la fatiga y enfriamiento preventivo de cuentas
type PredictiveEngine struct {
	mu           sync.RWMutex
	config       PredictiveConfig
	activity     map[string][]RequestRecord         // accountKey -> lista de timestamps
	cooling      map[string]time.Time               // accountKey -> hasta cuándo descansa
	quotas       map[string]AccountQuotaTelemetry   // accountKey -> telemetría de cuota viva
	lastActivity map[string]time.Time               // accountKey -> última interacción para seguimiento de Cache TTL
}

var globalPredictiveEngine *PredictiveEngine
var predictiveOnce sync.Once

// GetPredictiveEngine obtiene la instancia única del motor predictivo
func GetPredictiveEngine() *PredictiveEngine {
	predictiveOnce.Do(func() {
		globalPredictiveEngine = &PredictiveEngine{
			config:       DefaultPredictiveConfig(),
			activity:     make(map[string][]RequestRecord),
			cooling:      make(map[string]time.Time),
			quotas:       make(map[string]AccountQuotaTelemetry),
			lastActivity: make(map[string]time.Time),
		}
	})
	return globalPredictiveEngine
}

// GetConfig devuelve la configuración actual de forma thread-safe
func (pe *PredictiveEngine) GetConfig() PredictiveConfig {
	pe.mu.RLock()
	defer pe.mu.RUnlock()
	return pe.config
}

// SetConfig actualiza la configuración
func (pe *PredictiveEngine) SetConfig(cfg PredictiveConfig) {
	pe.mu.Lock()
	defer pe.mu.Unlock()
	if cfg.MaxReqsPerHour <= 0 {
		cfg.MaxReqsPerHour = 80
	}
	if cfg.ThresholdPct <= 0 || cfg.ThresholdPct > 100 {
		cfg.ThresholdPct = 80.0
	}
	if cfg.CoolingMinutes <= 0 {
		cfg.CoolingMinutes = 15
	}
	pe.config = cfg
}

// RecordActivity registra una llamada procesada por una cuenta
func (pe *PredictiveEngine) RecordActivity(accountEmail string) {
	if accountEmail == "" {
		return
	}
	key := normalizeAccountKey(accountEmail)
	pe.mu.Lock()
	defer pe.mu.Unlock()

	now := time.Now()
	pe.activity[key] = append(pe.activity[key], RequestRecord{Timestamp: now})
	if pe.lastActivity == nil {
		pe.lastActivity = make(map[string]time.Time)
	}
	pe.lastActivity[key] = now

	// Limpiar registros mayores a 1 hora
	cutoff := now.Add(-1 * time.Hour)
	valid := make([]RequestRecord, 0, len(pe.activity[key]))
	for _, r := range pe.activity[key] {
		if r.Timestamp.After(cutoff) {
			valid = append(valid, r)
		}
	}
	pe.activity[key] = valid

	// Si superó el umbral, marcar enfriamiento preventivo
	limit := float64(pe.config.MaxReqsPerHour) * (pe.config.ThresholdPct / 100.0)
	if float64(len(valid)) >= limit {
		pe.cooling[key] = now.Add(time.Duration(pe.config.CoolingMinutes) * time.Minute)
	}
}

// RecordLiveQuota actualiza la telemetría viva de cuotas obtenida de Antigravity
func (pe *PredictiveEngine) RecordLiveQuota(telemetry AccountQuotaTelemetry) {
	if telemetry.AccountKey == "" {
		return
	}
	key := normalizeAccountKey(telemetry.AccountKey)
	pe.mu.Lock()
	defer pe.mu.Unlock()

	if pe.quotas == nil {
		pe.quotas = make(map[string]AccountQuotaTelemetry)
	}
	if telemetry.UpdatedAt.IsZero() {
		telemetry.UpdatedAt = time.Now()
	}
	telemetry.AccountKey = key
	pe.quotas[key] = telemetry
}

// GetLiveQuota obtiene la telemetría viva de cuotas para una cuenta
func (pe *PredictiveEngine) GetLiveQuota(accountKey string) (AccountQuotaTelemetry, bool) {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	if pe.quotas == nil {
		return AccountQuotaTelemetry{}, false
	}
	key := normalizeAccountKey(accountKey)
	q, ok := pe.quotas[key]
	return q, ok
}

// GetAllLiveQuotas devuelve la lista completa de cuotas registradas
func (pe *PredictiveEngine) GetAllLiveQuotas() []AccountQuotaTelemetry {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	list := make([]AccountQuotaTelemetry, 0, len(pe.quotas))
	for _, q := range pe.quotas {
		list = append(list, q)
	}
	return list
}

// ShouldPreventiveCool indica si la cuenta debe descansar preventivamente para evitar un 429
func (pe *PredictiveEngine) ShouldPreventiveCool(accountEmail string) bool {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	if !pe.config.Enabled || accountEmail == "" {
		return false
	}

	key := normalizeAccountKey(accountEmail)

	// 1. ¿Está en período de enfriamiento activo?
	if coolUntil, ok := pe.cooling[key]; ok {
		if time.Now().Before(coolUntil) {
			return true
		}
	}

	// 2. ¿Tiene agotamiento crítico de cuota viva (< 15% restante en ventana de 5h o semanal)?
	if pe.quotas != nil {
		if q, ok := pe.quotas[key]; ok {
			// Si la cuota restante de 5 horas o la semanal está por debajo del 15% (incluyendo agotamiento total al 0.0%)
			if !q.UpdatedAt.IsZero() {
				if q.Window5hPct < 15.0 || q.WeeklyPct < 15.0 {
					return true
				}
			}
		}
	}

	// 3. ¿Tiene fatiga acumulada en la última hora por volumen de requests?
	now := time.Now()
	cutoff := now.Add(-1 * time.Hour)
	count := 0
	for _, r := range pe.activity[key] {
		if r.Timestamp.After(cutoff) {
			count++
		}
	}

	limit := float64(pe.config.MaxReqsPerHour) * (pe.config.ThresholdPct / 100.0)
	return float64(count) >= limit
}

// IsCriticalQuotaOrCooldown evalúa si la cuenta tiene cuota críticamente agotada (<15%) o cooldown activo,
// lo cual justifica una rotación inmediata sin exigir margen de histeresis para evitar un 429 fatal.
func (pe *PredictiveEngine) IsCriticalQuotaOrCooldown(accountEmail string) bool {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	if accountEmail == "" {
		return false
	}
	key := normalizeAccountKey(accountEmail)

	// 1. ¿Está en período de enfriamiento activo?
	if coolUntil, ok := pe.cooling[key]; ok {
		if time.Now().Before(coolUntil) {
			return true
		}
	}

	// 2. ¿Tiene agotamiento crítico de cuota viva (< 15% restante en ventana de 5h o semanal)?
	if pe.quotas != nil {
		if q, ok := pe.quotas[key]; ok {
			if !q.UpdatedAt.IsZero() {
				if q.Window5hPct < 15.0 || q.WeeklyPct < 15.0 {
					return true
				}
			}
		}
	}

	return false
}

// GetAccountStatus devuelve el porcentaje de fatiga y minutos restantes de descanso
func (pe *PredictiveEngine) GetAccountStatus(accountEmail string) (fatiguePct float64, isCooling bool, minutesLeft int) {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	key := normalizeAccountKey(accountEmail)
	now := time.Now()
	cutoff := now.Add(-1 * time.Hour)
	count := 0
	for _, r := range pe.activity[key] {
		if r.Timestamp.After(cutoff) {
			count++
		}
	}

	maxReqs := pe.config.MaxReqsPerHour
	if maxReqs <= 0 {
		maxReqs = 80
	}
	fatiguePct = (float64(count) / float64(maxReqs)) * 100.0
	if fatiguePct > 100.0 {
		fatiguePct = 100.0
	}

	if coolUntil, ok := pe.cooling[key]; ok {
		if now.Before(coolUntil) {
			isCooling = true
			minutesLeft = int(coolUntil.Sub(now).Minutes()) + 1
		}
	}

	// Si la cuota viva está agotada (<15%), reportar como cooling preventivo si no lo estaba
	if !isCooling && pe.quotas != nil {
		if q, ok := pe.quotas[key]; ok {
			if (q.Window5hPct > 0 && q.Window5hPct < 15.0) || (q.WeeklyPct > 0 && q.WeeklyPct < 15.0) {
				isCooling = true
				if q.Window5hResetIn > 0 {
					minutesLeft = int(q.Window5hResetIn / 60)
				} else {
					minutesLeft = 15
				}
			}
		}
	}

	return fatiguePct, isCooling, minutesLeft
}

// GetCacheTTLSeconds calcula los segundos restantes de vida útil del Prompt Caching
// en Google Antigravity (TTL estándar de 5 minutos = 300 segundos desde la última interacción).
// Devuelve segundos restantes (0 si expiró) y si la cuenta está actualmente "caliente".
func (pe *PredictiveEngine) GetCacheTTLSeconds(accountEmail string) (remainingSeconds int, isHot bool) {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	key := normalizeAccountKey(accountEmail)
	if pe.lastActivity == nil {
		return 0, false
	}
	last, ok := pe.lastActivity[key]
	if !ok || last.IsZero() {
		return 0, false
	}

	const cacheTTL = 300 * time.Second
	elapsed := time.Since(last)
	if elapsed >= cacheTTL {
		return 0, false
	}

	rem := int((cacheTTL - elapsed).Seconds())
	return rem, rem > 0
}

