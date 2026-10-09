package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Primexz/nodarium/internal/auth"
	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/config"
	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/geoip"
	"github.com/Primexz/nodarium/internal/logging"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/server"
	"github.com/Primexz/nodarium/internal/storage"
	"github.com/Primexz/nodarium/web"

	"go.uber.org/zap"
)

func main() {
	os.Exit(execute())
}

func execute() int {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 2 * time.Second}
		addr := os.Getenv("LISTEN_ADDR")

		if addr == "" {
			addr = ":8080"
		}

		if addr[0] == ':' {
			addr = "127.0.0.1" + addr
		}

		res, err := client.Get("http://" + addr + "/healthz")

		if err != nil {
			return 1
		}

		res.Body.Close()

		if res.StatusCode != 200 {
			return 1
		}

		return 0
	}

	// A bootstrap logger also makes configuration failures structured.
	logger, err := logging.New(zap.InfoLevel)

	if err != nil {
		return 1
	}

	defer func() {
		_ = logger.Sync()
	}()

	cfg, err := config.Load()

	if err != nil {
		logger.Error("Invalid configuration", zap.Error(err))

		return 1
	}

	configured, err := logging.New(cfg.LogLevel)

	if err != nil {
		logger.Error("Cannot initialize application logging")

		return 1
	}

	logger = configured

	if err := run(cfg, logger); err != nil {
		logger.Error("Nodarium stopped with an error", zap.Error(err))

		return 1
	}

	return 0
}

func run(cfg config.Config, logger *zap.Logger) error {
	startup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	db, err := storage.Open(startup, cfg.DBDriver, cfg.DBDSN)
	cancel()

	if err != nil {
		return err
	}

	defer func() {
		if err := db.Close(); err != nil {
			logger.Warn("Database close failed")
		}
	}()

	logger.Info("Database ready", zap.String("driver", cfg.DBDriver))
	listener, err := net.Listen("tcp", cfg.ListenAddr)

	if err != nil {
		return errors.New("HTTP listener failed; check LISTEN_ADDR and port availability")
	}

	defer listener.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	definitions, err := miningpool.Load()

	if err != nil {
		return err
	}

	client := rpc.New(cfg.RPCURL, cfg.RPCUser, cfg.RPCPassword, logger)
	col := collector.New(
		client,
		db,
		cfg.RPCURL,
		cfg.PollInterval,
		logger,
	)

	done := make(chan struct{})
	go func() {
		defer close(done)

		col.Run(ctx)
	}()

	geo := geoip.New(cfg.GeoIP, logger)
	geoDone := make(chan struct{})
	go func() {
		defer close(geoDone)

		geo.Run(ctx)
	}()

	defer geo.Close()

	pools := miningpool.NewService(ctx, client, definitions)
	defer pools.Close()

	app := server.New(
		auth.New(cfg.AdminKey, cfg.CookieSecure),
		col,
		db,
		web.Assets(),
		geo,
		explorer.New(client, definitions),
		pools,
		logger,
	)
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           app,
		ErrorLog:          logging.ServerErrorLog(logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	errs := make(chan error, 1)
	go func() {
		logger.Info(
			"Nodarium started",
			zap.String("listen", listener.Addr().String()),
			zap.String("database", cfg.DBDriver),
			zap.String("log_level", cfg.LogLevel.String()),
			zap.Duration("poll_interval", cfg.PollInterval),
		)

		errs <- srv.Serve(listener)
	}()

	select {
	case <-ctx.Done():
	case err = <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		} else if err != nil {
			err = errors.New("HTTP server failed")
		}
		stop()
	}

	logger.Info("Shutting down Nodarium")
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if shutdownErr := srv.Shutdown(shutdown); shutdownErr != nil {
		logger.Warn("Graceful HTTP shutdown timed out; closing active connections")
		_ = srv.Close()
	}

	<-done
	<-geoDone
	logger.Info("Nodarium stopped")

	return err
}
