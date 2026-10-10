package storage

import (
	"context"
	"errors"
	"slices"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// IndexedBlock keeps compact metadata, never decoded transactions. Statistics
// contains Core's additional getblockstats fields for future views. Dedicated
// columns support bounded history and economics queries without decoding JSON.
// Canonical marks membership in Core's active chain; stale blocks stay stored.
type IndexedBlock struct {
	Network             string `gorm:"primaryKey;size:64;index:idx_block_time,priority:1;index:idx_block_retry,priority:1;uniqueIndex:idx_blocks_canonical_height,priority:1,where:canonical = true"`
	Hash                string `gorm:"primaryKey;size:64"`
	Height              int64  `gorm:"uniqueIndex:idx_blocks_canonical_height,priority:2,where:canonical = true"`
	Canonical           bool   `gorm:"not null;default:false"`
	Previous            string
	Time                int64 `gorm:"index:idx_block_time,priority:2"`
	MedianTime          int64
	Difficulty          float64
	Version             int64
	Bits                string
	Nonce               int64
	MerkleRoot          string
	SizeBytes           *int64
	WeightUnits         *int64
	TransactionCount    *int64
	SubsidySats         *int64
	TotalFeesSats       *int64
	TotalOutputSats     *int64
	AverageFeeRate      *float64
	MedianFeeRate       *float64
	Statistics          string
	CoinbaseHex         string
	CoinbaseAddresses   string
	PoolJSON            string
	PoolStatus          string
	PoolMethod          string
	DefinitionsRevision string
	MetadataStatus      string
	StatisticsStatus    string
	NeedsRetry          bool      `gorm:"index:idx_block_retry,priority:2"`
	RetryAt             time.Time `gorm:"index:idx_block_retry,priority:3"`
	UpdatedAt           time.Time
}

func (IndexedBlock) TableName() string { return "blocks" }

type BlockIndexState struct {
	Network             string `gorm:"primaryKey;size:64"`
	Chain               string
	TipHash             string
	TipHeight           int64
	NextHeight          int64
	NextHash            string
	HeadHeight          int64
	HeadHash            string
	DefinitionsRevision string
	AttributionHeight   int64
	BlockCoverage       `gorm:"embedded"`
	Revision            int64
	UpdatedAt           time.Time
}

type BlockCoverage struct {
	Headers      int64  `json:"headers"`
	Statistics   int64  `json:"statistics"`
	Pools        int64  `json:"pools"`
	Pruned       int64  `json:"pruned"`
	OldestHeight *int64 `json:"oldest_height"`
}

func (s *Store) BlockState(ctx context.Context, network string) (BlockIndexState, error) {
	var state BlockIndexState
	err := s.db.WithContext(ctx).First(&state, "network = ?", network).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BlockIndexState{Network: network, TipHeight: -1, NextHeight: -1, HeadHeight: -1}, nil
	}
	return state, err
}

// CommitBlockIndex updates canonical membership and its checkpoint atomically.
// forkHeight deactivates only the disconnected suffix; rows by hash remain reusable.
func (s *Store) CommitBlockIndex(ctx context.Context, state BlockIndexState, blocks []IndexedBlock, forkHeight *int64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var previous BlockIndexState
		err := tx.First(&previous, "network = ?", state.Network).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		state.BlockCoverage, state.Revision = previous.BlockCoverage, previous.Revision+1
		canonical := func() *gorm.DB {
			return canonicalBlocks(tx, state.Network)
		}
		if forkHeight != nil {
			var removed BlockCoverage
			if err := canonical().Where("height > ?", *forkHeight).Select(coverageSQL).Scan(&removed).Error; err != nil {
				return err
			}
			adjustCoverage(&state.BlockCoverage, removed, -1)
			if err := canonical().Where("height > ?", *forkHeight).UpdateColumn("canonical", false).Error; err != nil {
				return err
			}
			var oldest []IndexedBlock
			if err := canonical().Select("height").Order("height ASC").Limit(1).Find(&oldest).Error; err != nil {
				return err
			}
			state.OldestHeight = nil
			if len(oldest) > 0 {
				state.OldestHeight = &oldest[0].Height
			}
		}
		for _, block := range blocks {
			if block.Network != state.Network || block.Height < 0 || block.Height > state.TipHeight {
				return errors.New("invalid block index batch")
			}
			var old []IndexedBlock
			if err := canonical().Where("height = ?", block.Height).Limit(1).Find(&old).Error; err != nil {
				return err
			}
			if len(old) > 0 {
				adjustCoverage(&state.BlockCoverage, rowCoverage(old[0]), -1)
				// Release the height before activating its replacement.
				if old[0].Hash != block.Hash {
					if err := canonical().Where("height = ?", block.Height).UpdateColumn("canonical", false).Error; err != nil {
						return err
					}
				}
			}
			block.Canonical = true
			block.NeedsRetry = block.MetadataStatus == "partial" || (block.Height > 0 && (block.StatisticsStatus == "partial" || (block.PoolStatus == "unavailable" && block.MetadataStatus != "pruned")))
			if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&block).Error; err != nil {
				return err
			}
			adjustCoverage(&state.BlockCoverage, rowCoverage(block), 1)
			if state.OldestHeight == nil || block.Height < *state.OldestHeight {
				state.OldestHeight = new(block.Height)
			}
		}
		state.UpdatedAt = time.Now().UTC()
		return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&state).Error
	})
}

const coverageSQL = `COUNT(*) AS headers,
 COALESCE(SUM(CASE WHEN statistics_status = 'complete' THEN 1 ELSE 0 END), 0) AS statistics,
 COALESCE(SUM(CASE WHEN pool_status IN ('identified', 'unknown') THEN 1 ELSE 0 END), 0) AS pools,
 COALESCE(SUM(CASE WHEN metadata_status = 'pruned' THEN 1 ELSE 0 END), 0) AS pruned`

