package config

import (
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestConfig(t *testing.T) {
	for k, v := range map[string]string{
		"LOG_LEVEL":            "",
		"ADMIN_KEY":            "secret",
		"BITCOIN_RPC_URL":      "http://localhost:8332",
		"BITCOIN_RPC_USER":     "user",
		"BITCOIN_RPC_PASSWORD": "password",
		"DB_DRIVER":            "",
		"DB_DSN":               "",
		"DATA_DIR":             "/data",
		"POLL_INTERVAL":        "",
		"COOKIE_SECURE":        "",
		"NODE_IP":              "",
		"NODE_LOCATION_NAME":   "",
		"GEOIP_DB_PATH":        "",
		"GEOIP_AUTO_DOWNLOAD":  "",
	} {
		t.Setenv(k, v)
	}

	c, err := Load()

	if err != nil || c.LogLevel != zap.InfoLevel || c.DBDriver != "sqlite" || c.DBDSN != "/data/btc-monitor.db" {
		t.Fatal(c, err)
	}

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
