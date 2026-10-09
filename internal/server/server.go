package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/geoip"
	"github.com/Primexz/nodarium/internal/logging"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"

	"go.uber.org/zap"
)

type HistoryStore interface {
	History(context.Context, string, string, string, time.Time) (storage.History, error)
}

type Snapshots interface {
	Snapshot() collector.Snapshot
}

type PeerMapper interface {
	Map([]rpc.Peer, []rpc.LocalAddress) geoip.MapData
}

type BlockExplorer interface {
	Block(context.Context, string) (explorer.Block, error)
	Transaction(context.Context, string, string) (explorer.Transaction, error)
}

type PoolDistributions interface {
	Snapshot(*rpc.Blockchain, bool, int) miningpool.Distribution
}

func New(
	a *auth.Manager,
	c Snapshots,
	db HistoryStore,
	assets fs.FS,
	mapper PeerMapper,
	blocks BlockExplorer,
	pools PoolDistributions,
	logger *zap.Logger,
) http.Handler {
	logger = logging.Component(logger, "http")
	mux := http.NewServeMux()
	mux.HandleFunc(
		"GET /healthz",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, map[string]string{"status": "ok"})
		},
	)

	mux.HandleFunc("POST /api/1.0/auth/login", a.Login)
	mux.HandleFunc("POST /api/1.0/auth/logout", a.Logout)
	mux.Handle("GET /api/1.0/auth/session", a.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]bool{"authenticated": true})
	})))

	api := http.NewServeMux()
	api.HandleFunc("GET /api/1.0/overview", func(w http.ResponseWriter, r *http.Request) {
		s := c.Snapshot()
		jsonResponse(
			w,
			200,
			map[string]any{
				"status":            s.Status,
				"checked_at":        s.CheckedAt,
				"persistence_error": s.PersistenceError,
				"overview":          s.Overview,
			},
		)
	})

	api.HandleFunc(
		"GET /api/1.0/peers",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, c.Snapshot().Peers)
		},
	)

	api.HandleFunc("GET /api/1.0/peer-map", func(w http.ResponseWriter, r *http.Request) {
		snapshot := c.Snapshot()
		peers := []rpc.Peer{}

		if snapshot.Peers.Data != nil {
			peers = *snapshot.Peers.Data
		}

		var addresses []rpc.LocalAddress

		if snapshot.Overview.Data != nil {
			addresses = snapshot.Overview.Data.Network.LocalAddresses
		}

		data := mapper.Map(peers, addresses)
		jsonResponse(
			w,
			200,
			collector.Section[geoip.MapData]{
				Data:      &data,
				UpdatedAt: snapshot.Peers.UpdatedAt,
				Error:     snapshot.Peers.Error,
				Stale:     snapshot.Peers.Stale,
			},
		)
	})

	api.HandleFunc(
		"GET /api/1.0/traffic",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, c.Snapshot().Traffic)
		},
	)

	api.HandleFunc(
		"GET /api/1.0/mempool",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, c.Snapshot().Mempool)
		},
	)

	api.HandleFunc(
		"GET /api/1.0/blocks",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, c.Snapshot().Blocks)
		},
	)

	api.HandleFunc(
		"GET /api/1.0/mining",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, c.Snapshot().Mining)
		},
	)

	api.HandleFunc(
		"GET /api/1.0/fees",
		func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, c.Snapshot().Fees)
		},
	)

	api.HandleFunc("GET /api/1.0/mining/pools", func(w http.ResponseWriter, r *http.Request) {
		window := 144

		if value := r.URL.Query().Get("blocks"); value != "" {
			var err error

			window, err = strconv.Atoi(value)

			if err != nil || (window != 144 && window != 1008) {
				jsonResponse(w, 400, map[string]string{"error": "Invalid pool block window"})

				return
			}
		}

		if pools == nil {
			jsonResponse(w, 503, map[string]string{"error": "Mining-pool data unavailable"})

			return
		}

		snapshot := c.Snapshot()
		var chain *rpc.Blockchain

		if snapshot.Overview.Data != nil {
			chain = &snapshot.Overview.Data.Blockchain
		}

		view := pools.Snapshot(chain, snapshot.Status != "connected" || snapshot.Overview.Stale, window)
		jsonResponse(w, 200, view)
	})

	api.HandleFunc("GET /api/1.0/blocks/{hash}/transactions", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()

		if blocks == nil {
			explorerError(w, explorer.ErrUnavailable)

			return
		}

		view, err := blocks.Block(ctx, r.PathValue("hash"))

		if err != nil {
			explorerError(w, err)

			return
		}

		jsonResponse(w, 200, view)
	})

	api.HandleFunc("GET /api/1.0/blocks/{hash}/transactions/{txid}", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()

		if blocks == nil {
			explorerError(w, explorer.ErrUnavailable)

			return
		}

		view, err := blocks.Transaction(ctx, r.PathValue("hash"), r.PathValue("txid"))

		if err != nil {
			explorerError(w, err)

			return
		}

		jsonResponse(w, 200, view)
	})

	api.HandleFunc("GET /api/1.0/history", func(w http.ResponseWriter, r *http.Request) {
		metric, period := r.URL.Query().Get("metric"), r.URL.Query().Get("range")

		if !storage.Metrics[metric] ||
			!map[string]bool{"1h": true, "24h": true, "7d": true, "30d": true, "1y": true}[period] {
			jsonResponse(w, 400, map[string]string{"error": "Invalid metric or range"})

			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		h, err := db.History(ctx, c.Snapshot().Node, metric, period, time.Now().UTC())

		if err != nil {
			jsonResponse(w, 503, map[string]string{"error": "History storage unavailable"})

			return
		}

		jsonResponse(w, 200, h)
	})

	mux.Handle("GET /api/", a.Require(api))
	files := http.FileServer(http.FS(assets))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			files.ServeHTTP(w, r)

			return
		}

		p := strings.TrimPrefix(r.URL.Path, "/")

		if _, err := fs.Stat(assets, p); err == nil {
			files.ServeHTTP(w, r)

			return
		}

		if strings.Contains(p, ".") {
			http.NotFound(w, r)

			return
		}

		index, err := fs.ReadFile(assets, "index.html")

		if err != nil {
			http.Error(w, "Frontend build unavailable", 503)

			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(index)
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		response := &loggedResponse{ResponseWriter: w}
		defer func() {
			logRequest(logger, r, response, started)
		}()

		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
		)

		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(response, r)
	})
}

func explorerError(w http.ResponseWriter, err error) {
	status := http.StatusServiceUnavailable
	public := explorer.ErrUnavailable

	for candidate, code := range map[error]int{
		explorer.ErrInvalid:  http.StatusBadRequest,
		explorer.ErrNotFound: http.StatusNotFound,
		explorer.ErrInactive: http.StatusConflict,
	} {
		if errors.Is(err, candidate) {
			status, public = code, candidate
			break
		}
	}

	jsonResponse(w, status, map[string]string{"error": public.Error()})
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
