package blockindex

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/Primexz/nodarium/internal/collector"
	"github.com/Primexz/nodarium/internal/explorer"
)

type cursor struct {
	Network   string `json:"n"`
	Tip       string `json:"t"`
	TipHeight int64  `json:"a"`
	Height    int64  `json:"h"`
	Newer     bool   `json:"u"`
}

type Page struct {
	Blocks       []collector.Block `json:"blocks"`
	Older        string            `json:"older_cursor"`
	Newer        string            `json:"newer_cursor"`
	AnchorHeight int64             `json:"anchor_height"`
	Total        int64             `json:"total"`
	Pending      bool              `json:"backfill_pending"`
	Stale        bool              `json:"stale"`
}

func encodeCursor(c cursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func (s *Service) History(ctx context.Context, token string, start *int64, limit int) (Page, error) {
	result := Page{Blocks: []collector.Block{}}
	if limit < 1 || limit > 100 || (start != nil && *start < 0) || (token != "" && start != nil) {
		return result, explorer.ErrInvalid
	}
	chain, network, observed := s.current()
	if chain == nil || network == "" {
		result.Pending = true
		return result, nil
	}
	if limit < 1 || limit > 100 || (start != nil && (*start < 0 || *start > chain.Blocks)) || (token != "" && start != nil) {
		return result, explorer.ErrInvalid
	}
	state, err := s.db.BlockState(ctx, network)
	if err != nil {
		return result, err
	}
	c := cursor{Network: network, Tip: state.TipHash, TipHeight: state.TipHeight, Height: state.TipHeight}
	if token == "" {
		head, err := s.db.BlockPage(ctx, network, chain.Blocks, false, 1)
		if err != nil {
			return result, err
		}
		if len(head) == 0 {
			result.Pending = true
			return result, nil
		}
		c.Tip, c.TipHeight, c.Height = head[0].Hash, head[0].Height, head[0].Height
	}
	if token != "" {
		if len(token) > 512 {
			return result, explorer.ErrInvalid
		}
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.Network != network || !validHash(c.Tip) || c.TipHeight < 0 || c.TipHeight > chain.Blocks || c.Height < 0 || c.Height > c.TipHeight {
			return result, explorer.ErrInvalid
		}
		anchor, err := s.db.CanonicalHash(ctx, network, c.TipHeight)
		if err != nil {
			return result, err
		}
		if anchor != c.Tip {
			return result, ErrCursor
		}
	}
	if start != nil {
		c.Height = *start
	}
	rows, err := s.db.BlockPage(ctx, network, c.Height, c.Newer, limit)
	if err != nil {
		return result, err
	}
	// A cursor keeps a stable browsing anchor while new blocks arrive.
	for _, row := range rows {
		if row.Height <= c.TipHeight {
			result.Blocks = append(result.Blocks, view(row, chain.Blocks))
		}
	}
	result.AnchorHeight = c.TipHeight
	status, err := s.Status(ctx)
	if err != nil {
		return result, err
	}
	result.Total, result.Pending = status.Headers, state.NextHash != "" || state.HeadHash != ""
	result.Stale = s.stale(observed)
	if len(result.Blocks) > 0 {
		first, last := result.Blocks[0], result.Blocks[len(result.Blocks)-1]
		c.Newer, c.Height = false, last.Height-1
		if last.Height > 0 {
			result.Older = encodeCursor(c)
		}
		c.Newer, c.Height = true, first.Height
		if first.Height < c.TipHeight {
			result.Newer = encodeCursor(c)
		}
	}
	return result, nil
}

type EconomicsPoint struct {
	At             int64    `json:"at"`
	Blocks         int64    `json:"blocks"`
	RewardBlocks   int64    `json:"reward_blocks"`
	RateBlocks     int64    `json:"rate_blocks"`
	MedianBlocks   int64    `json:"median_blocks"`
	WeightBlocks   int64    `json:"weight_blocks"`
	SubsidyBTC     *float64 `json:"subsidy_btc"`
	FeesBTC        *float64 `json:"fees_btc"`
	FeeShare       *float64 `json:"fee_share"`
	AverageFeeRate *float64 `json:"average_fee_rate"`
	MedianFeeRate  *float64 `json:"median_fee_rate"`
	Capacity       *float64 `json:"capacity_percent"`
}

type Economics struct {
	Range    string            `json:"range"`
	Recent   []collector.Block `json:"recent_blocks,omitempty"`
	Interval int64             `json:"interval_seconds"`
	Points   []EconomicsPoint  `json:"points"`
	Indexed  int64             `json:"indexed_blocks"`
	Target   int64             `json:"target_blocks"`
	Partial  bool              `json:"partial"`
	Stale    bool              `json:"stale"`
}

func (s *Service) Economics(ctx context.Context, period string, now time.Time) (Economics, error) {
	result := Economics{Range: period, Points: []EconomicsPoint{}}
	if period == "recent" {
		var err error
		result.Recent, err = s.Latest(ctx)
		return result, err
	}
	ranges := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "1y": 365 * 24 * time.Hour, "all": 0}
	duration, valid := ranges[period]
	if !valid {
		return result, explorer.ErrInvalid
	}
	chain, network, observed := s.current()
	if chain == nil || network == "" {
		result.Partial = true
		return result, nil
	}
	start, _, err := s.db.BlockTimeBounds(ctx, network)
	if err != nil {
		return result, err
	}
	end := now.Unix()
	if duration != 0 {
		start = now.Add(-duration).Unix()
	}
	if start == 0 || start > end {
		return result, nil
	}
	// Align buckets in UTC and keep responses bounded independent of chain age.
	interval := max(int64(3600), ((end-start)/999+3599)/3600*3600)
	start = start / interval * interval
	buckets, err := s.db.BlockEconomics(ctx, network, start, end, interval)
	if err != nil {
		return result, err
	}
	byTime := make(map[int64]EconomicsPoint, len(buckets))
	for _, bucket := range buckets {
		point := EconomicsPoint{At: bucket.At * 1000, Blocks: bucket.Blocks, RewardBlocks: bucket.RewardBlocks, RateBlocks: bucket.RateBlocks, MedianBlocks: bucket.MedianBlocks, WeightBlocks: bucket.WeightBlocks}
		if bucket.RewardBlocks > 0 {
			subsidy, fees := bucket.Subsidy/float64(bucket.RewardBlocks)/1e8, bucket.Fees/float64(bucket.RewardBlocks)/1e8
			point.SubsidyBTC, point.FeesBTC = &subsidy, &fees
			if bucket.Subsidy+bucket.Fees > 0 {
				share := bucket.Fees / (bucket.Subsidy + bucket.Fees) * 100
				point.FeeShare = &share
			}
		}
		if bucket.RateBlocks > 0 {
			rate := bucket.Rate / float64(bucket.RateBlocks)
			point.AverageFeeRate = &rate
		}
		if bucket.MedianBlocks > 0 {
			median := bucket.Median / float64(bucket.MedianBlocks)
			point.MedianFeeRate = &median
		}
		if bucket.WeightBlocks > 0 {
			capacity := bucket.Weight / float64(bucket.WeightBlocks) / 4_000_000 * 100
			point.Capacity = &capacity
		}
		byTime[bucket.At] = point
		if bucket.RewardBlocks < bucket.Blocks || bucket.RateBlocks < bucket.Blocks || bucket.MedianBlocks < bucket.Blocks || bucket.WeightBlocks < bucket.Blocks {
			result.Partial = true
		}
	}
	for at := start; at <= end; at += interval {
		point, ok := byTime[at]
		if !ok {
			point = EconomicsPoint{At: at * 1000}
		}
		result.Points = append(result.Points, point)
	}
	status, err := s.Status(ctx)
	if err != nil {
		return result, err
	}
	result.Interval, result.Indexed, result.Target = interval, status.Headers, status.Target
	result.Partial = result.Partial || status.Headers < status.Target
	result.Stale = s.stale(observed)
	return result, nil
}
