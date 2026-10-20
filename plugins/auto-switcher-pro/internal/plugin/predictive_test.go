package plugin

import (
	"testing"
	"time"
)

func TestPredictiveEngine(t *testing.T) {
	pe := &PredictiveEngine{
		config: PredictiveConfig{
			Enabled:        true,
			MaxReqsPerHour: 10,
			ThresholdPct:   80.0, // 8 requests activan enfriamiento
			CoolingMinutes: 10,
		},
		activity: make(map[string][]RequestRecord),
		cooling:  make(map[string]time.Time),
	}

	acc := "test-leader@gmail.com"

	// 1. Inicialmente no debe descansar
	if pe.ShouldPreventiveCool(acc) {
		t.Fatalf("expected account not to cool down initially")
	}

	// 2. Simular 7 peticiones (70% < 80%)
	for i := 0; i < 7; i++ {
		pe.RecordActivity(acc)
	}
	if pe.ShouldPreventiveCool(acc) {
		t.Fatalf("expected account not to cool down at 70%%")
	}

	// 3. Simular la 8va petición (alcanza el 80% de fatiga, pero sin telemetría de cuota)
	pe.RecordActivity(acc)
	if !pe.ShouldPreventiveCool(acc) {
		t.Fatalf("expected account without quota telemetry to cool down at 80%% request threshold")
	}

	fatigue, _, _ := pe.GetAccountStatus(acc)
	if fatigue < 80.0 {
		t.Fatalf("expected fatigue >= 80%%, got %.2f", fatigue)
	}

	// 3b. Sticky leader hysteresis: Si la cuenta tiene cuota viva sana (>= 20% 5h y >= 15% semanal),
	// ShouldPreventiveCool DEBE devolver false a pesar de tener >80% de fatiga por requests para proteger Prompt Caching.
	pe.RecordLiveQuota(AccountQuotaTelemetry{
		AccountKey:  acc,
		Window5hPct: 90.0,
		WeeklyPct:   85.0,
		UpdatedAt:   time.Now(),
	})
	if pe.ShouldPreventiveCool(acc) {
		t.Fatalf("account with healthy live quota (90%%) must remain sticky even if request volume is high")
	}

	// 3c. SetCooldown: Si ocurre un evento reactivo (429), SetCooldown debe forzar enfriamiento
	pe.SetCooldown(acc, 15*time.Minute)
	if !pe.ShouldPreventiveCool(acc) {
		t.Fatalf("account with explicit cooldown must cool down")
	}
	_, isCooling, mins := pe.GetAccountStatus(acc)
	if !isCooling || mins <= 0 {
		t.Fatalf("expected account to be cooling with positive minutes left")
	}

	// 4. Deshabilitar motor predictivo debe saltarse la protección
	pe.SetConfig(PredictiveConfig{
		Enabled:        false,
		MaxReqsPerHour: 10,
		ThresholdPct:   80.0,
		CoolingMinutes: 10,
	})
	if pe.ShouldPreventiveCool(acc) {
		t.Fatalf("expected disabled engine to not force cooling")
	}

	// 5. Test Live Quota Telemetry Ingestion & Exhaustion Protection
	pe.SetConfig(PredictiveConfig{
		Enabled:        true,
		MaxReqsPerHour: 80,
		ThresholdPct:   80.0,
		CoolingMinutes: 15,
	})
	quotaAcc := "quota-user@gmail.com"
	pe.RecordLiveQuota(AccountQuotaTelemetry{
		AccountKey:      quotaAcc,
		Window5hPct:     100.0,
		WeeklyPct:       95.0,
		Window5hResetIn: 14400,
		Plan:            "Pro",
	})
	q, ok := pe.GetLiveQuota(quotaAcc)
	if !ok || q.Window5hPct != 100.0 {
		t.Fatalf("expected live quota to be stored and retrieved, got %+v", q)
	}
	if pe.ShouldPreventiveCool(quotaAcc) {
		t.Fatalf("account with 100%% quota should not cool down")
	}

	// When 5h quota is critically depleted (< 15%), it must trigger preventive cooling
	pe.RecordLiveQuota(AccountQuotaTelemetry{
		AccountKey:      quotaAcc,
		Window5hPct:     10.0, // Critical depletion (< 15%)
		WeeklyPct:       80.0,
		Window5hResetIn: 3600,
	})
	if !pe.ShouldPreventiveCool(quotaAcc) {
		t.Fatalf("account with 10%% 5h quota should trigger preventive cooling")
	}

	// Boundary condition: total exhaustion at 0.0% must also trigger preventive cooling
	pe.RecordLiveQuota(AccountQuotaTelemetry{
		AccountKey:      quotaAcc,
		Window5hPct:     0.0, // Absolute exhaustion
		WeeklyPct:       0.0,
		Window5hResetIn: 7200,
	})
	if !pe.ShouldPreventiveCool(quotaAcc) {
		t.Fatalf("account with 0%% quota must trigger preventive cooling")
	}
}
