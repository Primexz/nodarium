// Package blockindex owns persistent, local-Core block indexing. A single
// background reader serves browsing, economics and pool attribution together.
package blockindex

import (
	"cmp"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"maps"
	"math"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/logging"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
	"go.uber.org/zap"
)

const batchSize = 16

type Options struct {
	PollInterval time.Duration
	BlockDelay   time.Duration
}

var ErrCursor = errors.New("block history cursor expired after a reorganization")

type Status struct {
	Status  string `json:"status"`
	Network string `json:"network"`
	Tip     string `json:"tip"`
	Height  int64  `json:"height"`
	Target  int64  `json:"target"`
	storage.BlockCoverage
	UpdatedAt *time.Time `json:"updated_at"`
	Stale     bool       `json:"stale"`
	Error     string     `json:"error,omitempty"`
}

type Service struct {
	client    rpc.Caller
	db        *storage.Store
	registry  *miningpool.Registry
	logger    *zap.Logger
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	wake      chan struct{}
	mu        sync.RWMutex
	chain     *rpc.Blockchain
	observed  time.Time
	network   string
	lastError string
	// Worker-owned state. Backfill never creates an unbounded queue in memory.
	state        storage.BlockIndexState
	retryAt      time.Time
	pollInterval time.Duration
	batchDelay   time.Duration
	backoff      time.Duration
	progress     progressLog
}

func New(parent context.Context, client rpc.Caller, db *storage.Store, registry *miningpool.Registry, logger *zap.Logger, options ...Options) *Service {
	ctx, cancel := context.WithCancel(parent)
	s := &Service{client: client, db: db, registry: registry, logger: logging.Component(logger, "block-index"), ctx: ctx, cancel: cancel, done: make(chan struct{}), wake: make(chan struct{}, 1)}
	if len(options) > 0 {
		s.pollInterval = options[0].PollInterval
		s.batchDelay = max(0, options[0].BlockDelay)
	}
	startup, stop := context.WithTimeout(ctx, 3*time.Second)
	state, err := db.LastBlockState(startup)
	stop()
	if err == nil && state.Network != "" {
		s.state, s.network = state, state.Network
		s.chain = &rpc.Blockchain{Chain: state.Chain, Blocks: state.TipHeight, Headers: state.TipHeight, BestBlockHash: state.TipHash}
	}
	go s.run()
	return s
}

func (s *Service) Close() { s.cancel(); <-s.done }

// Observe is non-blocking and runs in the collector after the core health RPCs.
func (s *Service) Observe(chain *rpc.Blockchain) {
	s.mu.Lock()
	if s.chain != nil && s.chain.Chain != chain.Chain {
		s.network = ""
	}
	s.chain, s.observed = new(*chain), time.Now()
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Service) current() (*rpc.Blockchain, string, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.chain == nil {
		return nil, s.network, s.observed
	}
	return new(*s.chain), s.network, s.observed
}

func (s *Service) stale(observed time.Time) bool {
	return time.Since(observed) > max(30*time.Second, 3*s.pollInterval)
}

func validHash(hash string) bool {
	if len(hash) != 64 {
		return false
	}
	_, err := hex.DecodeString(hash)
	return err == nil
}

