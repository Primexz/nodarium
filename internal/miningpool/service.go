package miningpool

import (
	"context"
	"encoding/hex"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
)

type Share struct {
	Pool    *Pool   `json:"pool"`
	Blocks  int     `json:"blocks"`
	Percent float64 `json:"percent"`
}

type Distribution struct {
	Status    string     `json:"status"`
	Stale     bool       `json:"stale"`
	Window    int        `json:"window"`
	Target    int        `json:"target"`
	Scanned   int        `json:"scanned"`
	Height    int64      `json:"height"`
	Tip       string     `json:"tip"`
	UpdatedAt *time.Time `json:"updated_at"`
	Shares    []Share    `json:"shares"`
	Source    Source     `json:"definitions"`
}

type blockRecord struct {
	previous string
	height   int64
	pool     *Pool
}

// Service backfills only while requested. One background reader, bounded RPC
// calls and a 2,016-record cache keep mining inspection out of health polling.
type Service struct {
	client   rpc.Caller
	registry *Registry
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
	mu       sync.Mutex
	busy     bool
	views    map[int]Distribution
	attempts map[int]time.Time
	cache    map[string]blockRecord
	order    []string
}

func NewService(parent context.Context, client rpc.Caller, registry *Registry) *Service {
	ctx, cancel := context.WithCancel(parent)

	return &Service{
		client:   client,
		registry: registry,
		ctx:      ctx,
		cancel:   cancel,
		views:    make(map[int]Distribution),
		attempts: make(map[int]time.Time),
		cache:    make(map[string]blockRecord),
	}
}

func (s *Service) Close() {
	s.mu.Lock()
	s.cancel()
	s.mu.Unlock()
	s.wg.Wait()
}

// Snapshot anchors traversal to the collector's current active-chain tip. Cached
// records are reused by hash only; a reorg walks its own ancestry and counts anew.
func (s *Service) Snapshot(chain *rpc.Blockchain, stale bool, window int) Distribution {
	s.mu.Lock()
	defer s.mu.Unlock()

	view, exists := s.views[window]

	if !exists {
		view = Distribution{Status: "loading", Window: window, Shares: []Share{}, Source: s.registry.Source}
	}

	if chain == nil || stale || s.ctx.Err() != nil {
		view.Status, view.Stale = "unavailable", view.Scanned > 0

		return view
	}

	if chain.Chain != "main" {
		return Distribution{Status: "unsupported", Window: window, Shares: []Share{}, Source: s.registry.Source}
	}

	if chain.InitialBlockDownload || chain.Blocks < chain.Headers {
		return Distribution{Status: "syncing", Window: window, Shares: []Share{}, Source: s.registry.Source}
	}

	if (window != 144 && window != 1008) || !validID(chain.BestBlockHash) || chain.Blocks < 0 {
		view.Status, view.Stale = "unavailable", view.Scanned > 0

		return view
	}

	changed := view.Tip != chain.BestBlockHash

	if changed {
		view.Stale = view.Scanned > 0
	}

	if !s.busy && (changed || view.Status != "ready") && time.Since(s.attempts[window]) >= 10*time.Second {
		s.busy = true
		s.attempts[window] = time.Now()
		tip, height := chain.BestBlockHash, chain.Blocks
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()

			s.scan(tip, height, window)
		}()
	}

	return view
}

func validID(id string) bool {
	if len(id) != 64 {
		return false
	}

	_, err := hex.DecodeString(id)

	return err == nil
}

