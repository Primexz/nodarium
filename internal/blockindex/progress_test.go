package blockindex

import (
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestProgressLogsCommittedCountsWithoutBatchSpam(t *testing.T) {
	fake := newRPC(39)
	s := testService(t, fake, nil)
	core, logs := observer.New(zap.InfoLevel)
	s.logger = zap.New(core).Named("block-index")
	chain := fake.chain()
	now := time.Unix(1700000000, 0)

	s.logProgress(chain, now)
	if err := s.step(t.Context(), chain); err != nil {
		t.Fatal(err)
	}
	s.logProgress(chain, now.Add(time.Second))
	if logs.Len() != 1 {
		t.Fatal("each batch must not generate an info log")
	}
	if err := s.step(t.Context(), chain); err != nil {
		t.Fatal(err)
	}
	s.logProgress(chain, now.Add(30*time.Second))

	entries := logs.All()
	if len(entries) != 2 || entries[0].Message != "Block indexing started" || entries[1].Message != "Block indexing progress" {
		t.Fatalf("missing start or periodic progress: %+v", entries)
	}
	fields := entries[1].ContextMap()
	if fields["indexed_blocks"] != int64(32) || fields["total_blocks"] != int64(40) || fields["remaining_blocks"] != int64(8) || fields["progress_percent"] != float64(80) || fields["next_height"] != int64(7) {
		t.Fatalf("progress does not match committed blocks: %+v", fields)
	}
	if fields["blocks_per_second"] != float64(32)/30 {
		t.Fatal("processing rate must use committed progress over elapsed time")
	}
	if err := s.step(t.Context(), chain); err != nil {
		t.Fatal(err)
	}
	s.logProgress(chain, now.Add(31*time.Second))
	s.logProgress(chain, now.Add(time.Minute))
	entries = logs.All()
	if len(entries) != 3 || entries[2].Message != "Block indexing complete" || entries[2].ContextMap()["progress_percent"] != float64(100) {
		t.Fatalf("completion must log once, immediately: %+v", entries)
	}
}

func TestProgressLogsResumeWithStoredCoverage(t *testing.T) {
	fake := newRPC(39)
	s := testService(t, fake, nil)
	if err := s.step(t.Context(), fake.chain()); err != nil {
		t.Fatal(err)
	}
	s = testService(t, fake, s.db)
	core, logs := observer.New(zap.InfoLevel)
	s.logger = zap.New(core)
	s.logProgress(fake.chain(), time.Now())
	entries := logs.All()
	if len(entries) != 1 || entries[0].ContextMap()["indexed_blocks"] != int64(16) || entries[0].ContextMap()["remaining_blocks"] != int64(24) {
		t.Fatalf("resume progress discarded stored coverage: %+v", entries)
	}
}
