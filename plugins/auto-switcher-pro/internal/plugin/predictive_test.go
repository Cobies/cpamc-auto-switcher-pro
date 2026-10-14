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
}
