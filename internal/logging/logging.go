// Package logging configures structured application logs. Callers must use
// curated fields: never log credentials, DSNs, request bodies, or raw driver errors.
package logging

import (
	"errors"
	"log"
	"strings"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func ParseLevel(value string) (zapcore.Level, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "info":
		return zap.InfoLevel, nil

	case "debug":
		return zap.DebugLevel, nil

	case "warn":
		return zap.WarnLevel, nil

	case "error":
		return zap.ErrorLevel, nil

	default:
		return zap.InfoLevel, errors.New("LOG_LEVEL must be debug, info, warn, or error")
	}
}

func New(level zapcore.Level) (*zap.Logger, error) {
	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(level)
	cfg.EncoderConfig.TimeKey = "timestamp"
	cfg.EncoderConfig.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
		enc.AppendString(t.UTC().Format(time.RFC3339Nano))
	}

	// Debug is intended for complete diagnostics, without repeated-event sampling.
	if level == zap.DebugLevel {
		cfg.Sampling = nil
	}

	return cfg.Build()
}

// Component gives tests and callers without a logger a quiet default.
func Component(logger *zap.Logger, name string) *zap.Logger {
	if logger == nil {
		return zap.NewNop()
	}

	return logger.Named(name)
}

// ServerErrorLog routes net/http diagnostics through Zap without copying its
// unstructured text, which may contain request data or arbitrary panic values.
func ServerErrorLog(logger *zap.Logger) *log.Logger {
	return log.New(serverErrorWriter{Component(logger, "http")}, "", 0)
}

type serverErrorWriter struct {
	logger *zap.Logger
}

func (w serverErrorWriter) Write(data []byte) (int, error) {
	w.logger.Error("HTTP server diagnostic; unstructured details omitted to protect request data")

	return len(data), nil
}
