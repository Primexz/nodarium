package collector

import (
	"context"
	"errors"
	"math"
	"sync"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
	"github.com/Primexz/nodarium/internal/storage"
)

// Mining estimates are network-wide hashes/second, not the operator's hash power.
// Explicit heights keep both windows aligned with the blockchain snapshot.
type Mining struct {
	Height       int64   `json:"height"`
	Hashrate144  float64 `json:"hashrate_144"`
	Hashrate1008 float64 `json:"hashrate_1008"`
}

func (c *Collector) collectMining(ctx context.Context, chain rpc.Blockchain, chainErr error, old Section[Mining], now time.Time) (Section[Mining], map[string]storage.Measurement) {
	values := map[string]storage.Measurement{}

	if chainErr != nil {
		return refresh(old, (*Mining)(nil), chainErr, now), values
	}

	// During synchronization, historical local tips aren't current network estimates.
	if chain.InitialBlockDownload || chain.Blocks < chain.Headers {
		return Section[Mining]{UpdatedAt: &now, Error: "Network hashrate is unavailable while the node is syncing."}, values
	}

	if chain.Difficulty > 0 && !math.IsNaN(chain.Difficulty) && !math.IsInf(chain.Difficulty, 0) {
		values["difficulty"] = storage.Measurement{Value: chain.Difficulty, Weight: c.interval.Seconds()}
	}

	var estimates [2]float64
	var errs [2]error
	var wg sync.WaitGroup

	for i, window := range []int{144, 1008} {
		wg.Add(1)
		go func(i, window int) {
			defer wg.Done()

			errs[i] = c.rpc.Call(ctx, "getnetworkhashps", []any{window, chain.Blocks}, &estimates[i])

			if errs[i] == nil && (estimates[i] <= 0 || math.IsNaN(estimates[i]) || math.IsInf(estimates[i], 0)) {
				errs[i] = errors.New("Network hashrate estimate is unavailable.")
			}
		}(i, window)
	}

	wg.Wait()

	for i, metric := range []string{"hashrate_144", "hashrate_1008"} {
		if errs[i] == nil {
			values[metric] = storage.Measurement{Value: estimates[i], Weight: c.interval.Seconds()}
		}
	}

	for _, err := range errs {
		if err != nil {
			return refresh(old, (*Mining)(nil), err, now), values
		}
	}

	return refresh(old, &Mining{Height: chain.Blocks, Hashrate144: estimates[0], Hashrate1008: estimates[1]}, nil, now), values
}