func rowCoverage(block IndexedBlock) BlockCoverage {
	coverage := BlockCoverage{Headers: 1}
	if block.StatisticsStatus == "complete" {
		coverage.Statistics = 1
	}
	if block.PoolStatus == "identified" || block.PoolStatus == "unknown" {
		coverage.Pools = 1
	}
	if block.MetadataStatus == "pruned" {
		coverage.Pruned = 1
	}
	return coverage
}

func adjustCoverage(total *BlockCoverage, change BlockCoverage, sign int64) {
	total.Headers += sign * change.Headers
	total.Statistics += sign * change.Statistics
	total.Pools += sign * change.Pools
	total.Pruned += sign * change.Pruned
}

func canonicalBlocks(db *gorm.DB, network string) *gorm.DB {
	return db.Model(&IndexedBlock{}).Where("network = ?", network).Where("canonical = true")
}

func (s *Store) canonical(ctx context.Context, network string) *gorm.DB {
	return canonicalBlocks(s.db.WithContext(ctx), network)
}

// Coverage counters are maintained with canonical membership, avoiding a full
// chain scan on every UI poll once the index contains a million blocks.
func (s *Store) BlockCoverage(ctx context.Context, network string) (BlockCoverage, error) {
	state, err := s.BlockState(ctx, network)
	return state.BlockCoverage, err
}

func (s *Store) CanonicalHash(ctx context.Context, network string, height int64) (string, error) {
	var row IndexedBlock
	err := s.canonical(ctx, network).Select("hash").Where("height = ?", height).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	return row.Hash, err
}

func (s *Store) IndexedBlock(ctx context.Context, network, hash string) (IndexedBlock, bool, error) {
	var block IndexedBlock
	err := s.db.WithContext(ctx).First(&block, "network = ? AND hash = ?", network, hash).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return block, false, nil
	}
	return block, err == nil, err
}

// BlockPage uses a height keyset, not an OFFSET that grows with chain length.
func (s *Store) BlockPage(ctx context.Context, network string, height int64, newer bool, limit int) ([]IndexedBlock, error) {
	rows := []IndexedBlock{}
	query := s.canonical(ctx, network)
	if newer {
		query = query.Where("height > ?", height).Order("height ASC")
	} else {
		query = query.Where("height <= ?", height).Order("height DESC")
	}
	if err := query.Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	if newer {
		slices.Reverse(rows)
	}
	return rows, nil
}

func (s *Store) NextBlockRetry(ctx context.Context, network string, now time.Time) (*IndexedBlock, error) {
	var rows []IndexedBlock
	err := s.canonical(ctx, network).
		Where("needs_retry = ? AND retry_at <= ?", true, now).
		Order("retry_at ASC, height DESC").Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

// EconomicsBucket contains sums and per-metric coverage; callers distinguish an
// observed zero from missing data and do not average averages across buckets.
type EconomicsBucket struct {
	At           int64
	Blocks       int64
	RewardBlocks int64
	Subsidy      float64
	Fees         float64
	RateBlocks   int64
	Rate         float64
	MedianBlocks int64
	Median       float64
	WeightBlocks int64
	Weight       float64
}

func (s *Store) BlockEconomics(ctx context.Context, network string, start, end, interval int64) ([]EconomicsBucket, error) {
	rows := []EconomicsBucket{}
	err := s.canonical(ctx, network).
		Where("time >= ? AND time <= ?", start, end).
		Select(`(time / ?) * ? AS at, COUNT(*) AS blocks,
		SUM(CASE WHEN subsidy_sats IS NOT NULL AND total_fees_sats IS NOT NULL THEN 1 ELSE 0 END) AS reward_blocks,
		COALESCE(SUM(CASE WHEN subsidy_sats IS NOT NULL AND total_fees_sats IS NOT NULL THEN CAST(subsidy_sats AS DOUBLE PRECISION) ELSE 0 END), 0) AS subsidy,
		COALESCE(SUM(CASE WHEN subsidy_sats IS NOT NULL AND total_fees_sats IS NOT NULL THEN CAST(total_fees_sats AS DOUBLE PRECISION) ELSE 0 END), 0) AS fees,
		COUNT(average_fee_rate) AS rate_blocks, COALESCE(SUM(average_fee_rate), 0) AS rate,
		COUNT(median_fee_rate) AS median_blocks, COALESCE(SUM(median_fee_rate), 0) AS median,
		COUNT(weight_units) AS weight_blocks, COALESCE(SUM(CAST(weight_units AS DOUBLE PRECISION)), 0) AS weight`, interval, interval).
		Group("at").Order("at ASC").Scan(&rows).Error
	return rows, err
}

func (s *Store) BlockTimeBounds(ctx context.Context, network string) (int64, int64, error) {
	var result struct{ Start, End int64 }
	err := s.canonical(ctx, network).Select("COALESCE(MIN(time), 0) AS start, COALESCE(MAX(time), 0) AS end").Scan(&result).Error
	return result.Start, result.End, err
}

// LastBlockState restores read-only history when Core is offline at startup.
// Successful observations still select the actual network before new writes.
func (s *Store) LastBlockState(ctx context.Context) (BlockIndexState, error) {
	var rows []BlockIndexState
	err := s.db.WithContext(ctx).Order("updated_at DESC").Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		return BlockIndexState{TipHeight: -1, NextHeight: -1, HeadHeight: -1}, err
	}
	return rows[0], nil
}
