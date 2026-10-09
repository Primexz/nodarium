// Package geoip resolves peer locations locally. Peer IPs never leave the server.
package geoip

import (
	"context"
	"errors"
	"math"
	"net"
	"net/netip"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Primexz/nodarium/internal/logging"
	"github.com/Primexz/nodarium/internal/rpc"

	"github.com/oschwald/maxminddb-golang/v2"
	"go.uber.org/zap"
)

type Config struct {
	Path, NodeIP, NodeLabel string
	AutoDownload            bool
}

type Location struct {
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	City        string  `json:"city"`
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
}

type Node struct {
	Location
	IP     string `json:"ip"`
	Label  string `json:"label"`
	Source string `json:"source"`
}

type Peer struct {
	ID       int64     `json:"id"`
	Address  string    `json:"address"`
	Inbound  bool      `json:"inbound"`
	Location *Location `json:"location"`
	Reason   string    `json:"reason,omitempty"`
}

type Attribution struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type MapData struct {
	Node         *Node       `json:"node"`
	NodeMessage  string      `json:"node_message,omitempty"`
	Peers        []Peer      `json:"peers"`
	Located      int         `json:"located"`
	Unlocated    int         `json:"unlocated"`
	Status       string      `json:"status"`
	Message      string      `json:"message,omitempty"`
	DatabaseDate *time.Time  `json:"database_date"`
	Attribution  Attribution `json:"attribution"`
}

type database interface {
	Lookup(netip.Addr) (*Location, error)
	Close() error
	BuiltAt() time.Time
	Attribution() Attribution
}

type mmdb struct {
	reader *maxminddb.Reader
}

func openDatabase(path string) (database, error) {
	r, err := maxminddb.Open(path)

	if err != nil {
		return nil, errors.New("cannot read GeoIP database")
	}

	if !strings.Contains(strings.ToLower(r.Metadata.DatabaseType), "city") {
		r.Close()

		return nil, errors.New("GeoIP database must contain city coordinates")
	}

	return &mmdb{reader: r}, nil
}

func (d *mmdb) Close() error {
	return d.reader.Close()
}

func (d *mmdb) BuiltAt() time.Time {
	return time.Unix(int64(d.reader.Metadata.BuildEpoch), 0).UTC()
}

func (d *mmdb) Attribution() Attribution {
	if strings.Contains(strings.ToLower(d.reader.Metadata.DatabaseType), "dbip") {
		return Attribution{Name: "DB-IP", URL: "https://db-ip.com"}
	}

	return Attribution{Name: "MaxMind", URL: "https://www.maxmind.com"}
}

func (d *mmdb) Lookup(ip netip.Addr) (*Location, error) {
	var record struct {
		City struct {
			Names map[string]string `maxminddb:"names"`
		} `maxminddb:"city"`
		Country struct {
			Names map[string]string `maxminddb:"names"`
			Code  string            `maxminddb:"iso_code"`
		} `maxminddb:"country"`
		Location struct {
			Latitude  *float64 `maxminddb:"latitude"`
			Longitude *float64 `maxminddb:"longitude"`
		} `maxminddb:"location"`
	}

	result := d.reader.Lookup(ip)

	if err := result.Err(); err != nil {
		return nil, err
	}

	if !result.Found() {
		return nil, nil
	}

	if err := result.Decode(&record); err != nil {
		return nil, err
	}

	lat, lon := record.Location.Latitude, record.Location.Longitude

	if lat == nil ||
		lon == nil ||
		math.IsNaN(*lat) ||
		math.IsNaN(*lon) ||
		math.Abs(*lat) > 90 ||
		math.Abs(*lon) > 180 {
		return nil, nil
	}

	return &Location{
		Latitude:    *lat,
		Longitude:   *lon,
		City:        record.City.Names["en"],
		Country:     record.Country.Names["en"],
		CountryCode: record.Country.Code,
	}, nil
}

type Service struct {
	logger      *zap.Logger
	config      Config
	mu          sync.RWMutex
	db          database
	message     string
	downloading bool
}

func New(c Config, logger *zap.Logger) *Service {
	s := &Service{config: c, logger: logging.Component(logger, "geoip")}

	if db, err := openDatabase(c.Path); err == nil {
		s.db = db
		s.logger.Debug("GeoIP database loaded", zap.Time("built_at", db.BuiltAt()))
	} else if !c.AutoDownload {
		s.logger.Warn("GeoIP database unavailable; configure GEOIP_DB_PATH or GEOIP_AUTO_DOWNLOAD")
		s.message = "No city GeoIP database is available. Configure GEOIP_DB_PATH or enable GEOIP_AUTO_DOWNLOAD."
	}

	return s
}

func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db != nil {
		return s.db.Close()
	}

	return nil
}

func (s *Service) Run(ctx context.Context) {
	if !s.config.AutoDownload {
		return
	}

	s.update(ctx)
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-ticker.C:
			s.update(ctx)
		}
	}
}

