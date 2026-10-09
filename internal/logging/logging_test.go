package logging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestParseLevel(t *testing.T) {
	for input, want := range map[string]zapcore.Level{
		"":       zap.InfoLevel,
		"info":   zap.InfoLevel,
		"DEBUG":  zap.DebugLevel,
		" warn ": zap.WarnLevel,
		"error":  zap.ErrorLevel,
	} {
		got, err := ParseLevel(input)

		if err != nil || got != want {
			t.Fatalf("%q: got %v, %v", input, got, err)
		}
	}

	for _, input := range []string{"trace", "fatal", "private-invalid-value"} {
		if _, err := ParseLevel(input); err == nil || strings.Contains(err.Error(), input) {
			t.Fatal("invalid level must be rejected without echoing its value")
		}
	}
}

func TestJSONOutputAndThresholds(t *testing.T) {
	// No parallel tests: replacing stderr exercises the actual production sink.
	for _, level := range []zapcore.Level{zap.DebugLevel, zap.InfoLevel, zap.WarnLevel, zap.ErrorLevel} {
		t.Run(level.String(), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "logs.jsonl")
			file, err := os.Create(path)

			if err != nil {
				t.Fatal(err)
			}

			original := os.Stderr
			os.Stderr = file
			defer func() {
				os.Stderr = original
				file.Close()
			}()

			logger, err := New(level)

			if err != nil {
				t.Fatal(err)
			}

			logger = Component(logger, "test")

			for _, severity := range []zapcore.Level{zap.DebugLevel, zap.InfoLevel, zap.WarnLevel, zap.ErrorLevel} {
				logger.Log(severity, "event", zap.Duration("duration", time.Second))
			}

			if err := logger.Sync(); err != nil {
				t.Fatal(err)
			}

			data, err := os.ReadFile(path)

			if err != nil {
				t.Fatal(err)
			}

			lines := strings.Split(strings.TrimSpace(string(data)), "\n")

			if len(lines) != int(zap.ErrorLevel-level)+1 {
				t.Fatalf("incorrect threshold: %s", data)
			}

			for _, line := range lines {
				var entry map[string]any

				if err := json.Unmarshal([]byte(line), &entry); err != nil {
					t.Fatal(err)
				}

				if entry["logger"] != "test" || entry["msg"] != "event" || entry["duration"] != float64(1) {
					t.Fatalf("missing context: %v", entry)
				}

				stamp, ok := entry["timestamp"].(string)

				if !ok || !strings.HasSuffix(stamp, "Z") {
					t.Fatal("timestamp must be UTC")
				}

				if _, err := time.Parse(time.RFC3339Nano, stamp); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestServerDiagnosticDoesNotExposeUnstructuredData(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	ServerErrorLog(zap.New(core)).Print("panic: password=secret Authorization: Bearer private-token")
	entries := logs.All()

	if len(entries) != 1 ||
		entries[0].Level != zap.ErrorLevel ||
		len(entries[0].Context) != 0 ||
		strings.Contains(entries[0].Message, "secret") ||
		strings.Contains(entries[0].Message, "private-token") {
		t.Fatal("unsafe server diagnostic")
	}
}
