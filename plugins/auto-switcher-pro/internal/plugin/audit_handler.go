package plugin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"auto-switcher-pro/internal/analytics"
)

const (
	auditLogRoutePath       = "/auto-switcher-pro/audit-log"
	telemetryTraceRoutePath = "/auto-switcher-pro/telemetry/export-trace"
	incidentsRoutePath      = "/auto-switcher-pro/incidents"
)

func isAuditLogPath(path string) bool {
	return strings.Contains(path, auditLogRoutePath)
}

func isTelemetryTracePath(path string) bool {
	return strings.Contains(path, telemetryTraceRoutePath)
}

func isIncidentsPath(path string) bool {
	return strings.Contains(path, incidentsRoutePath)
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

func handleIncidentsHTTP(req ManagementRequestPayload) ([]byte, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))

	switch method {
	case http.MethodPost:
		var inc analytics.GuardIncident
		if len(req.Body) > 0 {
			if err := json.Unmarshal(req.Body, &inc); err != nil {
				return jsonManagementResponse(http.StatusBadRequest, map[string]string{
					"error":   "bad_request",
					"message": "invalid incident payload: " + err.Error(),
				})
			}
		}
		if inc.ID == "" {
			inc.ID = fmt.Sprintf("cb_%d", time.Now().UnixMilli())
		}
		if err := analytics.RecordGuardIncident(inc); err != nil {
			return jsonManagementResponse(http.StatusInternalServerError, map[string]string{
				"error":   "db_error",
				"message": err.Error(),
			})
		}
		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":          true,
			"incident_id": inc.ID,
			"status":      "recorded",
		})

	case http.MethodGet, http.MethodHead:
		// Check if querying single incident by id: ?id=... or /incidents/:id
		incidentID := ""
		if req.Query != nil {
			if idVal, ok := req.Query["id"]; ok && len(idVal) > 0 {
				incidentID = strings.TrimSpace(idVal[0])
			}
		}
		if incidentID == "" && strings.Contains(req.Path, incidentsRoutePath+"/") {
			parts := strings.Split(req.Path, incidentsRoutePath+"/")
			if len(parts) > 1 {
				incidentID = strings.TrimSpace(parts[1])
			}
		}

		if incidentID != "" {
			inc, err := analytics.GetGuardIncident(incidentID)
			if err != nil {
				return jsonManagementResponse(http.StatusNotFound, map[string]string{
					"error":   "not_found",
					"message": "incident not found: " + incidentID,
				})
			}
			return jsonManagementResponse(http.StatusOK, map[string]any{
				"ok":       true,
				"incident": inc,
			})
		}

		// List recent incidents
		incidents, err := analytics.QueryGuardIncidents(50)
		if err != nil {
			incidents = []analytics.GuardIncident{}
		}
		return jsonManagementResponse(http.StatusOK, map[string]any{
			"ok":        true,
			"incidents": incidents,
			"total":     len(incidents),
		})

	default:
		return jsonManagementResponse(http.StatusMethodNotAllowed, map[string]string{
			"error":   "method_not_allowed",
			"message": "only GET and POST methods are supported",
		})
	}
}
