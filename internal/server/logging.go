package server

import (
	"net/http"
	"time"

	"go.uber.org/zap"
)

type loggedResponse struct {
	http.ResponseWriter
	status int
}

func (w *loggedResponse) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *loggedResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}

	if status >= 200 {
		w.status = status
	}

	w.ResponseWriter.WriteHeader(status)
}

func (w *loggedResponse) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}

	return w.ResponseWriter.Write(data)
}

func logRequest(logger *zap.Logger, r *http.Request, response *loggedResponse, started time.Time) {
	// Patterns come from our router, never user-supplied URLs. Do not log query
	// strings, headers, bodies, peer IPs, cookies, or unmatched request paths.
	if r.Pattern == "GET /healthz" {
		return
	}

	route := r.Pattern

	if route == "" {
		route = "unmatched"
	}

	status := response.status

	if status == 0 {
		status = http.StatusOK
	}

	fields := []zap.Field{
		zap.String("route", route),
		zap.Int("status", status),
		zap.Duration("duration", time.Since(started)),
	}

	switch {
	case status >= 500:
		logger.Error("HTTP request failed", fields...)

	case route == "POST /api/1.0/auth/login" && status >= 400:
		logger.Warn("Login rejected", fields...)

	case route == "POST /api/1.0/auth/login" && status == http.StatusOK:
		logger.Info("Admin session created", fields...)

	case route == "POST /api/1.0/auth/logout" && status < 400:
		logger.Info("Admin session ended", fields...)

	default:
		logger.Debug("HTTP request completed", fields...)
	}
}
