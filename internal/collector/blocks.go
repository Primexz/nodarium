package collector

import (
	"context"
	"math"
	"strconv"
	"sync"

	"github.com/Primexz/nodarium/internal/rpc"
)

const maxBlockWeight int64 = 4_000_000

// Keep only statistics for the displayed hashes. Reusing them across tip changes
// avoids re-reading nine old blocks, while a reorg cannot reuse another hash's statistics.
// Copy the slice before enrichment: snapshots may still be read by HTTP handlers.
func (c *Collector) blockStatistics(ctx context.Context, blocks []Block, previous *[]Block) []Block {
	result := append([]Block{}, blocks...)
	cached := map[string]Block{}

	if previous != nil {
		for _, block := range *previous {
			cached[block.Hash] = block
		}
	}

	var wg sync.WaitGroup

	slots := make(chan struct{}, 3)

	for i := range result {
		previous := cached[result[i].Hash]
		result[i].TotalTransactionAmountSats = previous.TotalTransactionAmountSats
		result[i].TransactionCount = previous.TransactionCount
		result[i].TotalFeesSats = previous.TotalFeesSats
		result[i].SizeBytes = previous.SizeBytes
		result[i].WeightUnits = previous.WeightUnits
		result[i].CapacityPercent = previous.CapacityPercent
		result[i].MedianFeeRate = previous.MedianFeeRate

		if result[i].TotalTransactionAmountSats != nil &&
			result[i].TransactionCount != nil &&
			result[i].TotalFeesSats != nil &&
			result[i].SizeBytes != nil &&
			result[i].WeightUnits != nil {
			continue
		}

		wg.Go(func() {
			select {
			case slots <- struct{}{}:
				defer func() {
					<-slots
				}()

			case <-ctx.Done():
				return
			}

			block := &result[i]

			if block.TotalTransactionAmountSats == nil || block.TransactionCount == nil || block.TotalFeesSats == nil {
				var stats rpc.BlockStats

				err := c.rpc.Call(
					ctx,
					"getblockstats",
					[]any{block.Hash, []string{"blockhash", "total_out", "txs", "totalfee", "feerate_percentiles"}},
					&stats,
				)

				if err == nil && stats.BlockHash == block.Hash {
					if len(stats.FeeRatePercentiles) == 5 {
						median := stats.FeeRatePercentiles[2]

						if median >= 0 && !math.IsNaN(median) && !math.IsInf(median, 0) {
							block.MedianFeeRate = &median
						}
					}

					if stats.TotalOut != nil && *stats.TotalOut >= 0 {
						amount := strconv.FormatInt(*stats.TotalOut, 10)
						block.TotalTransactionAmountSats = &amount
					}

					if stats.TotalFee != nil && *stats.TotalFee >= 0 {
						fees := strconv.FormatInt(*stats.TotalFee, 10)
						block.TotalFeesSats = &fees
					}

					if stats.Transactions != nil && *stats.Transactions > 0 {
						block.TransactionCount = stats.Transactions
					}
				}
			}

			// getblockstats total_size/total_weight exclude coinbase and block
			// overhead. Use getblock's full measurements for capacity instead.
			if block.SizeBytes == nil || block.WeightUnits == nil {
				var meta rpc.BlockMetadata

				err := c.rpc.Call(ctx, "getblock", []any{block.Hash, 1}, &meta)

				if err == nil && meta.Hash == block.Hash {
					if meta.Size != nil && *meta.Size > 0 && *meta.Size <= maxBlockWeight {
						block.SizeBytes = meta.Size
					}

					if meta.Weight != nil && *meta.Weight > 0 && *meta.Weight <= maxBlockWeight {
						block.WeightUnits = meta.Weight
						capacity := float64(*meta.Weight) / float64(maxBlockWeight) * 100
						block.CapacityPercent = &capacity
					}

					if meta.Transactions != nil && *meta.Transactions > 0 {
						block.TransactionCount = meta.Transactions
					}
				}
			}
		})
	}

	wg.Wait()

	return result
}
