package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Primexz/nodarium/internal/blockindex"
	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/miningpool"
)

func registerBlockHistory(api *http.ServeMux, index *blockindex.Service) {
	handle := func(pattern string, action func(context.Context, http.ResponseWriter, *http.Request)) {
		api.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if index == nil {
				explorerError(w, explorer.ErrUnavailable)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
			defer cancel()
			action(ctx, w, r)
		})
	}
	handle("GET /api/1.0/mining/pools/history", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		period := r.URL.Query().Get("range")
		if period == "" {
			period = "30d"
		}
		history, err := index.PoolTrends(ctx, period, time.Now().UTC())
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		jsonResponse(w, 200, history)
	})
	handle("GET /api/1.0/mining/pools/{id}", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			blockHistoryError(w, explorer.ErrInvalid)
			return
		}
		period := r.URL.Query().Get("range")
		if period == "" {
			period = "30d"
		}
		detail, err := index.PoolDetail(ctx, id, period, time.Now().UTC())
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		jsonResponse(w, 200, detail)
	})

	handle("GET /api/1.0/blocks/index", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		status, err := index.Status(ctx)
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		jsonResponse(w, 200, status)
	})
	handle("GET /api/1.0/blocks/history", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		limit := 50
		if value := r.URL.Query().Get("limit"); value != "" {
			var err error
			limit, err = strconv.Atoi(value)
			if err != nil {
				blockHistoryError(w, explorer.ErrInvalid)
				return
			}
		}
		var start *int64
		if value := r.URL.Query().Get("start_height"); value != "" {
			height, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				blockHistoryError(w, explorer.ErrInvalid)
				return
			}
			start = &height
		}
		page, err := index.History(ctx, r.URL.Query().Get("cursor"), start, limit)
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		jsonResponse(w, 200, page)
	})
	handle("GET /api/1.0/blocks/economics", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		period := r.URL.Query().Get("range")
		if period == "" {
			period = "recent"
		}
		history, err := index.Economics(ctx, period, time.Now().UTC())
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		jsonResponse(w, 200, history)
	})
	handle("GET /api/1.0/blocks/{hash}", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		block, pool, err := index.Block(ctx, r.PathValue("hash"))
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		status, err := index.Status(ctx)
		if err != nil {
			blockHistoryError(w, err)
			return
		}
		jsonResponse(w, 200, struct {
			collector.Block
			Pool      miningpool.Attribution `json:"pool"`
			Stale     bool                   `json:"stale"`
			UpdatedAt *time.Time             `json:"updated_at"`
		}{block, pool, status.Stale, status.UpdatedAt})
	})
}

func blockHistoryError(w http.ResponseWriter, err error) {
	if errors.Is(err, blockindex.ErrCursor) {
		jsonResponse(w, 409, map[string]string{"error": "Block history changed after a reorganization; reload this height"})
		return
	}
	if errors.Is(err, explorer.ErrInvalid) || errors.Is(err, explorer.ErrInactive) || errors.Is(err, explorer.ErrNotFound) {
		explorerError(w, err)
		return
	}
	explorerError(w, explorer.ErrUnavailable)
}
