package plugin

import (
	"net/http"
	"strings"

	"auto-switcher-pro/internal/analytics"
)

const auditLogRoutePath = "/auto-switcher-pro/audit-log"

func isAuditLogPath(path string) bool {
	return strings.Contains(path, auditLogRoutePath)
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

	return jsonManagementResponse(http.StatusOK, map[string]any{
		"ok":              true,
		"audit_events":    audits,
		"flight_recorder": flights,
		"total_audits":    len(audits),
		"total_flights":   len(flights),
	})
}