func (s *Service) update(ctx context.Context) {
	s.mu.RLock()
	now := time.Now().UTC()
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	hasCached := s.db != nil
	current := hasCached && s.db.BuiltAt().Format("2006-01") == month.Format("2006-01")
	s.mu.RUnlock()

	if current {
		return
	}

	s.mu.Lock()
	s.downloading = true
	s.mu.Unlock()
	s.logger.Info("Updating GeoIP database", zap.Bool("cached_database_available", hasCached))
	bounded, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	var err error

	months := []time.Time{month}

	if !hasCached {
		months = append(months, month.AddDate(0, -1, 0))
	}

	for _, month := range months {
		err = s.download(bounded, "https://download.db-ip.com/free/dbip-city-lite-"+month.Format("2006-01")+".mmdb.gz")

		if err == nil || bounded.Err() != nil {
			break
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.downloading = false

	if err != nil {
		if ctx.Err() == nil {
			s.logger.Warn(
				"GeoIP database update failed; will retry automatically",
				zap.Bool("cached_database_available", hasCached),
			)
		}

		s.message = "GeoIP download failed. Retrying automatically; you can also provide a city MMDB file with GEOIP_DB_PATH."
	} else {
		s.message = ""
		s.logger.Info("GeoIP database updated", zap.Time("built_at", s.db.BuiltAt()))
	}
}

func (s *Service) Map(peers []rpc.Peer, addresses []rpc.LocalAddress) MapData {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := MapData{
		Peers:       make([]Peer, 0, len(peers)),
		Status:      "unavailable",
		Message:     s.message,
		Attribution: Attribution{Name: "DB-IP", URL: "https://db-ip.com"},
	}

	if s.db != nil {
		result.Status = "ready"
		at := s.db.BuiltAt()
		result.DatabaseDate = &at
		result.Attribution = s.db.Attribution()
	} else if s.downloading || (s.config.AutoDownload && s.message == "") {
		result.Status = "loading"
	}

	if result.Status == "loading" && result.Message == "" {
		result.Message = "Preparing the local GeoIP database. Peer locations will appear automatically."
	}

	for _, p := range peers {
		entry := Peer{ID: p.ID, Address: p.Addr, Inbound: p.Inbound}
		ip, reason := publicAddress(p.Addr)

		if reason != "" {
			entry.Reason = reason
		} else if s.db == nil {
			entry.Reason = "database_unavailable"
		} else {
			loc, err := s.db.Lookup(ip)
			entry.Location = loc

			if err != nil {
				entry.Reason = "lookup_failed"
			} else if loc == nil {
				entry.Reason = "not_found"
			}
		}

		if entry.Location != nil {
			result.Located++
		} else {
			result.Unlocated++
		}

		result.Peers = append(result.Peers, entry)
	}

	if s.config.NodeIP != "" {
		ip, reason := publicAddress(s.config.NodeIP)

		if reason != "" {
			result.NodeMessage = "NODE_IP is not a public IP address. Set the public IPv4 or IPv6 address of your Bitcoin node."

			return result
		}

		if s.db != nil {
			if loc, err := s.db.Lookup(ip); err == nil && loc != nil {
				result.Node = &Node{Location: *loc, IP: ip.String(), Label: s.config.NodeLabel, Source: "configured_ip"}
			}
		}

		if result.Node == nil {
			result.NodeMessage = "The configured NODE_IP has no location in the available GeoIP data."

			if s.db == nil {
				result.NodeMessage = "NODE_IP is configured. Waiting for a local GeoIP database to locate it."
			}
		}

		return result
	}

	candidates := append([]rpc.LocalAddress(nil), addresses...)
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	if s.db != nil {
		for _, a := range candidates {
			ip, reason := publicAddress(a.Address)

			if reason != "" {
				continue
			}

			if loc, err := s.db.Lookup(ip); err == nil && loc != nil {
				result.Node = &Node{Location: *loc, IP: ip.String(), Label: s.config.NodeLabel, Source: "advertised_ip"}
				break
			}
		}
	}

	if result.Node == nil {
		result.NodeMessage = "Set NODE_IP to your node’s public IP address to draw connection lines. No advertised public address could be located."
	}

	return result
}

var reserved = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001:db8::/32"),
}

func publicAddress(address string) (netip.Addr, string) {
	host := address

	if h, _, err := net.SplitHostPort(address); err == nil {
		host = h
	}

	ip, err := netip.ParseAddr(host)

	if err != nil {
		return netip.Addr{}, "non_ip"
	}

	ip = ip.Unmap()

	if ip.Zone() != "" || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return ip, "private_or_reserved"
	}

	for _, p := range reserved {
		if p.Contains(ip) {
			return ip, "private_or_reserved"
		}
	}

	return ip, ""
}

// CachePath is separate from SQL storage: GeoIP files are never stored in the ORM.
func CachePath(dataDir string) string {
	return filepath.Join(dataDir, "geoip", "dbip-city-lite.mmdb")
}
