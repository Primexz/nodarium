package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func login(m *Manager, key, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(
		"POST",
		"http://dashboard.test/api/v1/auth/login",
		strings.NewReader(`{"key":"`+key+`"}`),
	)

	r.Header.Set("Content-Type", "application/json")

	if origin != "" {
		r.Header.Set("Origin", origin)
	}

	w := httptest.NewRecorder()
	m.Login(w, r)

	return w
}

func TestSessionLifecycle(t *testing.T) {
	m := New("private-admin-key", false)
	now := time.Now()
	m.now = func() time.Time {
		return now
	}

	if w := login(m, "wrong", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}

	w := login(m, "private-admin-key", "http://dashboard.test")

	if w.Code != 200 {
		t.Fatal(w.Code)
	}

	cookies := w.Result().Cookies()

	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe cookie")
	}

	r := httptest.NewRequest("GET", "http://dashboard.test/api/v1/overview", nil)
	r.AddCookie(cookies[0])

	if !m.Valid(r) {
		t.Fatal("session not valid")
	}

	now = now.Add(12 * time.Hour)

	if m.Valid(r) {
		t.Fatal("session not expired")
	}

	w = login(m, "private-admin-key", "")
	r = httptest.NewRequest("POST", "http://dashboard.test/api/v1/auth/logout", nil)
	r.AddCookie(w.Result().Cookies()[0])
	out := httptest.NewRecorder()
	m.Logout(out, r)

	if out.Code != 204 || m.Valid(r) {
		t.Fatal("logout failed")
	}
}

func TestCSRFAndRateLimit(t *testing.T) {
	m := New("secret", false)

	if w := login(m, "secret", "https://evil.test"); w.Code != 403 {
		t.Fatal("cross-origin accepted")
	}

	for i := 0; i < 10; i++ {
		if w := login(m, "wrong", ""); w.Code != 401 {
			t.Fatal(w.Code)
		}
	}

	if w := login(m, "secret", ""); w.Code != 429 {
		t.Fatal("login not throttled")
	}
}

func TestProtectionAndSecureCookie(t *testing.T) {
	m := New("secret", true)
	handler := m.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}))

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))

	if w.Code != 401 {
		t.Fatal("unprotected")
	}

	w = login(m, "secret", "https://dashboard.test")

	if w.Code != 200 || !w.Result().Cookies()[0].Secure {
		t.Fatal("secure cookie missing")
	}

	r := httptest.NewRequest("POST", "http://dashboard.test/api/v1/auth/logout", nil)
	r.AddCookie(w.Result().Cookies()[0])
	r.Header.Set("Origin", "https://attacker.test")
	out := httptest.NewRecorder()
	m.Logout(out, r)

	if out.Code != 403 || !m.Valid(r) {
		t.Fatal("cross-origin logout accepted")
	}
}
