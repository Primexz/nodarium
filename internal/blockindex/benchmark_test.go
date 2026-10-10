package blockindex

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/Primexz/nodarium/internal/miningpool"
	"github.com/Primexz/nodarium/internal/storage"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

type latencyRPC struct{ *indexRPC }

func (f latencyRPC) Call(ctx context.Context, method string, params any, out any) error {
	// Approximate the supplied node trace: metadata/statistics dominate reads.
	delay := map[string]time.Duration{
		"getblockheader":    time.Millisecond,
		"getblock":          30 * time.Millisecond,
		"getrawtransaction": 2 * time.Millisecond,
		"getblockstats":     20 * time.Millisecond,
	}[method]
	if err := pause(ctx, delay); err != nil {
		return err
	}
	return f.indexRPC.Call(ctx, method, params, out)
}

func BenchmarkIndexerBackfill(b *testing.B) {
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		db, err := storage.Open(ctx, "sqlite", filepath.Join(b.TempDir(), "blocks.db"))
		if err != nil {
			b.Fatal(err)
		}
		b.Cleanup(cancel)
		b.Cleanup(func() { _ = db.Close() })
		registry, err := miningpool.Load()
		if err != nil {
			b.Fatal(err)
		}
		fake := latencyRPC{newRPC(31)}
		chain := fake.chain()
		core, logs := observer.New(zap.DebugLevel)
		b.StartTimer()
		index := New(ctx, fake, db, registry, zap.New(core))
		b.Cleanup(index.Close)
		index.Observe(&chain)
		for {
			status, err := index.Status(ctx)
			if err != nil {
				b.Fatalf("%v; worker logs: %+v", err, logs.All())
			}
			if status.Headers == 32 {
				break
			}
			if err := pause(ctx, 10*time.Millisecond); err != nil {
				b.Fatal(err)
			}
		}
		index.Close()
		b.StopTimer()
		cancel()
		db.Close()
	}
	b.ReportMetric(32, "blocks/op")
	b.ReportMetric(float64(32*b.N)/b.Elapsed().Seconds(), "blocks/s")
}
