package server

import (
	"bufio"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/Primexz/nodarium/internal/activity"
	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/storage"
)

func activityHandler(t *testing.T) (http.Handler, *activity.Service) {
	t.Helper()
	db, err := storage.Open(t.Context(), "sqlite", filepath.Join(t.TempDir(), "stream.db"))
	if err != nil {
		t.Fatal(err)
	}
	service := activity.New(t.Context(), nil, mockSnapshot{}, db, nil, nil, nil)
	t.Cleanup(func() { service.Close(); db.Close() })
	return NewWithActivity(auth.New("secret", false), mockSnapshot{}, db, fstest.MapFS{"index.html": {Data: []byte("app")}}, nil, nil, nil, nil, service), service
}
func loginActivity(t *testing.T, handler http.Handler) *http.Cookie {
	t.Helper()
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/1.0/auth/login", strings.NewReader(`{"key":"secret"}`))
	r.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	return w.Result().Cookies()[0]
}
func TestActivityRoutesAndValidation(t *testing.T) {
	h, _ := activityHandler(t)
	for _, path := range []string{"/api/1.0/activity/live", "/api/1.0/activity/events", "/api/1.0/activity/stream?view=live"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatal("unprotected", path)
		}
	}
	cookie := loginActivity(t, h)
	for _, test := range []struct {
		path   string
		status int
	}{{"/api/1.0/activity/live", 200}, {"/api/1.0/activity/events?kind=invalid", 400}, {"/api/1.0/activity/events?cursor=not-a-cursor", 400}, {"/api/1.0/activity/stream?view=invalid", 400}} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", test.path, nil)
		r.AddCookie(cookie)
		h.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("%s = %d", test.path, w.Code)
		}
	}
}
func TestSSEDeadlinesReplayAndRevocation(t *testing.T) {
	h, _ := activityHandler(t)
	cookie := loginActivity(t, h)
	server := httptest.NewUnstartedServer(h)
	server.Config.WriteTimeout = 15 * time.Second
	server.Start()
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/1.0/activity/stream?view=timeline", nil)
	request.AddCookie(cookie)
	request.Header.Set("Last-Event-ID", "expired-generation:1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal("wrong content type")
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	foundReset, foundSnapshot := false, false
	heartbeats := 0
	for scanner.Scan() {
		line := scanner.Text()
		foundReset = foundReset || line == "event: reset"
		foundSnapshot = foundSnapshot || line == "event: snapshot"
		if line == ": heartbeat" {
			heartbeats++
		}
		if heartbeats == 2 {
			break
		}
	}
	if !foundReset || !foundSnapshot || heartbeats != 2 {
		t.Fatalf("stream failed past global deadline: reset=%v snapshot=%v beats=%d error=%v", foundReset, foundSnapshot, heartbeats, scanner.Err())
	}
	// Revocation is checked at the next heartbeat, even on an idle stream.
	logout := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/1.0/auth/logout", bytes.NewReader(nil))
	r.AddCookie(cookie)
	h.ServeHTTP(logout, r)
	foundExpired := false
	for scanner.Scan() {
		if scanner.Text() == "event: expired" {
			foundExpired = true
		}
	}
	if !foundExpired || scanner.Err() != nil {
		t.Fatal("idle stream failed to close on revocation", scanner.Err())
	}

	r = httptest.NewRequest("GET", "/api/1.0/activity/live", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("revocation ignored")
	}
}
