package config

import (
	"errors"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/Primexz/nodarium/internal/geoip"
	"github.com/Primexz/nodarium/internal/logging"

	"go.uber.org/zap/zapcore"
)

type Config struct {
	LogLevel                               zapcore.Level
	GeoIP                                  geoip.Config
	AdminKey, RPCURL, RPCUser, RPCPassword string
	DBDriver, DBDSN, DataDir, ListenAddr   string
	PollInterval                           time.Duration
	CookieSecure                           bool
}

func Load() (Config, error) {
	c := Config{
		AdminKey:    os.Getenv("ADMIN_KEY"),
		RPCURL:      os.Getenv("BITCOIN_RPC_URL"),
		RPCUser:     os.Getenv("BITCOIN_RPC_USER"),
		RPCPassword: os.Getenv("BITCOIN_RPC_PASSWORD"),
		DBDriver:    env("DB_DRIVER", "sqlite"),
		DataDir:     env("DATA_DIR", "/data"),
		ListenAddr:  env("LISTEN_ADDR", ":8080"),
	}

	var err error

	c.LogLevel, err = logging.ParseLevel(os.Getenv("LOG_LEVEL"))

	if err != nil {
		return c, err
	}

	if c.AdminKey == "" || c.RPCUser == "" || c.RPCPassword == "" {
		return c, errors.New("ADMIN_KEY, BITCOIN_RPC_USER and BITCOIN_RPC_PASSWORD are required")
	}

	u, err := url.Parse(c.RPCURL)

	if err != nil ||
		u.Host == "" ||
		(u.Scheme != "http" &&
			u.Scheme != "https") ||
		u.User != nil ||
		u.RawQuery != "" ||
		u.Fragment != "" {
		return c, errors.New("BITCOIN_RPC_URL must be an HTTP(S) URL without credentials, query or fragment")
	}

	c.RPCURL = u.String()
	c.PollInterval, err = time.ParseDuration(env("POLL_INTERVAL", "10s"))

	if err != nil || c.PollInterval < 5*time.Second || c.PollInterval > 5*time.Minute {
		return c, errors.New("POLL_INTERVAL must be between 5s and 5m")
	}

	c.CookieSecure, err = strconv.ParseBool(env("COOKIE_SECURE", "false"))

	if err != nil {
		return c, errors.New("COOKIE_SECURE must be true or false")
	}

	c.GeoIP = geoip.Config{
		Path:      env("GEOIP_DB_PATH", geoip.CachePath(c.DataDir)),
		NodeIP:    os.Getenv("NODE_IP"),
		NodeLabel: env("NODE_LOCATION_NAME", "My node"),
	}

	if c.GeoIP.NodeIP != "" {
		if _, err := netip.ParseAddr(c.GeoIP.NodeIP); err != nil {
			return c, errors.New("NODE_IP must be an IPv4 or IPv6 address without a port")
		}
	}

	autoDefault := "true"

	if os.Getenv("GEOIP_DB_PATH") != "" {
		autoDefault = "false"
	}

	c.GeoIP.AutoDownload, err = strconv.ParseBool(env("GEOIP_AUTO_DOWNLOAD", autoDefault))

	if err != nil {
		return c, errors.New("GEOIP_AUTO_DOWNLOAD must be true or false")
	}

	c.DBDSN = os.Getenv("DB_DSN")

	switch c.DBDriver {
	case "sqlite":
		if c.DBDSN == "" {
			// Preserve the existing data filename when upgrading from BTC Monitor.
			c.DBDSN = filepath.Join(c.DataDir, "btc-monitor.db")
		}

	case "postgres":
		if c.DBDSN == "" {
			return c, errors.New("DB_DSN is required for postgres")
		}

	default:
		return c, errors.New("DB_DRIVER must be sqlite or postgres")
	}

	return c, nil
}

func env(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}

	return fallback
}
