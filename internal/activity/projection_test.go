package activity

import (
	"context"
	"fmt"
	"testing"
)

func projectionEntry(size int64, rate float64, parents ...string) MempoolEntry {
	e := MempoolEntry{VSize: size, Weight: size * 4, Depends: parents}
	e.Fees.Base = float64(size) * rate / 1e8
	return e
}

func TestProjectionSelectsCPFPAndRepricesSharedParents(t *testing.T) {
	// The first child's package pays 100 sat/vB. Once its shared parent is
	// selected, the second child's standalone 500 sat/vB outranks the 95 sat/vB
	// independent transaction, which then no longer fits the first block.
	p, err := projectMempool(t.Context(), map[string]MempoolEntry{
		"parent":      projectionEntry(600000, 0),
		"first":       projectionEntry(100000, 700, "parent"),
		"second":      projectionEntry(100000, 500, "parent"),
		"independent": projectionEntry(200000, 95),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Blocks) != 2 || p.Blocks[0].Count != 3 || p.Blocks[0].VSize != 800000 || p.Blocks[0].MinRate != 100 || p.Blocks[0].MaxRate != 500 || p.Blocks[1].Count != 1 {
		t.Fatalf("incorrect package selection: %+v", p.Blocks)
	}
	if p.Count != 4 || p.VSize != 1000000 || p.RemainingCount != 0 {
		t.Fatalf("incorrect totals: %+v", p)
	}
}

func TestProjectionTracksFullBacklogAndBothCapacityLimits(t *testing.T) {
	entries := map[string]MempoolEntry{}
	for i := range 12 {
		entries[fmt.Sprint(i)] = projectionEntry(500000, float64(i+1))
	}
	p, err := projectMempool(t.Context(), entries)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Blocks) != 4 || p.RemainingCount != 8 || p.RemainingVSize != 4000000 {
		t.Fatalf("lost backlog: %+v", p)
	}
	for _, b := range p.Blocks {
		if b.Weight > projectedWeight || b.VSize > projectedVSize || b.Count != 1 {
			t.Fatalf("exceeded block capacity: %+v", b)
		}
		var size int64
		var count int
		for _, g := range b.Groups {
			size += g.VSize
			count += g.Count
		}
		if size != b.VSize || count != b.Count {
			t.Fatal("fee groups lost transactions")
		}
	}
	// Virtual size can be adjusted for sigops; it must constrain packing even
	// when actual transaction weight alone would allow both entries.
	a, b := projectionEntry(600000, 2), projectionEntry(600000, 1)
	a.Weight, b.Weight = 1000000, 1000000
	p, err = projectMempool(t.Context(), map[string]MempoolEntry{"a": a, "b": b})
	if err != nil || len(p.Blocks) != 2 {
		t.Fatalf("ignored adjusted size: %+v, %v", p, err)
	}
}

func TestProjectionUsesModifiedMiningFees(t *testing.T) {
	a, b := projectionEntry(600000, 1), projectionEntry(600000, 10)
	a.Fees.Modified = new(float64(600000) * 20 / 1e8)
	p, err := projectMempool(t.Context(), map[string]MempoolEntry{"prioritized": a, "other": b})
	if err != nil || len(p.Blocks) != 2 || p.Blocks[0].MedianRate != 20 || p.MinRate != 10 || p.MaxRate != 20 {
		t.Fatalf("ignored Core fee deltas: %+v, %v", p, err)
	}
}

func TestProjectionRejectsIncompleteDependenciesAndCancellation(t *testing.T) {
	for name, entries := range map[string]map[string]MempoolEntry{
		"missing parent": {"child": projectionEntry(100, 5, "missing")},
		"cycle":          {"a": projectionEntry(100, 5, "b"), "b": projectionEntry(100, 5, "a")},
		"invalid size":   {"a": projectionEntry(0, 5)},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := projectMempool(t.Context(), entries); err == nil {
				t.Fatal("misleading projection accepted")
			}
		})
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := projectMempool(ctx, map[string]MempoolEntry{}); err == nil {
		t.Fatal("cancelled work succeeded")
	}
	if p, err := projectMempool(t.Context(), map[string]MempoolEntry{}); err != nil || len(p.Blocks) != 0 || p.Count != 0 {
		t.Fatal("empty mempool was not represented")
	}
}

func BenchmarkProjectionLargeMempool(b *testing.B) {
	entries := make(map[string]MempoolEntry, 80000)
	for i := range 80000 {
		entries[fmt.Sprint(i)] = projectionEntry(150, float64(i%100+1))
	}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := projectMempool(b.Context(), entries); err != nil {
			b.Fatal(err)
		}
	}
}
