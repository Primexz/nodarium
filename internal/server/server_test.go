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
		"/api/v1/overview",
		"/api/v1/peers",
		"/api/v1/peer-map",
		"/api/v1/traffic",
		"/api/v1/mempool",
		"/api/v1/blocks",
		"/api/v1/mining",
		"/api/v1/fees",
		"/api/v1/mining/pools",
		"/api/v1/blocks/0000000000000000000000000000000000000000000000000000000000000001/transactions",
		"/api/v1/blocks/0000000000000000000000000000000000000000000000000000000000000001/transactions/0000000000000000000000000000000000000000000000000000000000000002",
		"/api/v1/history?metric=rx_rate&range=1h",
		"/api/v1/auth/session",
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
