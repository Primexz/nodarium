package collector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/Primexz/nodarium/internal/logging"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"

	"go.uber.org/zap"
)

type Section[T any] struct {
	Data      *T         `json:"data"`
	UpdatedAt *time.Time `json:"updated_at"`
	Error     string     `json:"error,omitempty"`
	Stale     bool       `json:"stale"`
}

type Overview struct {
	Blockchain rpc.Blockchain `json:"blockchain"`
	Network    rpc.Network    `json:"network"`
	Uptime     *int64         `json:"uptime"`
}

type Traffic struct {
	rpc.NetTotals
	ReceiveRate *float64 `json:"receive_rate"`
	SendRate    *float64 `json:"send_rate"`
}

// Block is the API view of a header with optional transaction statistics.
// Satoshi totals use strings to preserve precision in JavaScript clients.
type Block struct {
	rpc.Block
	TotalTransactionAmountSats *string  `json:"total_transaction_amount_sats"`
	TransactionCount           *int64   `json:"transaction_count"`
	TotalFeesSats              *string  `json:"total_fees_sats"`
	SizeBytes                  *int64   `json:"size_bytes"`
	WeightUnits                *int64   `json:"weight_units"`
	CapacityPercent            *float64 `json:"capacity_percent"`
	MedianFeeRate              *float64 `json:"median_fee_rate"`
	SubsidySats                *string  `json:"subsidy_sats"`
	AverageFeeRate             *float64 `json:"average_fee_rate"`
}

type Snapshot struct {
	Node             string               `json:"-"`
	Status           string               `json:"status"`
	CheckedAt        *time.Time           `json:"checked_at"`
	PersistenceError string               `json:"persistence_error,omitempty"`
	Overview         Section[Overview]    `json:"overview"`
	Peers            Section[[]rpc.Peer]  `json:"peers"`
	Traffic          Section[Traffic]     `json:"traffic"`
	Mempool          Section[rpc.Mempool] `json:"mempool"`
	Blocks           Section[[]Block]     `json:"blocks"`
	Mining           Section[Mining]      `json:"mining"`
	Fees             Section[Fees]        `json:"fees"`
}

type Store interface {
	Save(context.Context, string, time.Time, map[string]storage.Measurement) error
	Prune(context.Context, time.Time) error
}

type baseline struct {
	totals rpc.NetTotals
	uptime int64
	at     time.Time
	node   string
}

type Collector struct {
	logger    *zap.Logger
	rpc       rpc.Caller
	store     Store
	endpoint  string
	interval  time.Duration
	mu        sync.RWMutex
	snapshot  Snapshot
	previous  *baseline
	blockTip  string
	lastPrune time.Time
}

func New(client rpc.Caller, store Store, endpoint string, interval time.Duration, logger *zap.Logger) *Collector {
	return &Collector{
		logger:   logging.Component(logger, "collector"),
		rpc:      client,
		store:    store,
		endpoint: endpoint,
		interval: interval,
		snapshot: Snapshot{Status: "connecting"},
	}
}

func (c *Collector) Snapshot() Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	s := c.snapshot

	if s.CheckedAt != nil && time.Since(*s.CheckedAt) > 3*c.interval {
		s.Status = "disconnected"
		s.Overview.Stale = true
		s.Peers.Stale = true
		s.Traffic.Stale = true
		s.Mempool.Stale = true
		s.Blocks.Stale = true
		s.Mining.Stale = true
		s.Fees.Stale = true
	}

	return s
}

func (c *Collector) Run(ctx context.Context) {
	c.Collect(ctx)
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-ticker.C:
			c.Collect(ctx)
		}
	}
}

func refresh[T any](old Section[T], v *T, err error, now time.Time) Section[T] {
	if err != nil {
		old.Error = err.Error()
		old.Stale = true

		return old
	}

	return Section[T]{Data: v, UpdatedAt: &now}
}

