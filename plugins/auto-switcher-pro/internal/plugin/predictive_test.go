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

	// 3. Simular la 8va petición (alcanza el 80%)
	pe.RecordActivity(acc)
	if !pe.ShouldPreventiveCool(acc) {
		t.Fatalf("expected account to cool down at 80%% threshold")
	}

	fatigue, isCooling, mins := pe.GetAccountStatus(acc)
	if fatigue < 80.0 {
		t.Fatalf("expected fatigue >= 80%%, got %.2f", fatigue)
	}
	if !isCooling {
		t.Fatalf("expected account to be marked as cooling")
	}
	if mins <= 0 {
		t.Fatalf("expected minutes left > 0, got %d", mins)
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
}
