package analytics

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// AccountStabilityMetrics aggregates health, failure history, and stability score from SQLite.
type AccountStabilityMetrics struct {
	AccountEmail      string  `json:"account_email"`
	TotalRequests     int     `json:"total_requests"`
	SuccessRate       float64 `json:"success_rate"`       // Percentage 0.0 - 100.0
	StabilityScore    float64 `json:"stability_score"`    // 0.0 - 100.0 calculated score
	RecentErrors      int     `json:"recent_errors"`      // Errors in the last 24h
	LastErrorCode     int     `json:"last_error_code"`
	LastErrorMessage  string  `json:"last_error_message"`
	LastErrorTimeMs   int64   `json:"last_error_time_ms"`
	IsCooling         bool    `json:"is_cooling"`
	HealthRating      string  `json:"health_rating"`      // "Excelente", "Estable", "Degradada", "En Riesgo"
}

// QueryAccountStability calculates real-time stability metrics for any given account or email.
func QueryAccountStability(accountOrEmail string) (AccountStabilityMetrics, error) {
	metrics := AccountStabilityMetrics{
		AccountEmail:   accountOrEmail,
		SuccessRate:    100.0,
		StabilityScore: 100.0,
		HealthRating:   "Excelente",
	}

	cleanEmail := strings.TrimSuffix(strings.TrimPrefix(accountOrEmail, "antigravity-"), ".json")
	if cleanEmail == "" {
		return metrics, fmt.Errorf("account identifier cannot be empty")
	}

	db, err := InitDB()
	if err != nil || db == nil {
		return metrics, nil // Graceful degradation if DB is not ready
	}

	// 1. Total peticiones y exitosas en pool_rotations (últimos 7 días)
	cutoff7d := time.Now().AddDate(0, 0, -7).UnixMilli()
	var totalReqs, failedReqs int
	row := db.QueryRow(`
		SELECT 
			COUNT(*),
			COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0)
		FROM pool_rotations 
		WHERE (account_email LIKE ? OR selected_account LIKE ?) AND timestamp >= ?
	`, "%"+cleanEmail+"%", "%"+cleanEmail+"%", cutoff7d)
	_ = row.Scan(&totalReqs, &failedReqs)

	// 2. Incidentes de vuelo registrados en flight_recorder (últimas 24h)
	cutoff24h := time.Now().Add(-24 * time.Hour).UnixMilli()
	var errors24h int
	var lastStatus int
	var lastMsg sql.NullString
	var lastTs sql.NullInt64

	rowErr := db.QueryRow(`
		SELECT 
			COUNT(*),
			COALESCE(MAX(status_code), 0),
			COALESCE(MAX(error_message), ''),
			COALESCE(MAX(timestamp), 0)
		FROM flight_recorder
		WHERE account_email LIKE ? AND timestamp >= ?
	`, "%"+cleanEmail+"%", cutoff24h)
	_ = rowErr.Scan(&errors24h, &lastStatus, &lastMsg, &lastTs)

	// Si no hay en flight_recorder 24h, consultar último error histórico
	if lastStatus == 0 {
		rowLast := db.QueryRow(`
			SELECT status_code, error_message, timestamp
			FROM flight_recorder
			WHERE account_email LIKE ?
			ORDER BY timestamp DESC LIMIT 1
		`, "%"+cleanEmail+"%")
		_ = rowLast.Scan(&lastStatus, &lastMsg, &lastTs)
	}

	metrics.TotalRequests = totalReqs
	metrics.RecentErrors = errors24h
	metrics.LastErrorCode = lastStatus
	if lastMsg.Valid {
		metrics.LastErrorMessage = lastMsg.String
	}
	if lastTs.Valid {
		metrics.LastErrorTimeMs = lastTs.Int64
	}

	// 3. Cálculo de SuccessRate y StabilityScore
	if totalReqs > 0 {
		successes := totalReqs - failedReqs
		if successes < 0 {
			successes = 0
		}
		metrics.SuccessRate = (float64(successes) / float64(totalReqs)) * 100.0
	}

	// Score compuesto: penaliza errores recientes
	score := metrics.SuccessRate
	if errors24h > 0 {
		score -= float64(errors24h * 15)
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	metrics.StabilityScore = score

	// Categorización de salud
	switch {
	case score >= 95.0 && errors24h == 0:
		metrics.HealthRating = "Excelente"
	case score >= 80.0 && errors24h <= 1:
		metrics.HealthRating = "Estable"
	case score >= 50.0:
		metrics.HealthRating = "Degradada"
	default:
		metrics.HealthRating = "En Riesgo"
	}

	return metrics, nil
}
