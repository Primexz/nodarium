package collector

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
)

var feeTargets = [...]int{2, 3, 6}

type FeeRate struct {
	Rate   float64 `json:"fee_rate"`
	Blocks int     `json:"estimated_blocks"`
}

// Each target retains its own observation and error, so one failed RPC never
// makes another target appear stale or erases its successful history sample.
type FeeTarget struct {
	Target int `json:"target_blocks"`
	Section[FeeRate]
}

type Fees struct {
	Mode    string      `json:"mode"`
	Targets []FeeTarget `json:"targets"`
}

func (c *Collector) collectFees(ctx context.Context, chain rpc.Blockchain, chainErr error, old Section[Fees], now time.Time) (Section[Fees], map[string]storage.Measurement) {
	values := map[string]storage.Measurement{}

	if chainErr != nil {
		return refresh(old, (*Fees)(nil), chainErr, now), values
	}

	if chain.InitialBlockDownload || chain.Blocks < chain.Headers {
		return Section[Fees]{UpdatedAt: &now, Error: "Fee estimates are unavailable while the node is syncing."}, values
	}

	previous := map[int]Section[FeeRate]{}

	if old.Data != nil {
		for _, target := range old.Data.Targets {
			previous[target.Target] = target.Section
		}
	}

	var estimates [len(feeTargets)]rpc.SmartFee
	var errs [len(feeTargets)]error
	var wg sync.WaitGroup

	for i, target := range feeTargets {
		wg.Add(1)
		go func(i, target int) {
			defer wg.Done()

			errs[i] = c.rpc.Call(ctx, "estimatesmartfee", []any{target, "CONSERVATIVE"}, &estimates[i])
		}(i, target)
	}

	wg.Wait()
	fees := Fees{Mode: "conservative", Targets: make([]FeeTarget, 0, len(feeTargets))}

	for i, target := range feeTargets {
		estimate := estimates[i]
		var section Section[FeeRate]

		switch {
		case errs[i] != nil:
			section = refresh(previous[target], (*FeeRate)(nil), errs[i], now)

		case estimate.FeeRate == nil || len(estimate.Errors) > 0:
			// A fresh insufficient-data response is not a transport outage.
			// Drop any old estimate and never expose Core's free-form error text.
			section = Section[FeeRate]{UpdatedAt: &now, Error: "Not enough data to estimate this fee rate."}

		default:
			rate := *estimate.FeeRate * 100_000

			if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || estimate.Blocks < 2 || estimate.Blocks > 1008 {
				section = refresh(previous[target], (*FeeRate)(nil), errors.New("Fee rate estimate is unavailable."), now)
			} else {
				section = refresh(previous[target], &FeeRate{Rate: rate, Blocks: estimate.Blocks}, nil, now)

				// Core can clamp targets while its estimator warms up. Preserve
				// the returned target in the UI, but do not mislabel its history.
				if estimate.Blocks == target {
					values[fmt.Sprintf("fee_estimate_%d", target)] = storage.Measurement{Value: rate, Weight: c.interval.Seconds()}
				}
			}
		}

		fees.Targets = append(fees.Targets, FeeTarget{Target: target, Section: section})
	}

	return refresh(old, &fees, nil, now), values
}
