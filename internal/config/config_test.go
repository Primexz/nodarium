package config

import (
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

func TestConfig(t *testing.T) {
	for k, v := range map[string]string{
		"LOG_LEVEL":                "",
		"ADMIN_KEY":                "secret",
		"BITCOIN_RPC_URL":          "http://localhost:8332",
		"BITCOIN_RPC_USER":         "user",
		"BITCOIN_RPC_PASSWORD":     "password",
		"BITCOIN_ZMQ_SEQUENCE_URL": "",
		"DB_DRIVER":                "",
		"DB_DSN":                   "",
		"DATA_DIR":                 "/data",
		"POLL_INTERVAL":            "",
		"BLOCK_INDEX_DELAY":        "",
		"COOKIE_SECURE":            "",
		"NODE_IP":                  "",
		"NODE_LOCATION_NAME":       "",
		"GEOIP_DB_PATH":            "",
		"GEOIP_AUTO_DOWNLOAD":      "",
	} {
		t.Setenv(k, v)
	}

	for _, endpoint := range []string{"tcp://127.0.0.1:28332", "tcp://[::1]:28332", ""} {
		t.Setenv("BITCOIN_ZMQ_SEQUENCE_URL", endpoint)
		if _, err := Load(); err != nil {
			t.Fatal("valid ZMQ endpoint rejected", err)
		}
	}
	for _, endpoint := range []string{"http://node:28332", "tcp://node", "tcp://user:secret@node:28332", "tcp://node:0", "tcp://node:65536", "tcp://node:28332/path"} {
		t.Setenv("BITCOIN_ZMQ_SEQUENCE_URL", endpoint)
		if _, err := Load(); err == nil {
			t.Fatal("invalid ZMQ endpoint accepted", endpoint)
		}
	}
	t.Setenv("BITCOIN_ZMQ_SEQUENCE_URL", "")

	c, err := Load()

	if err != nil || c.LogLevel != zap.InfoLevel || c.DBDriver != "sqlite" || c.DBDSN != "/data/btc-monitor.db" {
		t.Fatal(c, err)
	}

	if c.BlockIndexDelay != 0 {
		t.Fatal("indexing should have no artificial delay by default")
	}

	for _, delay := range []string{"0s", "25ms", "100ms", "5s"} {
		t.Setenv("BLOCK_INDEX_DELAY", delay)

		want, _ := time.ParseDuration(delay)
		if loaded, err := Load(); err != nil || loaded.BlockIndexDelay != want {
			t.Fatal("valid indexing delay rejected", err)
		}
	}

	for _, delay := range []string{"-1ms", "6s", "invalid"} {
		t.Setenv("BLOCK_INDEX_DELAY", delay)

		if _, err := Load(); err == nil {
			t.Fatal("invalid indexing delay accepted")
		}
	}

	t.Setenv("BLOCK_INDEX_DELAY", "")

	for _, level := range []string{"debug", "INFO", "warn", "error"} {
		t.Setenv("LOG_LEVEL", level)

		if c, err := Load(); err != nil || c.LogLevel.String() != strings.ToLower(level) {
			t.Fatal("invalid log level parsing", err)
		}
	}

	t.Setenv("LOG_LEVEL", "private-invalid-value")

	if _, err := Load(); err == nil || strings.Contains(err.Error(), "private-invalid-value") {
		t.Fatal("invalid log level must fail safely")
	}

	t.Setenv("LOG_LEVEL", "")

	if c.GeoIP.Path != "/data/geoip/dbip-city-lite.mmdb" || !c.GeoIP.AutoDownload || c.GeoIP.NodeIP != "" {
		t.Fatal("unexpected GeoIP defaults")
	}

	for _, ip := range []string{"1.1.1.1", "2606:4700:4700::1111", "192.168.1.1", ""} {
		t.Setenv("NODE_IP", ip)

		if _, err := Load(); err != nil {
			t.Fatal(err)
		}
	}

	for _, ip := range []string{"example.com", "http://1.1.1.1", "1.1.1.1:8333", "[::1]:8333"} {
		t.Setenv("NODE_IP", ip)

		if _, err := Load(); err == nil {
			t.Fatal("invalid NODE_IP accepted")
		}
	}

	t.Setenv("NODE_IP", "")
	t.Setenv("GEOIP_DB_PATH", "/geoip/custom.mmdb")

	if c, err := Load(); err != nil || c.GeoIP.AutoDownload || c.GeoIP.Path != "/geoip/custom.mmdb" {
		t.Fatal("custom GeoIP path should disable auto download")
	}

	t.Setenv("GEOIP_AUTO_DOWNLOAD", "true")

	if c, err := Load(); err != nil || !c.GeoIP.AutoDownload {
		t.Fatal("explicit auto download ignored")
	}

	t.Setenv("GEOIP_AUTO_DOWNLOAD", "typo")

	if _, err := Load(); err == nil {
		t.Fatal("invalid GeoIP boolean accepted")
	}

	t.Setenv("GEOIP_AUTO_DOWNLOAD", "")
	t.Setenv("DB_DRIVER", "postgres")

	if _, err := Load(); err == nil {
		t.Fatal("postgres requires DSN")
	}

	t.Setenv("DB_DSN", "postgres://user:secret@localhost/db")

	if _, err := Load(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("BITCOIN_RPC_URL", "http://user:secret@localhost:8332")
	_, err = Load()

	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatal("credential URL not rejected safely")
	}
}
