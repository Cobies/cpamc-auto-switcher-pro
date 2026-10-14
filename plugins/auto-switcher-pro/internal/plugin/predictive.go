package plugin

import (
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

// PredictiveEngine gestiona la fatiga y enfriamiento preventivo de cuentas
type PredictiveEngine struct {
	mu       sync.RWMutex
	config   PredictiveConfig
	activity map[string][]RequestRecord // accountEmail -> lista de timestamps
	cooling  map[string]time.Time       // accountEmail -> hasta cuándo descansa
}

var globalPredictiveEngine *PredictiveEngine
var predictiveOnce sync.Once

// GetPredictiveEngine obtiene la instancia única del motor predictivo
func GetPredictiveEngine() *PredictiveEngine {
	predictiveOnce.Do(func() {
		globalPredictiveEngine = &PredictiveEngine{
			config:   DefaultPredictiveConfig(),
			activity: make(map[string][]RequestRecord),
			cooling:  make(map[string]time.Time),
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
	pe.mu.Lock()
	defer pe.mu.Unlock()

	now := time.Now()
	pe.activity[accountEmail] = append(pe.activity[accountEmail], RequestRecord{Timestamp: now})

	// Limpiar registros mayores a 1 hora
	cutoff := now.Add(-1 * time.Hour)
	valid := make([]RequestRecord, 0, len(pe.activity[accountEmail]))
	for _, r := range pe.activity[accountEmail] {
		if r.Timestamp.After(cutoff) {
			valid = append(valid, r)
		}
	}
	pe.activity[accountEmail] = valid

	// Si superó el umbral, marcar enfriamiento preventivo
	limit := float64(pe.config.MaxReqsPerHour) * (pe.config.ThresholdPct / 100.0)
	if float64(len(valid)) >= limit {
		pe.cooling[accountEmail] = now.Add(time.Duration(pe.config.CoolingMinutes) * time.Minute)
	}
}

// ShouldPreventiveCool indica si la cuenta debe descansar preventivamente para evitar un 429
func (pe *PredictiveEngine) ShouldPreventiveCool(accountEmail string) bool {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	if !pe.config.Enabled || accountEmail == "" {
		return false
	}

	// 1. ¿Está en período de enfriamiento activo?
	if coolUntil, ok := pe.cooling[accountEmail]; ok {
		if time.Now().Before(coolUntil) {
			return true
		}
	}

	// 2. ¿Tiene fatiga acumulada en la última hora?
	now := time.Now()
	cutoff := now.Add(-1 * time.Hour)
	count := 0
	for _, r := range pe.activity[accountEmail] {
		if r.Timestamp.After(cutoff) {
			count++
		}
	}

	limit := float64(pe.config.MaxReqsPerHour) * (pe.config.ThresholdPct / 100.0)
	return float64(count) >= limit
}

// GetAccountStatus devuelve el porcentaje de fatiga y minutos restantes de descanso
func (pe *PredictiveEngine) GetAccountStatus(accountEmail string) (fatiguePct float64, isCooling bool, minutesLeft int) {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	now := time.Now()
	cutoff := now.Add(-1 * time.Hour)
	count := 0
	for _, r := range pe.activity[accountEmail] {
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

	if coolUntil, ok := pe.cooling[accountEmail]; ok {
		if now.Before(coolUntil) {
			isCooling = true
			minutesLeft = int(coolUntil.Sub(now).Minutes()) + 1
		}
	}

	return fatiguePct, isCooling, minutesLeft
}