func (s *Service) read(hash string, height int64) (blockRecord, error) {
	if record, ok := s.cache[hash]; ok && record.height == height {
		return record, nil
	}

	ctx, cancel := context.WithTimeout(s.ctx, 8*time.Second)
	defer cancel()
	var block struct {
		Hash          string   `json:"hash"`
		Height        int64    `json:"height"`
		Confirmations int64    `json:"confirmations"`
		Previous      string   `json:"previousblockhash"`
		Transactions  []string `json:"tx"`
	}

	if err := s.client.Call(ctx, "getblock", []any{hash, 1}, &block); err != nil {
		return blockRecord{}, err
	}

	if block.Hash != hash ||
		block.Height != height ||
		block.Confirmations < 1 ||
		len(block.Transactions) == 0 ||
		!validID(block.Transactions[0]) ||
		(height > 0 &&
			!validID(block.Previous)) {
		return blockRecord{}, errors.New("block data unavailable")
	}

	var coinbase struct {
		TXID      string `json:"txid"`
		BlockHash string `json:"blockhash"`
		Inputs    []struct {
			Coinbase string `json:"coinbase"`
		} `json:"vin"`
		Outputs []struct {
			Script struct {
				Address string `json:"address"`
			} `json:"scriptPubKey"`
		} `json:"vout"`
	}

	if err := s.client.Call(ctx, "getrawtransaction", []any{block.Transactions[0], 1, hash}, &coinbase); err != nil {
		return blockRecord{}, err
	}

	if coinbase.TXID != block.Transactions[0] ||
		coinbase.BlockHash != hash ||
		len(coinbase.Inputs) != 1 ||
		len(coinbase.Outputs) == 0 {
		return blockRecord{}, errors.New("coinbase unavailable")
	}

	addresses := make([]string, 0, len(coinbase.Outputs))

	for _, output := range coinbase.Outputs {
		addresses = append(addresses, output.Script.Address)
	}

	match := s.registry.Identify("main", coinbase.Inputs[0].Coinbase, addresses)

	if match.Status == "unavailable" {
		return blockRecord{}, errors.New("coinbase unavailable")
	}

	record := blockRecord{previous: block.Previous, height: height, pool: match.Pool}

	if len(s.order) == 2016 {
		delete(s.cache, s.order[0])
		s.order = s.order[1:]
	}

	s.cache[hash] = record
	s.order = append(s.order, hash)

	return record, nil
}

func (s *Service) scan(tip string, height int64, window int) {
	view := Distribution{
		Status: "indexing",
		Window: window,
		Target: window,
		Height: height,
		Tip:    tip,
		Shares: []Share{},
		Source: s.registry.Source,
	}

	if height+1 < int64(window) {
		view.Target = int(height + 1)
	}

	counts := make(map[int]Share)
	status := "ready"
	hash := tip

	for i := 0; i < view.Target; i++ {
		if s.ctx.Err() != nil {
			status = "partial"
			break
		}

		record, err := s.read(hash, height-int64(i))

		if err != nil {
			status = "partial"
			break
		}

		id := 0

		if record.pool != nil {
			id = record.pool.ID
		}

		share := counts[id]
		share.Pool, share.Blocks = record.pool, share.Blocks+1
		counts[id] = share
		view.Scanned++
		hash = record.previous

		if view.Scanned%16 == 0 {
			s.publish(view, counts)
		}
	}

	view.Status = status

	if view.Scanned == 0 {
		view.Status = "unavailable"
	}

	s.publish(view, counts)
	s.mu.Lock()
	s.busy = false
	s.mu.Unlock()
}

func (s *Service) publish(view Distribution, counts map[int]Share) {
	view.Shares = make([]Share, 0, len(counts))

	for _, share := range counts {
		share.Percent = float64(share.Blocks) / float64(view.Scanned) * 100
		view.Shares = append(view.Shares, share)
	}

	sort.Slice(view.Shares, func(i, j int) bool {
		if view.Shares[i].Blocks != view.Shares[j].Blocks {
			return view.Shares[i].Blocks > view.Shares[j].Blocks
		}

		left, right := 0, 0

		if view.Shares[i].Pool != nil {
			left = view.Shares[i].Pool.ID
		}

		if view.Shares[j].Pool != nil {
			right = view.Shares[j].Pool.ID
		}

		return left < right
	})

	now := time.Now().UTC()
	view.UpdatedAt = &now
	s.mu.Lock()
	s.views[view.Window] = view
	s.mu.Unlock()
}
