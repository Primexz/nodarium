package blockindex

import (
	"cmp"
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"time"

	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/explorer"
	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/storage"
)

type PoolMetrics struct {
	Pool              *miningpool.Pool `json:"pool"`
	Key               string           `json:"key"`
	Blocks            int64            `json:"blocks"`
	Share             *float64         `json:"share_percent"`
	TransactionBlocks int64            `json:"transaction_blocks"`
	EmptyBlocks       int64            `json:"empty_blocks"`
	EmptyPercent      *float64         `json:"empty_percent"`
	WeightBlocks      int64            `json:"weight_blocks"`
	Capacity          *float64         `json:"capacity_percent"`
	FeeBlocks         int64            `json:"fee_blocks"`
	FeesBTC           *float64         `json:"average_fees_btc"`
}

type PoolTrendPoint struct {
	At     int64            `json:"at"`
	Blocks int64            `json:"blocks"`
	Counts map[string]int64 `json:"counts"`
}

type PoolTrends struct {
	Height     int64             `json:"height"`
	Range      string            `json:"range"`
	Status     string            `json:"status"`
	Start      int64             `json:"start"`
	End        int64             `json:"end"`
	Interval   int64             `json:"interval_seconds"`
	Blocks     int64             `json:"blocks"`
	Attributed int64             `json:"attributed_blocks"`
	Classified int64             `json:"classified_blocks"`
	Indexed    int64             `json:"indexed_blocks"`
	Target     int64             `json:"target_blocks"`
	Partial    bool              `json:"partial"`
	Stale      bool              `json:"stale"`
	Pools      []PoolMetrics     `json:"pools"`
	Points     []PoolTrendPoint  `json:"points"`
	Source     miningpool.Source `json:"definitions"`
}

func poolKey(row storage.PoolBucket) (string, *miningpool.Pool) {
	if row.PoolStatus == "identified" {
		var pool miningpool.Pool
		if json.Unmarshal([]byte(row.PoolJSON), &pool) == nil && pool.ID > 0 {
			return "pool-" + strconv.Itoa(pool.ID), &pool
		}
	}
	if row.PoolStatus == "unknown" {
		return "unknown", nil
	}
	return "unavailable", nil
}

func ratio(numerator float64, denominator int64) *float64 {
	if denominator == 0 {
		return nil
	}
	return new(numerator / float64(denominator))
}

func (s *Service) PoolTrends(ctx context.Context, period string, now time.Time) (PoolTrends, error) {
	result := PoolTrends{Range: period, Status: "waiting", Pools: []PoolMetrics{}, Points: []PoolTrendPoint{}}
	if s.registry != nil {
		result.Source = s.registry.Source
	}
	duration, valid := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "1y": 365 * 24 * time.Hour, "all": 0}[period]
	if !valid {
		return result, explorer.ErrInvalid
	}
	chain, network, observed := s.current()
	if chain == nil || network == "" {
		result.Partial = true
		return result, nil
	}
	if chain.Chain != "main" {
		result.Status = "unsupported"
		return result, nil
	}
	status, err := s.Status(ctx)
	if err != nil {
		return result, err
	}
	result.Height = chain.Blocks
	result.Status, result.Indexed, result.Target, result.Stale = status.Status, status.Headers, status.Target, status.Stale || s.stale(observed)
	result.Partial = status.Headers < status.Target
	start, _, err := s.db.BlockTimeBounds(ctx, network)
	if err != nil {
		return result, err
	}
	end := now.Unix()
	if duration != 0 {
		start = now.Add(-duration).Unix()
	}
	result.Start, result.End = start*1000, end*1000
	if start > end || (duration == 0 && status.Headers == 0) {
		return result, nil
	}
	// At most 366 UTC buckets, with an exact range boundary. The first bucket
	// may be partial; blocks preceding the selected range are never included.
	interval := max(int64(3600), ((end-start)/365+3599)/3600*3600)
	result.Interval = interval
	buckets, err := s.db.PoolBuckets(ctx, network, start, end, interval)
	if err != nil {
		return result, err
	}
	totals := map[string]storage.PoolBucket{}
	identities := map[string]*miningpool.Pool{}
	points := map[int64]PoolTrendPoint{}
	for _, bucket := range buckets {
		key, pool := poolKey(bucket)
		identities[key] = pool
		total := totals[key]
		total.Blocks += bucket.Blocks
		total.TransactionBlocks += bucket.TransactionBlocks
		total.EmptyBlocks += bucket.EmptyBlocks
		total.WeightBlocks += bucket.WeightBlocks
		total.Weight += bucket.Weight
		total.FeeBlocks += bucket.FeeBlocks
		total.Fees += bucket.Fees
		totals[key] = total
		result.Blocks += bucket.Blocks
		if key != "unavailable" {
			result.Classified += bucket.Blocks
		}
		if pool != nil {
			result.Attributed += bucket.Blocks
		}
		point := points[bucket.At]
		point.At, point.Blocks = bucket.At*1000, point.Blocks+bucket.Blocks
		if point.Counts == nil {
			point.Counts = map[string]int64{}
		}
		point.Counts[key] += bucket.Blocks
		points[bucket.At] = point
	}
	for key, total := range totals {
		result.Pools = append(result.Pools, PoolMetrics{Key: key, Pool: identities[key], Blocks: total.Blocks,
			Share: ratio(float64(total.Blocks)*100, result.Blocks), TransactionBlocks: total.TransactionBlocks, EmptyBlocks: total.EmptyBlocks,
			EmptyPercent: ratio(float64(total.EmptyBlocks)*100, total.TransactionBlocks), WeightBlocks: total.WeightBlocks,
			Capacity: ratio(total.Weight/4_000_000*100, total.WeightBlocks), FeeBlocks: total.FeeBlocks, FeesBTC: ratio(total.Fees/1e8, total.FeeBlocks)})
	}
	slices.SortFunc(result.Pools, func(a, b PoolMetrics) int {
		if order := cmp.Compare(b.Blocks, a.Blocks); order != 0 {
			return order
		}
		return cmp.Compare(a.Key, b.Key)
	})
	for at := start / interval * interval; at <= end; at += interval {
		point, exists := points[at]
		if !exists {
			point = PoolTrendPoint{At: at * 1000, Counts: map[string]int64{}}
		}
		result.Points = append(result.Points, point)
	}
	result.Partial = result.Partial || result.Classified < result.Blocks
	return result, nil
}

type PoolDetail struct {
	Pool    miningpool.Pool   `json:"pool"`
	History PoolTrends        `json:"history"`
	Recent  []collector.Block `json:"recent_blocks"`
}

func (s *Service) PoolDetail(ctx context.Context, id int, period string, now time.Time) (PoolDetail, error) {
	result := PoolDetail{Recent: []collector.Block{}}
	if id < 1 {
		return result, explorer.ErrInvalid
	}
	pool, found := s.registry.Pool(id)
	if !found {
		return result, explorer.ErrNotFound
	}
	result.Pool = pool
	history, err := s.PoolTrends(ctx, period, now)
	if err != nil {
		return result, err
	}
	result.History = history
	chain, network, _ := s.current()
	if chain == nil || network == "" || chain.Chain != "main" {
		return result, nil
	}
	rows, err := s.db.PoolBlocks(ctx, network, id, chain.Blocks, 20)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		result.Recent = append(result.Recent, view(row, chain.Blocks))
	}
	return result, nil
}
