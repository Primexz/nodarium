package geoip

import (
	"bytes"
	"compress/gzip"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"
)

// Generate small, real MMDB files so the tests exercise the production decoder.
func cityDatabase(t *testing.T, city string) []byte {
	t.Helper()
	w, err := mmdbwriter.New(mmdbwriter.Options{DatabaseType: "DBIP-City-Lite", Languages: []string{"en"}})

	if err != nil {
		t.Fatal(err)
	}

	for address, location := range map[string]mmdbtype.Map{
		"1.1.1.1/32":               {"latitude": mmdbtype.Float64(50.1), "longitude": mmdbtype.Float64(8.6)},
		"8.8.8.8/32":               {"latitude": mmdbtype.Float64(0), "longitude": mmdbtype.Float64(0)},
		"2606:4700:4700::1111/128": {"latitude": mmdbtype.Float64(35), "longitude": mmdbtype.Float64(139)},
		"9.9.9.9/32":               {},
		"8.8.4.4/32":               {"latitude": mmdbtype.Float64(91), "longitude": mmdbtype.Float64(10)},
	} {
		_, network, err := net.ParseCIDR(address)

		if err != nil {
			t.Fatal(err)
		}

		err = w.Insert(network, mmdbtype.Map{
			"location": location,
			"city":     mmdbtype.Map{"names": mmdbtype.Map{"en": mmdbtype.String(city)}},
			"country": mmdbtype.Map{
				"iso_code": mmdbtype.String("DE"),
				"names":    mmdbtype.Map{"en": mmdbtype.String("Germany")},
			},
		})

		if err != nil {
			t.Fatal(err)
		}
	}

	var out bytes.Buffer

	if _, err := w.WriteTo(&out); err != nil {
		t.Fatal(err)
	}

	return out.Bytes()
}

func newTestService(t *testing.T, nodeIP string) *Service {
	t.Helper()
	path := CachePath(t.TempDir())

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(path, cityDatabase(t, "Frankfurt"), 0600); err != nil {
		t.Fatal(err)
	}

	s := New(Config{Path: path, NodeIP: nodeIP, NodeLabel: "Test node"}, nil)
	t.Cleanup(func() {
		s.Close()
	})

	return s
}

func TestCityLookupAndPeerMap(t *testing.T) {
	s := newTestService(t, "1.1.1.1")
	peers := []rpc.Peer{
		{ID: 1, Addr: "8.8.8.8:8333", Inbound: true},
		{ID: 2, Addr: "[2606:4700:4700::1111]:8333"},
		{ID: 3, Addr: "hidden.onion:8333"},
		{ID: 4, Addr: "192.168.1.2:8333"},
		{ID: 5, Addr: "9.9.9.9:8333"},
		{ID: 6, Addr: "8.8.4.4:8333"},
		{ID: 7, Addr: "1.0.0.1:8333"},
	}

	m := s.Map(peers, nil)

	if m.Status != "ready" ||
		m.Located != 2 ||
		m.Unlocated != 5 ||
		m.DatabaseDate == nil ||
		m.Attribution.Name != "DB-IP" {
		t.Fatalf("unexpected map: %+v", m)
	}

	if m.Node == nil ||
		m.Node.IP != "1.1.1.1" ||
		m.Node.Source != "configured_ip" ||
		m.Node.Label != "Test node" ||
		m.Node.City != "Frankfurt" {
		t.Fatalf("node: %+v", m.Node)
	}

	if m.Peers[0].Location.Latitude != 0 || m.Peers[0].Location.Longitude != 0 || !m.Peers[0].Inbound {
		t.Fatal("valid zero coordinates or direction lost")
	}

	if m.Peers[1].Location.Longitude != 139 {
		t.Fatal("IPv6 not resolved")
	}

	for i, reason := range []string{"non_ip", "private_or_reserved", "not_found", "not_found", "not_found"} {
		if m.Peers[i+2].Reason != reason || m.Peers[i+2].Location != nil {
			t.Fatalf("peer %d: %+v", i+2, m.Peers[i+2])
		}
	}

	if m := s.Map(nil, nil); m.Peers == nil || m.Located != 0 || m.Unlocated != 0 {
		t.Fatal("empty peers must serialize to []")
	}
}

func TestPublicAddresses(t *testing.T) {
	for _, address := range []string{
		"1.1.1.1:8333",
		"2606:4700:4700::1111",
		"[2606:4700:4700::1111]:8333",
		"[::ffff:8.8.8.8]:8333",
	} {
		if _, reason := publicAddress(address); reason != "" {
			t.Errorf("public %s: %s", address, reason)
		}
	}

	for _, address := range []string{
		"localhost:8333",
		"foo.onion:8333",
		"peer.b32.i2p",
		"10.0.0.1:8333",
		"127.0.0.1",
		"100.64.0.1",
		"192.0.2.1",
		"198.51.100.1",
		"203.0.113.2",
		"0.0.0.0",
		"255.255.255.255",
		"224.0.0.1",
		"[::1]:8333",
		"fc00::1",
		"fe80::1%eth0",
		"2001:db8::1",
		"::ffff:192.168.1.1",
	} {
		if _, reason := publicAddress(address); reason == "" {
			t.Errorf("nonpublic address accepted: %s", address)
		}
	}
}

