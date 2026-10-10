package storage

import (
	"context"
	"strconv"
)

// PoolBucket groups compact attribution evidence, avoiding loading block bodies
// or a full chain of metadata into application memory. Missing metrics have
// their own denominators, so pruned data never becomes an observed zero.
type PoolBucket struct {
	At                int64
	PoolJSON          string
	PoolStatus        string
	Blocks            int64
	TransactionBlocks int64
	EmptyBlocks       int64
	WeightBlocks      int64
	Weight            float64
	FeeBlocks         int64
	Fees              float64
}

func (s *Store) PoolBuckets(ctx context.Context, network string, start, end, interval int64) ([]PoolBucket, error) {
	rows := []PoolBucket{}
	err := s.canonical(ctx, network).Where("time >= ? AND time <= ?", start, end).
		Select(`(time / ?) * ? AS at, pool_json, pool_status, COUNT(*) AS blocks,
 COUNT(transaction_count) AS transaction_blocks,
 COALESCE(SUM(CASE WHEN transaction_count = 1 THEN 1 ELSE 0 END), 0) AS empty_blocks,
 COUNT(weight_units) AS weight_blocks, COALESCE(SUM(CAST(weight_units AS DOUBLE PRECISION)), 0) AS weight,
 COUNT(total_fees_sats) AS fee_blocks, COALESCE(SUM(CAST(total_fees_sats AS DOUBLE PRECISION)), 0) AS fees`, interval, interval).
		Group("at, pool_json, pool_status").Order("at ASC").Scan(&rows).Error
	return rows, err
}

// PoolBlocks uses a height keyset and the stored pool ID. Definitions may rename
// a pool; comparing names or serialized JSON would lose its historical blocks.
func (s *Store) PoolBlocks(ctx context.Context, network string, id int, height int64, limit int) ([]IndexedBlock, error) {
	rows := []IndexedBlock{}
	expression := "json_extract(NULLIF(pool_json, ''), '$.id') = ?"
	var value any = id
	if s.db.Dialector.Name() == "postgres" {
		expression = "CAST(NULLIF(pool_json, '') AS JSONB)->>'id' = ?"
		value = strconv.Itoa(id)
	}
	err := s.canonical(ctx, network).Where("pool_status = ?", "identified").Where(expression, value).
		Where("height <= ?", height).Order("height DESC").Limit(limit).Find(&rows).Error
	return rows, err
}
