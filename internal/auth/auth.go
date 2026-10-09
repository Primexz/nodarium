package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const CookieName = "nodarium_session"

type attempt struct {
	count   int
	expires time.Time
}

type Manager struct {
	key      [32]byte
	secure   bool
	mu       sync.Mutex
	sessions map[[32]byte]time.Time
	attempts map[string]attempt
	global   attempt
	now      func() time.Time
}

func New(key string, secure bool) *Manager {
	return &Manager{
		key:      sha256.Sum256([]byte(key)),
		secure:   secure,
		sessions: map[[32]byte]time.Time{},
		attempts: map[string]attempt{},
		now:      time.Now,
	}
}

func reply(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (m *Manager) Valid(r *http.Request) bool {
	cookie, err := r.Cookie(CookieName)

	if err != nil || len(cookie.Value) != 64 {
		return false
	}

	key := sha256.Sum256([]byte(cookie.Value))
	m.mu.Lock()
	defer m.mu.Unlock()

	expiry, ok := m.sessions[key]

	if ok && !m.now().Before(expiry) {
		delete(m.sessions, key)

		return false
	}

	return ok
}

func (m *Manager) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.Valid(r) {
			reply(w, 401, "Authentication required")

			return
		}

		next.ServeHTTP(w, r)
	})
}

func (m *Manager) sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}

	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		scheme := "http"

		if m.secure || r.TLS != nil {
			scheme = "https"
		}

		if err != nil || u.Scheme != scheme || !strings.EqualFold(u.Host, r.Host) || u.User != nil || u.Path != "" {
			return false
		}
	}

	return true
}

func (m *Manager) allowed(ip string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := m.now()

	for k, v := range m.attempts {
		if !now.Before(v.expires) {
			delete(m.attempts, k)
		}
	}

	for k, v := range m.sessions {
		if !now.Before(v) {
			delete(m.sessions, k)
		}
	}

	if !now.Before(m.global.expires) {
		m.global = attempt{expires: now.Add(time.Minute)}
	}

	m.global.count++

	if m.global.count > 200 {
		return false
	}

	a, exists := m.attempts[ip]

	if !exists {
		if len(m.attempts) >= 4096 {
			return false
		}

		a = attempt{expires: now.Add(15 * time.Minute)}
	}

	a.count++
	m.attempts[ip] = a

	return a.count <= 10
}

func (m *Manager) Login(w http.ResponseWriter, r *http.Request) {
	if !m.sameOrigin(r) {
		reply(w, 403, "Cross-origin request rejected")

		return
	}

	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		reply(w, 415, "Expected application/json")

		return
	}

	ip, _, err := net.SplitHostPort(r.RemoteAddr)

	if err != nil {
		ip = r.RemoteAddr
	}

	if !m.allowed(ip) {
		w.Header().Set("Retry-After", "900")
		reply(w, 429, "Too many login attempts; try again later")

		return
	}

	var body struct {
		Key string `json:"key"`
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	if json.NewDecoder(r.Body).Decode(&body) != nil {
		reply(w, 400, "Invalid login request")

		return
	}

	hash := sha256.Sum256([]byte(body.Key))

	if subtle.ConstantTimeCompare(m.key[:], hash[:]) != 1 {
		reply(w, 401, "Invalid admin key")

		return
	}

	token := make([]byte, 32)

	if _, err := rand.Read(token); err != nil {
		reply(w, 500, "Cannot create session")

		return
	}

	value := hex.EncodeToString(token)
	m.mu.Lock()

	if len(m.sessions) >= 1024 {
		m.mu.Unlock()
		reply(w, 503, "Session capacity reached")

		return
	}

	m.sessions[sha256.Sum256([]byte(value))] = m.now().Add(12 * time.Hour)
	// Successful authentication resets only this caller's failure budget.
	delete(m.attempts, ip)
	m.mu.Unlock()
	http.SetCookie(
		w,
		&http.Cookie{
			Name:     CookieName,
			Value:    value,
			Path:     "/",
			HttpOnly: true,
			Secure:   m.secure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   43200,
		},
	)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"authenticated":true}`))
}

func (m *Manager) Logout(w http.ResponseWriter, r *http.Request) {
	if !m.sameOrigin(r) {
		reply(w, 403, "Cross-origin request rejected")

		return
	}

	if cookie, err := r.Cookie(CookieName); err == nil {
		m.mu.Lock()
		delete(m.sessions, sha256.Sum256([]byte(cookie.Value)))
		m.mu.Unlock()
	}

	http.SetCookie(
		w,
		&http.Cookie{
			Name:     CookieName,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			Secure:   m.secure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
		},
	)

	w.WriteHeader(204)
}
