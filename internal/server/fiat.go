package server

import (
	"context"
	"net/http"

	"github.com/Primexz/nodarium/internal/fiat"
)

type fiatPrices interface {
	Snapshot(context.Context) fiat.Snapshot
}

func registerFiat(api *http.ServeMux, prices fiatPrices) {
	api.HandleFunc("GET /api/1.0/fiat-rates", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		jsonResponse(w, http.StatusOK, prices.Snapshot(r.Context()))
	})
}
