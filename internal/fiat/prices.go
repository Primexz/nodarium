// Package fiat supplies optional display-only Bitcoin prices, independent of Core.
package fiat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

const (
	DefaultURL = "https://mempool.space/api/v1/prices"
	CacheTime  = time.Minute
	// Provider quotes are periodic snapshots, rather than live exchange ticks.
	StaleAfter = 2 * time.Hour
)

type Rates struct {
	Time int64   `json:"time"`
	USD  float64 `json:"USD"`
	EUR  float64 `json:"EUR"`
}

type Snapshot struct {
	Data      *Rates     `json:"data"`
	UpdatedAt *time.Time `json:"updated_at"`
	Stale     bool       `json:"stale"`
	Error     string     `json:"error,omitempty"`
	Source    string     `json:"source"`
}

// Service fetches only when a browser requests prices, never during node polling.
// The cache also bounds retries after upstream failures across all browser sessions.
type Service struct {
	mu          sync.Mutex
	client      *http.Client
	url         string
	now         func() time.Time
	nextAttempt time.Time
	snapshot    Snapshot
}

func New(endpoint string) *Service {
	return &Service{
		client:   &http.Client{Timeout: 5 * time.Second},
		url:      endpoint,
		now:      time.Now,
		snapshot: Snapshot{Source: "mempool.space"},
	}
}

func (s *Service) Snapshot(ctx context.Context) Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	if !now.Before(s.nextAttempt) {
		s.nextAttempt = now.Add(CacheTime)
		s.refresh(ctx, now)
	}
	result := s.snapshot
	result.Stale = result.Error != "" || result.UpdatedAt == nil || now.Sub(*result.UpdatedAt) > StaleAfter
	return result
}

func (s *Service) refresh(ctx context.Context, now time.Time) {
	s.snapshot.Error = "Fiat rates unavailable"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return
	}
	var rates Rates
	if err := json.NewDecoder(io.LimitReader(res.Body, 16<<10)).Decode(&rates); err != nil || rates.USD <= 0 || rates.EUR <= 0 || rates.Time <= 0 {
		return
	}
	at := time.Unix(rates.Time, 0).UTC()
	if at.After(now.Add(5*time.Minute)) || (s.snapshot.UpdatedAt != nil && at.Before(*s.snapshot.UpdatedAt)) {
		return
	}
	s.snapshot.Data = new(rates)
	s.snapshot.UpdatedAt = new(at)
	s.snapshot.Error = ""
}
