package blockindex

import (
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
	"go.uber.org/zap"
)

const progressLogInterval = 30 * time.Second

// Only the indexing worker updates this state. Progress uses committed coverage
// counters, so logging does not query or scan the historical block tables.
type progressLog struct {
	network string
	active  bool
	at      time.Time
	indexed int64
}

func (s *Service) logProgress(chain rpc.Blockchain, now time.Time) {
	progress := &s.progress
	indexed, total := s.state.Headers, chain.Blocks+1
	remaining := max(int64(0), total-indexed)
	complete := remaining == 0 && s.state.TipHash == chain.BestBlockHash
	message := "Block indexing progress"

	if progress.network != s.state.Network {
		*progress = progressLog{network: s.state.Network}
	}

	if !progress.active {
		if complete {
			return
		}

		message = "Block indexing started"
		progress.active = true
	} else if complete {
		message = "Block indexing complete"
		progress.active = false
	} else if now.Sub(progress.at) < progressLogInterval {
		return
	}

	percent := 0.0
	if total > 0 {
		percent = min(100, float64(indexed)/float64(total)*100)
	}

	fields := []zap.Field{
		zap.String("chain", chain.Chain),
		zap.Int64("indexed_blocks", indexed),
		zap.Int64("total_blocks", total),
		zap.Int64("remaining_blocks", remaining),
		zap.Float64("progress_percent", percent),
		zap.Int64("statistics_blocks", s.state.Statistics),
		zap.Int64("pruned_blocks", s.state.Pruned),
	}
	if !progress.at.IsZero() && message != "Block indexing started" {
		elapsed := now.Sub(progress.at).Seconds()
		if elapsed > 0 {
			fields = append(fields, zap.Float64("blocks_per_second", float64(max(int64(0), indexed-progress.indexed))/elapsed))
		}
	}
	if !complete {
		next := s.state.NextHeight
		if s.state.HeadHash != "" {
			next = s.state.HeadHeight
		} else if s.state.NextHash == "" {
			next = chain.Blocks
		}
		fields = append(fields, zap.Int64("next_height", next))
	}

	s.logger.Info(message, fields...)
	progress.at, progress.indexed = now, indexed
}