func (s *Service) run() {
	defer close(s.done)
	delay := time.Duration(0)
	for s.ctx.Err() == nil {
		timer := time.NewTimer(delay)
		select {
		case <-s.ctx.Done():
			timer.Stop()
			return
		case <-s.wake:
			timer.Stop()
		case <-timer.C:
		}
		chain, network, observed := s.current()
		if chain == nil || s.stale(observed) || !validHash(chain.BestBlockHash) {
			delay = time.Second
			continue
		}
		ctx, cancel := context.WithTimeout(s.ctx, 45*time.Second)
		var err error
		if network == "" || s.state.Chain != chain.Chain {
			var genesis string
			err = s.client.Call(ctx, "getblockhash", []any{int64(0)}, &genesis)
			if err == nil && !validHash(genesis) {
				err = errors.New("invalid genesis hash")
			}
			if err == nil {
				s.state, err = s.db.BlockState(ctx, genesis)
				if err == nil {
					s.state.Chain = chain.Chain
					s.mu.Lock()
					s.network = genesis
					s.mu.Unlock()
				}
			}
		}
		if err == nil && (chain.InitialBlockDownload || chain.Blocks < chain.Headers) {
			cancel()
			delay = time.Second
			continue
		}
		if err == nil {
			s.logProgress(*chain, time.Now())
			err = s.step(ctx, *chain)
			if err == nil {
				s.logProgress(*chain, time.Now())
			}
		}
		cancel()
		s.mu.Lock()
		if err != nil && s.ctx.Err() == nil {
			s.lastError = "Block indexing paused; retrying local node or database"
			s.logger.Debug("Block index batch failed", zap.Error(err))
		} else {
			s.lastError = ""
		}
		s.mu.Unlock()
		if err != nil {
			if s.backoff == 0 {
				s.backoff = 30 * time.Second
			} else {
				s.backoff = min(5*time.Minute, 2*s.backoff)
			}
			if s.ctx.Err() == nil {
				s.logger.Warn("Block indexing paused; retrying local node or database", zap.Duration("retry_in", s.backoff))
			}
			// Collector observations must not bypass failure backoff.
			timer := time.NewTimer(s.backoff)
			select {
			case <-s.ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			delay = 0
		} else {
			s.backoff = 0
			delay = time.Second
			// Keep backfilling without a mandatory pause between bounded batches.
			// Idle workers still sleep, and observations interrupt that sleep.
			if s.state.NextHash != "" || s.state.HeadHash != "" {
				delay = 0
			}
		}
	}
}

// step reconciles a tip before resuming backwards. A reorg finds a common
// indexed ancestor without assuming an arbitrary maximum reorganization depth.
func (s *Service) step(ctx context.Context, chain rpc.Blockchain) error {
	if s.state.TipHash != chain.BestBlockHash {
		fork := min(s.state.TipHeight, chain.Blocks)
		for fork >= 0 {
			stored, err := s.db.CanonicalHash(ctx, s.state.Network, fork)
			if err != nil {
				return err
			}
			if stored == "" {
				fork = -1
				break
			}
			var active string
			if err := s.client.Call(ctx, "getblockhash", []any{fork}, &active); err != nil {
				return err
			}
			if active == stored {
				break
			}
			fork--
		}
		state := s.state
		state.TipHash, state.TipHeight = chain.BestBlockHash, chain.Blocks
		state.HeadHash, state.HeadHeight = chain.BestBlockHash, chain.Blocks
		// If a reorg crosses the historical frontier, that cursor belongs to
		// the disconnected ancestry too. Start from the new tip instead.
		if fork < state.NextHeight+1 {
			state.NextHash, state.NextHeight = "", -1
		}
		if err := s.db.CommitBlockIndex(ctx, state, nil, &fork); err != nil {
			return err
		}
		var err error
		s.state, err = s.db.BlockState(ctx, state.Network)
		if err != nil {
			return err
		}
	}

	if s.state.HeadHash == "" {
		if err := s.reattribute(ctx); err != nil {
			return err
		}
		if s.state.NextHeight < chain.Blocks-1008 && time.Now().After(s.retryAt) {
			if err := s.retry(ctx, chain); err != nil {
				return err
			}
		}
	}
	state := s.state
	fromHead := state.HeadHash != ""
	startHash, startHeight := state.NextHash, state.NextHeight
	if fromHead {
		startHash, startHeight = state.HeadHash, state.HeadHeight
	}
	if startHash == "" || startHeight < 0 {
		return s.retry(ctx, chain)
	}
	blocks := make([]storage.IndexedBlock, 0, batchSize)
	joined := false
	for len(blocks) < batchSize && startHeight >= 0 {
		latest, _, _ := s.current()
		if latest == nil || latest.BestBlockHash != chain.BestBlockHash || latest.InitialBlockDownload {
			break
		}
		if !validHash(startHash) {
			return errors.New("invalid historical ancestry")
		}
		stored, err := s.db.CanonicalHash(ctx, state.Network, startHeight)
		if err != nil {
			return err
		}
		if stored == startHash {
			joined = true
			break
		}
		if deadline, ok := ctx.Deadline(); ok && len(blocks) > 0 && time.Until(deadline) < 30*time.Second {
			break
		}
		block, err := s.read(ctx, chain, startHash, startHeight)
		if err != nil {
			return err
		}
		blocks = append(blocks, block)
		startHash, startHeight = block.Previous, block.Height-1
		if err := pause(ctx, s.batchDelay); err != nil {
			return err
		}
	}
	if fromHead {
		if joined {
			state.HeadHash, state.HeadHeight = "", -1
		} else if state.NextHash == "" || startHeight <= state.NextHeight {
			state.NextHash, state.NextHeight = startHash, startHeight
			state.HeadHash, state.HeadHeight = "", -1
		} else {
			state.HeadHash, state.HeadHeight = startHash, startHeight
		}
	} else {
		state.NextHash, state.NextHeight = startHash, startHeight
	}
	if startHeight < 0 {
		state.NextHash, state.NextHeight = "", -1
	}
	var active string
	if err := s.client.Call(ctx, "getblockhash", []any{chain.Blocks}, &active); err != nil {
		return err
	}
	if active != chain.BestBlockHash {
		return errors.New("chain changed during indexing")
	}
	if err := s.db.CommitBlockIndex(ctx, state, blocks, nil); err != nil {
		return err
	}
	var err error
	s.state, err = s.db.BlockState(ctx, state.Network)
	return err
}

func pause(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return ctx.Err()
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) retry(ctx context.Context, chain rpc.Blockchain) error {
	if time.Now().Before(s.retryAt) {
		return nil
	}
	s.retryAt = time.Now().Add(30 * time.Second)
	block, err := s.db.NextBlockRetry(ctx, s.state.Network, time.Now())
	if err != nil || block == nil {
		return err
	}
	if block.CoinbaseHex != "" && block.DefinitionsRevision != s.registry.Source.SHA256 {
		s.attribute(block, chain.Chain)
	} else {
		updated, err := s.read(ctx, chain, block.Hash, block.Height)
		if err != nil {
			return err
		}
		block = &updated
	}
	if err := s.db.CommitBlockIndex(ctx, s.state, []storage.IndexedBlock{*block}, nil); err != nil {
		return err
	}
	s.state, err = s.db.BlockState(ctx, s.state.Network)
	return err
}

// Reclassification walks compact stored evidence once per definitions revision,
// in bounded pages. Pruned blocks need no new Core reads.
func (s *Service) reattribute(ctx context.Context) error {
	state := s.state
	if state.DefinitionsRevision != s.registry.Source.SHA256 {
		state.DefinitionsRevision = s.registry.Source.SHA256
		state.AttributionHeight = state.TipHeight
	}
	if state.AttributionHeight < 0 {
		return nil
	}
	rows, err := s.db.BlockPage(ctx, state.Network, state.AttributionHeight, false, 128)
	if err != nil {
		return err
	}
	updates := []storage.IndexedBlock{}
	for _, row := range rows {
		if row.CoinbaseHex != "" && row.DefinitionsRevision != s.registry.Source.SHA256 {
			s.attribute(&row, state.Chain)
			updates = append(updates, row)
		}
	}
	state.AttributionHeight = -1
	if len(rows) > 0 {
		state.AttributionHeight = rows[len(rows)-1].Height - 1
	}
	if err := s.db.CommitBlockIndex(ctx, state, updates, nil); err != nil {
		return err
	}
	s.state, err = s.db.BlockState(ctx, state.Network)
	return err
}

func (s *Service) attribute(block *storage.IndexedBlock, chain string) {
	var addresses []string
	_ = json.Unmarshal([]byte(block.CoinbaseAddresses), &addresses)
	match := s.registry.Identify(chain, block.CoinbaseHex, addresses)
	block.PoolStatus, block.PoolMethod = match.Status, match.Method
	block.DefinitionsRevision = s.registry.Source.SHA256
	block.PoolJSON = ""
	if match.Pool != nil {
		raw, _ := json.Marshal(match.Pool)
		block.PoolJSON = string(raw)
	}
}

func (s *Service) read(ctx context.Context, chain rpc.Blockchain, hash string, height int64) (storage.IndexedBlock, error) {
	stored, exists, err := s.db.IndexedBlock(ctx, s.state.Network, hash)
	if err != nil {
		return stored, err
	}
	if exists && stored.MetadataStatus == "complete" && stored.StatisticsStatus == "complete" && stored.PoolStatus != "unavailable" {
		if stored.DefinitionsRevision != s.registry.Source.SHA256 {
			s.attribute(&stored, chain.Chain)
		}
		return stored, nil
	}
	var header struct {
		rpc.Block
		MedianTime int64   `json:"mediantime"`
		Difficulty float64 `json:"difficulty"`
		Version    int64   `json:"version"`
		Bits       string  `json:"bits"`
		Nonce      int64   `json:"nonce"`
		MerkleRoot string  `json:"merkleroot"`
	}
	if err := s.client.Call(ctx, "getblockheader", []any{hash, true}, &header); err != nil {
		return storage.IndexedBlock{}, err
	}
	if header.Hash != hash || header.Height != height || header.Confirmations < 1 || (height > 0 && !validHash(header.Previous)) {
		return storage.IndexedBlock{}, errors.New("inactive or invalid block header")
	}
	block := storage.IndexedBlock{Network: s.state.Network, Hash: hash, Height: height, Previous: header.Previous, Time: header.Time, MedianTime: header.MedianTime, Difficulty: header.Difficulty, Version: header.Version, Bits: header.Bits, Nonce: header.Nonce, MerkleRoot: header.MerkleRoot, MetadataStatus: "partial", StatisticsStatus: "partial", PoolStatus: "unavailable", RetryAt: time.Now().UTC().Add(5 * time.Minute), UpdatedAt: time.Now().UTC()}
	if exists {
		// Successful immutable statistics survive later pruning or transient
		// failures in a different enrichment stage.
		block.SizeBytes, block.WeightUnits, block.TransactionCount = stored.SizeBytes, stored.WeightUnits, stored.TransactionCount
		block.SubsidySats, block.TotalFeesSats, block.TotalOutputSats = stored.SubsidySats, stored.TotalFeesSats, stored.TotalOutputSats
		block.AverageFeeRate, block.MedianFeeRate, block.Statistics = stored.AverageFeeRate, stored.MedianFeeRate, stored.Statistics
		block.CoinbaseHex, block.CoinbaseAddresses, block.PoolJSON = stored.CoinbaseHex, stored.CoinbaseAddresses, stored.PoolJSON
		block.PoolStatus, block.PoolMethod, block.DefinitionsRevision = stored.PoolStatus, stored.PoolMethod, stored.DefinitionsRevision
		block.MetadataStatus, block.StatisticsStatus = stored.MetadataStatus, stored.StatisticsStatus
	}
	if chain.Chain != "main" {
		block.PoolStatus = "unsupported"
	}
	if chain.Pruned && height < chain.PruneHeight {
		if block.MetadataStatus != "complete" {
			block.MetadataStatus = "pruned"
		}
		if block.StatisticsStatus != "complete" {
			block.StatisticsStatus = "pruned"
		}
		return block, nil
	}
	var meta struct {
		rpc.BlockMetadata
		Height        int64    `json:"height"`
		Confirmations int64    `json:"confirmations"`
		TX            []string `json:"tx"`
	}
	if err := s.client.Call(ctx, "getblock", []any{hash, 1}, &meta); err == nil && meta.Hash == hash && meta.Height == height && meta.Confirmations > 0 {
		if meta.Size != nil && meta.Weight != nil && *meta.Size > 0 && *meta.Size <= 4_000_000 && *meta.Weight > 0 && *meta.Weight <= 4_000_000 && meta.Transactions != nil && *meta.Transactions > 0 {
			block.SizeBytes, block.WeightUnits, block.TransactionCount = meta.Size, meta.Weight, meta.Transactions
			block.MetadataStatus = "complete"
		}
		if chain.Chain == "main" && len(meta.TX) > 0 {
			var coinbase struct {
				TXID      string `json:"txid"`
				BlockHash string `json:"blockhash"`
				Vin       []struct {
					Coinbase string `json:"coinbase"`
				} `json:"vin"`
				Vout []struct {
					Script struct {
						Address   string   `json:"address"`
						Addresses []string `json:"addresses"`
					} `json:"scriptPubKey"`
				} `json:"vout"`
			}
			if err := s.client.Call(ctx, "getrawtransaction", []any{meta.TX[0], 1, hash}, &coinbase); err == nil && coinbase.TXID == meta.TX[0] && coinbase.BlockHash == hash && len(coinbase.Vin) == 1 && len(coinbase.Vout) > 0 {
				block.CoinbaseHex = coinbase.Vin[0].Coinbase
				addresses := []string{}
				for _, out := range coinbase.Vout {
					if out.Script.Address != "" {
						addresses = append(addresses, out.Script.Address)
					}
					addresses = append(addresses, out.Script.Addresses...)
				}
				raw, _ := json.Marshal(addresses)
				block.CoinbaseAddresses = string(raw)
				s.attribute(&block, chain.Chain)
			}
		}
	}
	var stats rpc.BlockStats
	var rawStats json.RawMessage
	if err := s.client.Call(ctx, "getblockstats", []any{hash}, &rawStats); err == nil && json.Unmarshal(rawStats, &stats) == nil && stats.BlockHash == hash {
		block.SubsidySats, block.TotalFeesSats, block.TotalOutputSats = nonnegative(stats.Subsidy), nonnegative(stats.TotalFee), nonnegative(stats.TotalOut)
		block.AverageFeeRate = validRate(stats.AverageFeeRate)
		if len(stats.FeeRatePercentiles) == 5 {
			median := stats.FeeRatePercentiles[2]
			block.MedianFeeRate = validRate(&median)
		}
		if block.TransactionCount == nil {
			block.TransactionCount = stats.Transactions
		}
		// Keep fields added by newer Core versions without a schema change.
		block.Statistics = string(rawStats)
		if block.SubsidySats != nil && block.TotalFeesSats != nil && block.TotalOutputSats != nil && block.AverageFeeRate != nil && block.MedianFeeRate != nil {
			block.StatisticsStatus = "complete"
		}
	} else if height == 0 {
		// Core has no undo record for genesis. Keep its header/metadata while
		// avoiding an endless retry of unsupported transaction statistics.
		block.StatisticsStatus = "unavailable"
	}
	return block, nil
}

func validRate(value *float64) *float64 {
	if value != nil && *value >= 0 && !math.IsNaN(*value) && !math.IsInf(*value, 0) {
		return value
	}
	return nil
}

func nonnegative(value *int64) *int64 {
	if value != nil && *value >= 0 {
		return value
	}
	return nil
}

func sats(value *int64) *string {
	if value == nil {
		return nil
	}
	return new(strconv.FormatInt(*value, 10))
}

func view(block storage.IndexedBlock, tip int64) collector.Block {
	result := collector.Block{Block: rpc.Block{Hash: block.Hash, Height: block.Height, Time: block.Time, Previous: block.Previous, Confirmations: max(int64(0), tip-block.Height+1)}, TotalTransactionAmountSats: sats(block.TotalOutputSats), TransactionCount: block.TransactionCount, TotalFeesSats: sats(block.TotalFeesSats), SubsidySats: sats(block.SubsidySats), SizeBytes: block.SizeBytes, WeightUnits: block.WeightUnits, MedianFeeRate: block.MedianFeeRate, AverageFeeRate: block.AverageFeeRate}
	if block.WeightUnits != nil {
		result.CapacityPercent = new(float64(*block.WeightUnits) / 4_000_000 * 100)
	}
	return result
}

func (s *Service) Latest(ctx context.Context) ([]collector.Block, error) {
	chain, network, _ := s.current()
	result := []collector.Block{}
	if chain == nil || network == "" {
		return result, nil
	}
	rows, err := s.db.BlockPage(ctx, network, chain.Blocks, false, 10)
	for _, row := range rows {
		result = append(result, view(row, chain.Blocks))
	}
	return result, err
}

func (s *Service) Status(ctx context.Context) (Status, error) {
	chain, network, observed := s.current()
	result := Status{Status: "waiting", Network: network, Height: -1}
	if chain == nil {
		return result, nil
	}
	result.Height, result.Tip, result.Target = chain.Blocks, chain.BestBlockHash, chain.Blocks+1
	result.Stale = s.stale(observed)
	if chain.InitialBlockDownload || chain.Blocks < chain.Headers {
		result.Status = "syncing"
		return result, nil
	}
	if network == "" {
		return result, nil
	}
	s.mu.RLock()
	lastError := s.lastError
	s.mu.RUnlock()
	state, err := s.db.BlockState(ctx, network)
	if err != nil {
		return result, err
	}
	result.BlockCoverage, result.Error = state.BlockCoverage, lastError
	result.Stale = result.Stale || state.TipHash != result.Tip
	if !state.UpdatedAt.IsZero() {
		result.UpdatedAt = &state.UpdatedAt
	}
	result.Status = "indexing"
	if state.Headers >= result.Target && state.TipHash == result.Tip {
		result.Status = "ready"
	}
	if lastError != "" {
		result.Status = "paused"
	}
	if s.stale(observed) {
		result.Status = "offline"
	}
	return result, nil
}

func attribution(block storage.IndexedBlock) miningpool.Attribution {
	result := miningpool.Attribution{Status: block.PoolStatus, Method: block.PoolMethod}
	if block.PoolJSON != "" {
		_ = json.Unmarshal([]byte(block.PoolJSON), &result.Pool)
	}
	return result
}

// Snapshot implements the existing pool-distribution interface using only SQL.
func (s *Service) Snapshot(chain *rpc.Blockchain, stale bool, window int) miningpool.Distribution {
	result := miningpool.Distribution{Status: "loading", Window: window, Shares: []miningpool.Share{}, Source: s.registry.Source}
	if chain == nil {
		chain, _, _ = s.current()
		stale = true
	}
	if chain == nil {
		result.Status = "unavailable"
		return result
	}
	if chain.Chain != "main" {
		result.Status = "unsupported"
		return result
	}
	if chain.InitialBlockDownload || chain.Blocks < chain.Headers {
		result.Status = "syncing"
		return result
	}
	_, network, _ := s.current()
	if network == "" || (window != 144 && window != 1008) {
		return result
	}
	ctx, cancel := context.WithTimeout(s.ctx, 3*time.Second)
	defer cancel()
	rows, err := s.db.BlockPage(ctx, network, chain.Blocks, false, window)
	if err != nil {
		result.Status = "unavailable"
		return result
	}
	result.Target, result.Height, result.Tip = min(window, int(chain.Blocks+1)), chain.Blocks, chain.BestBlockHash
	counts := map[int]miningpool.Share{}
	for _, row := range rows {
		if row.Height < chain.Blocks-int64(result.Target)+1 {
			continue
		}
		match := attribution(row)
		if match.Status != "identified" && match.Status != "unknown" {
			continue
		}
		id := 0
		if match.Pool != nil {
			id = match.Pool.ID
		}
		share := counts[id]
		share.Pool, share.Blocks = match.Pool, share.Blocks+1
		counts[id] = share
		result.Scanned++
	}
	for share := range maps.Values(counts) {
		share.Percent = float64(share.Blocks) / float64(result.Scanned) * 100
		result.Shares = append(result.Shares, share)
	}
	slices.SortFunc(result.Shares, func(a, b miningpool.Share) int {
		if order := cmp.Compare(b.Blocks, a.Blocks); order != 0 {
			return order
		}
		left, right := 0, 0
		if a.Pool != nil {
			left = a.Pool.ID
		}
		if b.Pool != nil {
			right = b.Pool.ID
		}
		return cmp.Compare(left, right)
	})
	result.Status = "indexing"
	if result.Scanned == result.Target {
		result.Status = "ready"
	} else if len(rows) == result.Target {
		result.Status = "partial"
	}
	if len(rows) > 0 {
		result.UpdatedAt = new(rows[0].UpdatedAt)
	}
	result.Stale = stale || len(rows) == 0 || rows[0].Hash != chain.BestBlockHash
	if stale {
		result.Status = "unavailable"
	}
	return result
}

func (s *Service) Block(ctx context.Context, hash string) (collector.Block, miningpool.Attribution, error) {
	if !validHash(hash) {
		return collector.Block{}, miningpool.Attribution{}, explorer.ErrInvalid
	}
	chain, network, _ := s.current()
	if chain == nil || network == "" {
		return collector.Block{}, miningpool.Attribution{}, explorer.ErrUnavailable
	}
	block, exists, err := s.db.IndexedBlock(ctx, network, hash)
	if err != nil {
		return collector.Block{}, miningpool.Attribution{}, err
	}
	if !exists {
		return collector.Block{}, miningpool.Attribution{}, explorer.ErrNotFound
	}
	active, err := s.db.CanonicalHash(ctx, network, block.Height)
	if err != nil {
		return collector.Block{}, miningpool.Attribution{}, err
	}
	if active != hash {
		return collector.Block{}, miningpool.Attribution{}, explorer.ErrInactive
	}
	return view(block, chain.Blocks), attribution(block), nil
}
