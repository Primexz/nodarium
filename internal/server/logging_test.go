package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/geoip"
	"github.com/Primexz/nodarium/internal/storage"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

type failingHistory struct{}

func (failingHistory) History(context.Context, string, string, string, time.Time) (storage.History, error) {
	return storage.History{}, errors.New("postgres://user:private-db-password@host/database")
}

func TestRequestLoggingAndSecretProtection(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	h := New(
		auth.New("private-admin-key", false),
		mockSnapshot{},
		failingHistory{},
		fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		geoip.New(geoip.Config{}, nil),
		nil,
		nil,
		zap.New(core),
	)

	var cookie *http.Cookie

	for _, tc := range []struct {
		method, path, body, route string
		status                    int
		level                     zapcore.Level
	}{
		{"GET", "/healthz", "", "", 200, zap.DebugLevel},
		{"GET", "/api/1.0/peers?token=private-query", "", "GET /api/", 401, zap.DebugLevel},
		{
			"POST",
			"/api/1.0/auth/login",
			`{"key":"private-wrong-key"}`,
			"POST /api/1.0/auth/login",
			401,
			zap.WarnLevel,
		},
		{
			"POST",
			"/api/1.0/auth/login",
			`{"key":"private-admin-key"}`,
			"POST /api/1.0/auth/login",
			200,
			zap.InfoLevel,
		},
		{"GET", "/api/1.0/peers?token=private-query", "", "GET /api/1.0/peers", 200, zap.DebugLevel},
		{
			"GET",
			"/api/1.0/history?metric=peers&range=1h",
			"",
			"GET /api/1.0/history",
			503,
			zap.ErrorLevel,
		},
		{"GET", "/private-path", "", "GET /", 200, zap.DebugLevel},
		{"GET", "/private-path.js", "", "GET /", 404, zap.DebugLevel},
		{"POST", "/private-path", "", "unmatched", 405, zap.DebugLevel},
		{"POST", "/api/1.0/auth/logout", "", "POST /api/1.0/auth/logout", 204, zap.InfoLevel},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer private-header")

			if cookie != nil {
				r.AddCookie(cookie)
			}

			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)

			if w.Code != tc.status {
				t.Fatalf("got status %d, want %d", w.Code, tc.status)
			}

			if tc.path == "/api/1.0/auth/login" && tc.status == 200 {
				cookie = w.Result().Cookies()[0]
			}

			entries := logs.TakeAll()

			if tc.path == "/healthz" {
				if len(entries) != 0 {
					t.Fatal("health check should be quiet")
				}

				return
			}

			if len(entries) != 1 {
				t.Fatalf("got %d logs", len(entries))
			}

			entry := entries[0]
			fields := entry.ContextMap()

			if entry.Level != tc.level ||
				fields["route"] != tc.route ||
				fields["status"] != int64(tc.status) ||
				fields["duration"] == nil {
				t.Fatalf("unexpected log: %+v %v", entry, fields)
			}

			data, _ := json.Marshal(fields)
			secrets := []string{
				"private-admin-key",
				"private-wrong-key",
				"private-query",
				"private-header",
				"private-path",
				"private-db-password",
			}

			if cookie != nil {
				secrets = append(secrets, cookie.Value)
			}

			for _, secret := range secrets {
				if strings.Contains(entry.Message+string(data), secret) {
					t.Fatal("sensitive request data logged")
				}
			}
		})
	}
}

func TestLoggedResponsePreservesStatus(t *testing.T) {
	w := httptest.NewRecorder()
	r := &loggedResponse{ResponseWriter: w}
	r.WriteHeader(201)
	r.WriteHeader(500)
	r.Write([]byte("created"))

	if r.status != 201 || w.Code != 201 || w.Body.String() != "created" || r.Unwrap() != w {
		t.Fatal("response altered by logging")
	}
}