func TestNodeSelection(t *testing.T) {
	addresses := []rpc.LocalAddress{
		{Address: "1.1.1.1", Score: 1},
		{Address: "2606:4700:4700::1111", Score: 2},
		{Address: "192.168.1.1", Score: 3},
	}

	s := newTestService(t, "")
	m := s.Map(nil, addresses)

	if m.Node == nil || m.Node.IP != addresses[1].Address || m.Node.Source != "advertised_ip" {
		t.Fatalf("fallback: %+v", m)
	}

	if addresses[0].Address != "1.1.1.1" {
		t.Fatal("mutated snapshot")
	}

	s.config.NodeIP = "192.168.1.1"
	m = s.Map(nil, addresses)

	if m.Node != nil || !strings.Contains(m.NodeMessage, "not a public IP") {
		t.Fatal("private configured IP must not be silently replaced")
	}

	s.config.NodeIP = "9.9.9.9"

	if m := s.Map(nil, addresses); m.Node != nil || m.NodeMessage == "" {
		t.Fatal("missing configured location not reported")
	}

	s.config.NodeIP = ""

	if m := s.Map(nil, nil); m.Node != nil || !strings.Contains(m.NodeMessage, "NODE_IP") {
		t.Fatal("missing advertised location not reported")
	}
}

func TestUnavailableDatabase(t *testing.T) {
	s := New(Config{Path: filepath.Join(t.TempDir(), "absent.mmdb"), NodeIP: "1.1.1.1"}, nil)
	m := s.Map([]rpc.Peer{{Addr: "8.8.8.8:8333"}}, nil)

	if m.Status != "unavailable" || m.Message == "" || m.Node != nil || m.Peers[0].Reason != "database_unavailable" {
		t.Fatal(m)
	}

	s.config.AutoDownload = true
	s.message = ""

	if s.Map(nil, nil).Status != "loading" {
		t.Fatal("initial download state")
	}

	s.message = "Download failed"

	if s.Map(nil, nil).Status != "unavailable" {
		t.Fatal("failed download must not show perpetual loading")
	}
}

func TestDownloadAtomicReplacement(t *testing.T) {
	s := newTestService(t, "1.1.1.1")
	var compressed bytes.Buffer

	gz := gzip.NewWriter(&compressed)

	if _, err := gz.Write(cityDatabase(t, "Updated city")); err != nil {
		t.Fatal(err)
	}

	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}

	good := append([]byte(nil), compressed.Bytes()...)
	var invalidDB bytes.Buffer

	invalidGzip := gzip.NewWriter(&invalidDB)
	_, _ = invalidGzip.Write([]byte("not a MaxMind database"))

	if err := invalidGzip.Close(); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name   string
		body   []byte
		status int
		valid  bool
	}{
		{"http error", nil, 503, false},
		{"bad gzip", []byte("invalid"), 200, false},
		{"invalid database", invalidDB.Bytes(), 200, false},
		{"truncated gzip", good[:len(good)-12], 200, false},
		{"valid update", good, 200, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before, err := os.ReadFile(s.config.Path)

			if err != nil {
				t.Fatal(err)
			}

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write(tc.body)
			}))

			defer server.Close()
			// API readers run concurrently with cache replacement (also checked by -race).
			var readers sync.WaitGroup

			readers.Go(func() {
				for range 50 {
					s.Map([]rpc.Peer{{Addr: "8.8.8.8:8333"}}, nil)
				}
			})

			err = s.download(context.Background(), server.URL)
			readers.Wait()

			if (err == nil) != tc.valid {
				t.Fatalf("download valid=%v: %v", tc.valid, err)
			}

			after, err := os.ReadFile(s.config.Path)

			if err != nil {
				t.Fatal(err)
			}

			if !tc.valid && !bytes.Equal(before, after) {
				t.Fatal("failed download changed cache")
			}

			want := "Frankfurt"

			if tc.valid {
				want = "Updated city"
			}

			if node := s.Map(nil, nil).Node; node == nil || node.City != want {
				t.Fatalf("wrong active database: %+v", node)
			}

			files, err := filepath.Glob(filepath.Join(filepath.Dir(s.config.Path), ".geoip-*"))

			if err != nil || len(files) != 0 {
				t.Fatal("temporary files leaked")
			}
		})
	}

	// The downloaded file remains usable after a process restart.
	reopened, err := openDatabase(s.config.Path)

	if err != nil {
		t.Fatal(err)
	}

	defer reopened.Close()

	loc, err := reopened.Lookup(netip.MustParseAddr("1.1.1.1"))

	if err != nil || loc == nil || loc.City != "Updated city" {
		t.Fatal(loc, err)
	}
}

func TestLocalDatabaseIntegration(t *testing.T) {
	path := os.Getenv("TEST_GEOIP_DB")

	if path == "" {
		t.Skip("set TEST_GEOIP_DB to verify a provider database")
	}

	db, err := openDatabase(path)

	if err != nil {
		t.Fatal(err)
	}

	defer db.Close()

	for _, address := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		location, err := db.Lookup(netip.MustParseAddr(address))

		if err != nil || location == nil || location.Country == "" {
			t.Fatalf("%s: %+v %v", address, location, err)
		}
	}
}