func (c *Collector) Collect(ctx context.Context) {
	started := time.Now()
	defer func() {
		c.logger.Debug("Collection cycle completed", zap.Duration("duration", time.Since(started)))
	}()

	deadline := min(8*time.Second, c.interval*8/10)
	rpcCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()
	var chain rpc.Blockchain
	var network rpc.Network
	var peers []rpc.Peer
	var totals rpc.NetTotals
	var mempool rpc.Mempool
	var uptime int64

	methods := []string{
		"getblockchaininfo",
		"getnetworkinfo",
		"getpeerinfo",
		"getnettotals",
		"getmempoolinfo",
		"uptime",
	}

	outputs := []any{&chain, &network, &peers, &totals, &mempool, &uptime}
	errs := make([]error, len(methods))
	var wg sync.WaitGroup

	for i := range methods {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			errs[i] = c.rpc.Call(rpcCtx, methods[i], nil, outputs[i])
		}(i)
	}

	wg.Wait()
	now := time.Now().UTC()
	s := c.Snapshot()
	previousStatus, previousPersistenceError := s.Status, s.PersistenceError
	s.CheckedAt = &now

	if errs[0] == nil {
		key := sha256.Sum256([]byte(c.endpoint + "|" + chain.Chain))
		node := hex.EncodeToString(key[:])

		if s.Node != "" && s.Node != node {
			c.logger.Info("Node identity changed; starting a separate history partition")
			s = Snapshot{CheckedAt: &now}
			c.previous = nil
			c.blockTip = ""
		}

		s.Node = node
	}

	if peers == nil {
		peers = []rpc.Peer{}
	}

	overviewErr := errs[0]

	if overviewErr == nil {
		overviewErr = errs[1]
	}

	var up *int64

	if errs[5] == nil {
		up = &uptime
	}

	s.Overview = refresh(s.Overview, &Overview{Blockchain: chain, Network: network, Uptime: up}, overviewErr, now)
	s.Peers = refresh(s.Peers, &peers, errs[2], now)
	s.Mempool = refresh(s.Mempool, &mempool, errs[4], now)
	values := map[string]storage.Measurement{}
	add := func(k string, v float64) {
		values[k] = storage.Measurement{Value: v, Weight: c.interval.Seconds()}
	}

	if errs[0] == nil {
		add("height", float64(chain.Blocks))
		add("sync", chain.VerificationProgress*100)
	}

	if errs[1] == nil {
		add("peers", float64(network.Connections))
		add("peers_in", float64(network.ConnectionsIn))
		add("peers_out", float64(network.ConnectionsOut))
	}

	if errs[4] == nil {
		add("mempool_count", float64(mempool.Size))
		add("mempool_bytes", float64(mempool.Bytes))
		add("mempool_usage", float64(mempool.Usage))
		add("mempool_fee", mempool.MinFee*1e5)
	}

	traffic := Traffic{NetTotals: totals}

	if errs[3] == nil && errs[5] == nil && errs[0] == nil {
		b := baseline{totals: totals, uptime: uptime, at: now, node: s.Node}

		if p := c.previous; p != nil {
			elapsed := now.Sub(p.at).Seconds()

			if elapsed > 0 &&
				elapsed <= 2*c.interval.Seconds() &&
				p.node == b.node &&
				uptime >= p.uptime &&
				float64(uptime-p.uptime) >= elapsed-2 &&
				totals.Received >= p.totals.Received &&
				totals.Sent >= p.totals.Sent {
				rx, tx := float64(totals.Received-p.totals.Received), float64(totals.Sent-p.totals.Sent)
				r, t := rx/elapsed, tx/elapsed
				traffic.ReceiveRate = &r
				traffic.SendRate = &t
				values["rx_rate"] = storage.Measurement{Value: r, Weight: elapsed, Total: rx}
				values["tx_rate"] = storage.Measurement{Value: t, Weight: elapsed, Total: tx}
			}
		}

		c.previous = &b
	} else {
		c.previous = nil
	}

	s.Traffic = refresh(s.Traffic, &traffic, errs[3], now)

	if errs[0] == nil {
		if chain.BestBlockHash != c.blockTip || s.Blocks.Data == nil || s.Blocks.Stale {
			blocks := []Block{}
			hash := chain.BestBlockHash
			var blockErr error

			for i := 0; i < 10 && hash != ""; i++ {
				var b rpc.Block

				blockErr = c.rpc.Call(rpcCtx, "getblockheader", []any{hash, true}, &b)

				if blockErr != nil {
					break
				}

				b.Confirmations = chain.Blocks - b.Height + 1
				blocks = append(blocks, Block{Block: b})
				hash = b.Previous
			}

			if blockErr == nil {
				blocks = c.blockStatistics(rpcCtx, blocks, s.Blocks.Data)
			}

			s.Blocks = refresh(s.Blocks, &blocks, blockErr, now)

			if blockErr == nil {
				c.blockTip = chain.BestBlockHash
			}
		} else {
			// Retry missing statistics even when the chain tip has not changed.
			blocks := c.blockStatistics(rpcCtx, *s.Blocks.Data, s.Blocks.Data)
			s.Blocks.Data = &blocks
			s.Blocks.UpdatedAt = &now
			s.Blocks.Stale = false
		}
	} else {
		s.Blocks.Stale = true
		s.Blocks.Error = "blockchain data unavailable"
	}

	// Optional estimates run after core readings so a timeout cannot
	// consume the block collection's deadline or replace node-health data.
	var miningValues, feeValues map[string]storage.Measurement
	wg.Add(2)
	go func() {
		defer wg.Done()

		s.Mining, miningValues = c.collectMining(rpcCtx, chain, errs[0], s.Mining, now)
	}()
	go func() {
		defer wg.Done()

		s.Fees, feeValues = c.collectFees(rpcCtx, chain, errs[0], s.Fees, now)
	}()
	wg.Wait()

	for _, measurements := range []map[string]storage.Measurement{miningValues, feeValues} {
		for metric, value := range measurements {
			values[metric] = value
		}
	}

	success := 0

	for _, err := range errs {
		if err == nil {
			success++
		}
	}

	s.Status = "connected"

	if success == 0 {
		s.Status = "disconnected"
	} else if success < len(errs) || s.Blocks.Stale {
		s.Status = "partial"
	}

	if errs[5] != nil && s.Overview.Data != nil && overviewErr == nil {
		s.Overview.Error = "node uptime unavailable"
	}

	if ctx.Err() == nil && s.Status != previousStatus {
		fields := []zap.Field{
			zap.String("previous_status", previousStatus),
			zap.String("status", s.Status),
			zap.Int("rpc_succeeded", success),
			zap.Int("rpc_failed", len(errs)-success),
		}

		if s.Status == "connected" {
			c.logger.Info("Node connection status changed", fields...)
		} else {
			c.logger.Warn("Node connection status changed", fields...)
		}
	}

	c.logger.Debug(
		"Node snapshot collected",
		zap.String("status", s.Status),
		zap.Int("rpc_succeeded", success),
		zap.Int("rpc_failed", len(errs)-success),
		zap.Int("metrics", len(values)),
	)

	// Publish live readings before storage, so a database timeout never stalls the UI.
	c.mu.Lock()
	c.snapshot = s
	c.mu.Unlock()
	dbCtx, dbCancel := context.WithTimeout(ctx, 3*time.Second)
	defer dbCancel()
	var dbErr error

	attempted := false
	operation := "save"
	storageStarted := time.Now()

	if s.Node != "" && len(values) > 0 {
		attempted = true
		dbErr = c.store.Save(dbCtx, s.Node, now, values)
	}

	if dbErr == nil && now.Sub(c.lastPrune) >= time.Hour {
		attempted = true
		operation = "retention"
		dbErr = c.store.Prune(dbCtx, now)

		if dbErr == nil {
			c.lastPrune = now
			c.logger.Debug("History retention completed")
		}
	}

	if attempted {
		c.logger.Debug(
			"History persistence completed",
			zap.String("operation", operation),
			zap.Bool("success", dbErr == nil),
			zap.Duration("duration", time.Since(storageStarted)),
		)

		if ctx.Err() == nil {
			if dbErr != nil && previousPersistenceError == "" {
				c.logger.Warn(
					"History persistence unavailable; missed samples will remain gaps",
					zap.String("operation", operation),
				)
			}

			if dbErr == nil && previousPersistenceError != "" {
				c.logger.Info("History persistence recovered")
			}
		}
	}

	c.mu.Lock()

	if dbErr != nil {
		c.snapshot.PersistenceError = "History storage is unavailable. Live monitoring continues; missed samples will remain gaps."
	} else if attempted {
		c.snapshot.PersistenceError = ""
	}

	c.mu.Unlock()
}
