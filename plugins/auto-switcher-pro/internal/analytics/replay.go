package analytics

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// TelemetryTrace encapsulates an anonymized sequence of telemetry events for deterministic replay.
type TelemetryTrace struct {
	Version     string            `json:"version"`
	ExportedAt  int64             `json:"exported_at"`
	EventsCount int               `json:"events_count"`
	FlightLogs  []FlightLogTrace  `json:"flight_logs"`
	Rotations   []RotationTrace   `json:"rotations"`
}

type FlightLogTrace struct {
	Timestamp    int64  `json:"timestamp"`
	AnonAccount  string `json:"anon_account"`
	PoolID       string `json:"pool_id"`
	ErrorKind    string `json:"error_kind"`
	StatusCode   int    `json:"status_code"`
	ErrorMessage string `json:"error_message"`
	LatencyMs    int64  `json:"latency_ms"`
}

type RotationTrace struct {
	Timestamp   int64  `json:"timestamp"`
	PoolPrefix  string `json:"pool_prefix"`
	AnonAccount string `json:"anon_account"`
	IsFailover  bool   `json:"is_failover"`
	TargetModel string `json:"target_model"`
	StatusCode  int    `json:"status_code"`
}

// ReplayDecision represents the simulated behavior when replaying a trace.
type ReplayDecision struct {
	Timestamp     int64  `json:"timestamp"`
	AnonAccount   string `json:"anon_account"`
	StatusCode    int    `json:"status_code"`
	Rotated       bool   `json:"rotated"`
	TriggerReason string `json:"trigger_reason"`
}

func anonymizeEmail(email string) string {
	e := strings.TrimSpace(strings.ToLower(email))
	if e == "" {
		return "anon_unknown"
	}
	h := sha256.Sum256([]byte(e))
	return fmt.Sprintf("acc_%s", hex.EncodeToString(h[:4]))
}

// ExportAnonymousTrace exports up to limit flight events and rotations with strict PII anonymization.
func ExportAnonymousTrace(limit int) (*TelemetryTrace, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	flightEvents, err := QueryFlightEvents(limit)
	if err != nil {
		flightEvents = nil // Degrade gracefully if table is empty or error
	}

	db, err := InitDB()
	if err != nil || db == nil {
		return nil, fmt.Errorf("db unavailable: %w", err)
	}

	rows, err := db.Query(`SELECT timestamp, pool_prefix, account_email, is_failover, target_model, status_code
		FROM pool_rotations ORDER BY timestamp DESC LIMIT ?`, limit)
	var rotations []RotationTrace
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r RotationTrace
			var email string
			var isFailoverInt int
			if err := rows.Scan(&r.Timestamp, &r.PoolPrefix, &email, &isFailoverInt, &r.TargetModel, &r.StatusCode); err == nil {
				r.AnonAccount = anonymizeEmail(email)
				r.IsFailover = (isFailoverInt == 1)
				rotations = append(rotations, r)
			}
		}
	}

	var flightLogs []FlightLogTrace
	for _, f := range flightEvents {
		flightLogs = append(flightLogs, FlightLogTrace{
			Timestamp:    f.Timestamp,
			AnonAccount:  anonymizeEmail(f.AccountEmail),
			PoolID:       f.PoolID,
			ErrorKind:    f.ErrorKind,
			StatusCode:   f.StatusCode,
			ErrorMessage: f.ErrorMessage,
			LatencyMs:    f.LatencyMs,
		})
	}

	return &TelemetryTrace{
		Version:     "1.0.0",
		ExportedAt:  time.Now().UnixMilli(),
		EventsCount: len(flightLogs) + len(rotations),
		FlightLogs:  flightLogs,
		Rotations:   rotations,
	}, nil
}

// ReplayTrace deterministically simulates rotation and failover responses against the recorded events.
func ReplayTrace(trace *TelemetryTrace) []ReplayDecision {
	var decisions []ReplayDecision
	if trace == nil {
		return decisions
	}

	// Simular análisis de eventos de flight_recorder cronológicamente
	for _, f := range trace.FlightLogs {
		rotated := false
		reason := "normal_traffic"

		if f.StatusCode == 429 || strings.Contains(strings.ToLower(f.ErrorMessage), "exhausted") || strings.Contains(strings.ToLower(f.ErrorMessage), "rate limit") {
			rotated = true
			reason = "reactive_failover_429"
		} else if f.StatusCode >= 500 {
			rotated = true
			reason = "upstream_service_error"
		}

		decisions = append(decisions, ReplayDecision{
			Timestamp:     f.Timestamp,
			AnonAccount:   f.AnonAccount,
			StatusCode:    f.StatusCode,
			Rotated:       rotated,
			TriggerReason: reason,
		})
	}

	return decisions
}
