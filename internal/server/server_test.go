package server

import (
	"context"
	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/geoip"
	"github.com/Primexz/nodarium/internal/storage"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"
)

type mockSnapshot struct{}

func (mockSnapshot) Snapshot() collector.Snapshot {
	return collector.Snapshot{Status: "connecting"}
}

type mockHistory struct{}

func (mockHistory) History(context.Context, string, string, string, time.Time) (storage.History, error) {
	return storage.History{}, nil
}

func TestRoutesProtected(t *testing.T) {
	h := New(
		auth.New("secret", false),
		mockSnapshot{},
		mockHistory{},
		fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		geoip.New(geoip.Config{}, nil),
		nil,
		nil,
		nil,
	)

	for _, path := range []string{
		"/api/1.0/overview",
		"/api/1.0/peers",
		"/api/1.0/peer-map",
		"/api/1.0/traffic",
		"/api/1.0/mempool",
		"/api/1.0/blocks",
		"/api/1.0/mining",
		"/api/1.0/fees",
		"/api/1.0/mining/pools",
		"/api/1.0/blocks/0000000000000000000000000000000000000000000000000000000000000001/transactions",
		"/api/1.0/blocks/0000000000000000000000000000000000000000000000000000000000000001/transactions/0000000000000000000000000000000000000000000000000000000000000002",
		"/api/1.0/history?metric=rx_rate&range=1h",
		"/api/1.0/auth/session",
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))

		if w.Code != 401 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}

	for _, path := range []string{"/healthz", "/peers"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))

		if w.Code != 200 {
			t.Fatal(path, w.Code)
		}

		if w.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatal("missing security headers")
		}
	}
}
