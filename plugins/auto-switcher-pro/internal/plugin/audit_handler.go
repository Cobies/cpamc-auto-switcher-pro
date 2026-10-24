package plugin

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"auto-switcher-pro/internal/analytics"
)

const (
	auditLogRoutePath       = "/auto-switcher-pro/audit-log"
	telemetryTraceRoutePath = "/auto-switcher-pro/telemetry/export-trace"
)

func isAuditLogPath(path string) bool {
	return strings.Contains(path, auditLogRoutePath)
}

func isTelemetryTracePath(path string) bool {
	return strings.Contains(path, telemetryTraceRoutePath)
}

func handleTelemetryTraceHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodGet && method != http.MethodHead {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "only GET and HEAD methods are supported",
		})
	}

	trace, err := analytics.ExportAnonymousTrace(100)
	if err != nil {
		return jsonManagementResponse(http.StatusInternalServerError, map[string]string{
			"error":   "export_failed",
			"message": err.Error(),
		})
	}
	return jsonManagementResponse(http.StatusOK, trace)
}

// TimelineItem represents a unified time-machine event for session observability.
type TimelineItem struct {
	Timestamp   int64  `json:"timestamp"`
	Type        string `json:"type"` // "rotation", "failover", "circuit_breaker", "survival", "flight_incident"
	Title       string `json:"title"`
	Account     string `json:"account"`
	PoolID      string `json:"pool_id"`
	StatusCode  int    `json:"status_code"`
	Description string `json:"description"`
}

func handleAuditLogHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method != http.MethodGet && method != http.MethodHead {
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "only GET and HEAD methods are supported",
		})
	}

	audits, err := analytics.QueryAuditEvents(100)
	if err != nil {
		audits = []analytics.AuditEvent{}
	}

	flights, err := analytics.QueryFlightEvents(50)
	if err != nil {
		flights = []analytics.FlightRecorderEvent{}
	}

	rotations, err := analytics.QueryRecentRotations(50)
	if err != nil {
		rotations = []analytics.RotationEvent{}
	}

	// Build unified time-machine timeline
	timeline := make([]TimelineItem, 0, len(audits)+len(flights)+len(rotations))

	for _, a := range audits {
		eventType := strings.ToLower(a.EventType)
		itemType := "audit"
		switch {
		case strings.Contains(eventType, "circuit_breaker"):
			itemType = "circuit_breaker"
		case strings.Contains(eventType, "survival"):
			itemType = "survival"
		case strings.Contains(eventType, "failover"):
			itemType = "failover"
		}
		timeline = append(timeline, TimelineItem{
			Timestamp:   a.Timestamp,
			Type:        itemType,
			Title:       fmt.Sprintf("%s (%s)", a.EventType, a.TriggerReason),
			Account:     a.NewLeader,
			PoolID:      a.PoolID,
			StatusCode:  a.StatusCode,
			Description: a.DetailsJSON,
		})
	}

	for _, f := range flights {
		timeline = append(timeline, TimelineItem{
			Timestamp:   f.Timestamp,
			Type:        "flight_incident",
			Title:       fmt.Sprintf("Incidente: %s (HTTP %d)", f.ErrorKind, f.StatusCode),
			Account:     f.AccountEmail,
			PoolID:      f.PoolID,
			StatusCode:  f.StatusCode,
			Description: f.ErrorMessage,
		})
	}

	for _, r := range rotations {
		rType := "rotation"
		if r.IsFailover {
			rType = "failover"
		}
		timeline = append(timeline, TimelineItem{
			Timestamp:   r.Timestamp,
			Type:        rType,
			Title:       fmt.Sprintf("Petición atendida en %s", r.TargetModel),
			Account:     r.AccountEmail,
			PoolID:      r.PoolID,
			StatusCode:  r.StatusCode,
			Description: fmt.Sprintf("Cuenta: %s (cascada #%d)", r.SelectedAccount, r.CascadeIndex),
		})
	}

	// Sort timeline strictly descending by timestamp
	sort.Slice(timeline, func(i, j int) bool {
		return timeline[i].Timestamp > timeline[j].Timestamp
	})

	return jsonManagementResponse(http.StatusOK, map[string]any{
		"ok":               true,
		"timeline":         timeline,
		"audit_events":     audits,
		"flight_recorder":  flights,
		"recent_rotations": rotations,
		"total_events":     len(timeline),
	})
}
