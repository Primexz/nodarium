package miningpool

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/rpc"
)

type callerFunc func(context.Context, string, any, any) error

func (f callerFunc) Call(ctx context.Context, method string, params, out any) error {
	return f(ctx, method, params, out)
}

func waitReady(t *testing.T, s *Service, chain *rpc.Blockchain, window int) Distribution {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)

	for time.Now().Before(deadline) {
		view := s.Snapshot(chain, false, window)

		if view.Tip == chain.BestBlockHash &&
			!view.Stale &&
			(view.Status == "ready" ||
				view.Status == "partial" ||
				view.Status == "unavailable") {
			return view
		}

		time.Sleep(time.Millisecond)
	}

	t.Fatal("pool scan did not finish")

	return Distribution{}
}

func TestDistributionCacheReorgUnknownAndFailures(t *testing.T) {
	r, err := Load()

	if err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int64
	var fail atomic.Bool

	client := callerFunc(func(ctx context.Context, method string, params, out any) error {
		calls.Add(1)

		if fail.Load() {
			return errors.New("private RPC error")
		}

		args := params.([]any)
		var body string

		if method == "getblock" {
			hash := args[0].(string)
			var n int64

			fmt.Sscanf(hash, "%x", &n)
			height := n - 1

			if n == 10000 {
				height = 143
			}

			body = fmt.Sprintf(
				`{"hash":"%s","height":%d,"confirmations":1,"previousblockhash":"%064x","tx":["%064x"]}`,
				hash,
				height,
				height,
				n,
			)
		} else {
			if args[1] != 1 || args[2] == "" {
				t.Error("coinbase lookup requires block hash")
			}

			tag := "Unknown"

			if args[0].(string) == fmt.Sprintf("%064x", 10000) {
				tag = "/AntPool/"
			}

			body = fmt.Sprintf(
				`{"txid":"%s","blockhash":"%s","vin":[{"coinbase":"%s"}],"vout":[{"scriptPubKey":{}}]}`,
				args[0],
				args[2],
				hex.EncodeToString([]byte(tag)),
			)
		}

		return json.Unmarshal([]byte(body), out)
	})

	s := NewService(context.Background(), client, r)
	defer s.Close()

	chain := &rpc.Blockchain{Chain: "main", Blocks: 143, Headers: 143, BestBlockHash: fmt.Sprintf("%064x", 144)}
	view := waitReady(t, s, chain, 144)

	if view.Scanned != 144 ||
		view.Status != "ready" ||
		len(view.Shares) != 1 ||
		view.Shares[0].Pool != nil ||
		view.Shares[0].Percent != 100 {
		t.Fatal(view)
	}

	before := calls.Load()

	for range 10 {
		s.Snapshot(chain, false, 144)
	}

	if calls.Load() != before {
		t.Fatal("completed sample reread blocks")
	}

	chain.BestBlockHash = fmt.Sprintf("%064x", 10000)
	s.mu.Lock()
	s.attempts[144] = time.Time{}
	s.mu.Unlock()
	view = waitReady(t, s, chain, 144)

	if len(view.Shares) != 2 || view.Shares[1].Pool.Name != "AntPool" || view.Shares[1].Blocks != 1 {
		t.Fatal("reorg did not replace old block", view)
	}

	if calls.Load() != before+2 {
		t.Fatal("reorg failed to reuse common ancestry", calls.Load(), before)
	}

	if !s.Snapshot(chain, true, 144).Stale {
		t.Fatal("offline sample not marked stale")
	}

	chain.InitialBlockDownload = true

	if s.Snapshot(chain, false, 144).Status != "syncing" {
		t.Fatal("sync state missing")
	}

	chain.InitialBlockDownload = false
	chain.Chain = "signet"

	if s.Snapshot(chain, false, 144).Status != "unsupported" {
		t.Fatal("unsupported network counted")
	}

	chain.Chain = "main"
	chain.BestBlockHash = fmt.Sprintf("%064x", 20000)
	fail.Store(true)
	s.mu.Lock()
	s.attempts[144] = time.Time{}
	s.mu.Unlock()
	view = waitReady(t, s, chain, 144)

	if view.Status != "unavailable" || view.Scanned != 0 {
		t.Fatal("failed RPC invented blocks", view)
	}
}

func TestPartialSampleUsesOnlySuccessfullyReadBlocks(t *testing.T) {
	r, _ := Load()
	s := NewService(context.Background(), callerFunc(func(ctx context.Context, method string, params, out any) error {
		args := params.([]any)
		var body string

		if method == "getblock" {
			var n int64

			fmt.Sscanf(args[0].(string), "%x", &n)

			if n < 141 {
				return errors.New("pruned block data")
			}

			body = fmt.Sprintf(
				`{"hash":"%s","height":%d,"confirmations":1,"previousblockhash":"%064x","tx":["%064x"]}`,
				args[0],
				n-1,
				n-1,
				n,
			)
		} else {
			body = fmt.Sprintf(
				`{"txid":"%s","blockhash":"%s","vin":[{"coinbase":"%s"}],"vout":[{"scriptPubKey":{}}]}`,
				args[0],
				args[2],
				hex.EncodeToString([]byte("Unknown")),
			)
		}

		return json.Unmarshal([]byte(body), out)
	}), r)

	defer s.Close()

	chain := &rpc.Blockchain{Chain: "main", Blocks: 143, Headers: 143, BestBlockHash: fmt.Sprintf("%064x", 144)}
	view := waitReady(t, s, chain, 144)

	if view.Status != "partial" || view.Scanned != 4 || view.Target != 144 || view.Shares[0].Percent != 100 {
		t.Fatal("missing blocks distorted shares", view)
	}
}

func TestScanCancellationAndSingleWorker(t *testing.T) {
	r, _ := Load()
	started := make(chan struct{}, 1)
	s := NewService(context.Background(), callerFunc(func(ctx context.Context, method string, params, out any) error {
		started <- struct{}{}
		<-ctx.Done()

		return ctx.Err()
	}), r)

	chain := &rpc.Blockchain{Chain: "main", Blocks: 2000, Headers: 2000, BestBlockHash: fmt.Sprintf("%064x", 2001)}

	for range 20 {
		s.Snapshot(chain, false, 144)
		s.Snapshot(chain, false, 1008)
	}

	<-started
	s.Close()

	if len(started) != 0 {
		t.Fatal("more than one background reader")
	}
}
