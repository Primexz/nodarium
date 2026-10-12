package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/fiat"
)

type priceFixture struct{}

func (priceFixture) Snapshot(context.Context) fiat.Snapshot {
	return fiat.Snapshot{Data: &fiat.Rates{Time: 1, USD: 100000, EUR: 90000},
		UpdatedAt: new(time.Unix(1, 0)), Source: "mempool.space"}
}

func TestFiatRatesResponse(t *testing.T) {
	mux := http.NewServeMux()
	registerFiat(mux, priceFixture{})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/1.0/fiat-rates", nil))
	var snapshot fiat.Snapshot
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &snapshot) != nil || snapshot.Data == nil || snapshot.Data.EUR != 90000 || snapshot.Source != "mempool.space" {
		t.Fatal("price API did not preserve the quote", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("browser response should not cache stale prices")
	}
}
