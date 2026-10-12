package fiat

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPricesCacheFailureRecoveryAndAge(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var calls int
	failed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.RawQuery != "" || r.Method != http.MethodGet {
			t.Error("price request should carry no node or transaction data")
		}
		if failed {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintf(w, `{"time":%d,"USD":100000,"EUR":90000}`, now.Unix())
	}))
	defer server.Close()
	s := New(server.URL)
	s.now = func() time.Time { return now }
	first := s.Snapshot(t.Context())
	if first.Data == nil || first.Data.EUR != 90000 || first.Stale || first.Error != "" {
		t.Fatalf("unexpected first reading: %+v", first)
	}
	for range 5 {
		s.Snapshot(t.Context())
	}
	if calls != 1 {
		t.Fatal("cache did not share the price request", calls)
	}
	now = now.Add(CacheTime)
	failed = true
	stale := s.Snapshot(t.Context())
	if stale.Data != first.Data || !stale.Stale || stale.Error != "Fiat rates unavailable" || !stale.UpdatedAt.Equal(*first.UpdatedAt) {
		t.Fatalf("last successful price was lost: %+v", stale)
	}
	s.Snapshot(t.Context())
	if calls != 2 {
		t.Fatal("failure retried without cache delay")
	}
	failed = false
	now = now.Add(CacheTime)
	fresh := s.Snapshot(t.Context())
	if fresh.Stale || fresh.Error != "" || !fresh.UpdatedAt.Equal(now) {
		t.Fatalf("price did not recover: %+v", fresh)
	}
	// A cached provider response can itself be too old, even after a successful fetch.
	s.snapshot.UpdatedAt = new(now.Add(-StaleAfter - time.Second))
	if !s.Snapshot(t.Context()).Stale {
		t.Fatal("old provider timestamp was presented as current")
	}
}

func TestPricesRejectInvalidReadings(t *testing.T) {
	for _, body := range []string{
		`{`, `{"time":1,"USD":0,"EUR":2}`, `{"time":1,"USD":2}`,
		`{"time":1,"USD":-1,"EUR":2}`, `{"time":999999999999,"USD":1,"EUR":2}`,
		`{"time":1,"USD":1e999,"EUR":2}`, `{"time":0,"USD":1,"EUR":2}`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
			defer server.Close()
			s := New(server.URL).Snapshot(t.Context())
			if s.Data != nil || !s.Stale || s.Error != "Fiat rates unavailable" {
				t.Fatalf("invalid response accepted: %+v", s)
			}
		})
	}
}

func TestConcurrentRequestsShareFetch(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprintf(w, `{"time":%d,"USD":100000,"EUR":90000}`, time.Now().Unix())
	}))
	defer server.Close()
	s := New(server.URL)
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			if s.Snapshot(t.Context()).Data == nil {
				t.Error("concurrent price request failed")
			}
		})
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("concurrent requests duplicated upstream fetches", calls.Load())
	}
}
