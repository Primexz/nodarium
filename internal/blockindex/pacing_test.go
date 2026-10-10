package blockindex

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"
)

type headerTimingRPC struct {
	*indexRPC
	headers chan time.Time
}

func (f headerTimingRPC) Call(ctx context.Context, method string, params any, out any) error {
	if method == "getblockheader" {
		f.headers <- time.Now()
	}
	return f.indexRPC.Call(ctx, method, params, out)
}

func TestConfiguredPacingAndCancellation(t *testing.T) {
	for _, delay := range []time.Duration{25 * time.Millisecond, 5 * time.Second} {
		t.Run(delay.String(), func(t *testing.T) {
			fake := headerTimingRPC{newRPC(2), make(chan time.Time, 8)}
			s := testService(t, fake.indexRPC, nil)
			index := New(context.Background(), fake, s.db, s.registry, zap.NewNop(), Options{BlockDelay: delay})
			t.Cleanup(index.Close)
			chain := fake.chain()
			index.Observe(&chain)

			nextRead := func() time.Time {
				t.Helper()
				select {
				case at := <-fake.headers:
					return at
				case <-time.After(3 * time.Second):
					t.Fatal("indexer did not read a header")
					return time.Time{}
				}
			}
			first := nextRead()
			if delay < time.Second {
				if nextRead().Sub(first) < delay {
					t.Fatal("configured delay did not pace consecutive block reads")
				}
			}

			done := make(chan struct{})
			go func() { index.Close(); close(done) }()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("indexer shutdown waited for the configured delay")
			}
		})
	}
}
