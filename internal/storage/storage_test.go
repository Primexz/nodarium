package storage

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStorageBackends(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			dsn := filepath.Join(t.TempDir(), "test.db")

			if driver == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")

				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not set")
				}
			}

			ctx := context.Background()
			s, err := Open(ctx, driver, dsn)

			if err != nil {
				t.Fatal(err)
			}

			defer s.Close()

			node := t.Name() + time.Now().Format("150405.000000000")
			now := time.Now().UTC().Truncate(time.Hour).Add(15 * time.Minute)
			t.Run("migrations are repeatable", func(t *testing.T) {
				if err := s.migrate(ctx); err != nil {
					t.Fatal(err)
				}
			})

			first := map[string]Measurement{"rx_rate": {Value: 10, Weight: 10, Total: 100}, "peers": {Value: 2, Weight: 10}}

			for i := 0; i < 2; i++ {
				if err := s.Save(ctx, node, now.Add(-20*time.Second), first); err != nil {
					t.Fatal(err)
				}
			}

			if err := s.Save(
				ctx,
				node,
				now.Add(-10*time.Second),
				map[string]Measurement{"rx_rate": {Value: 30, Weight: 5, Total: 150}, "peers": {Value: 4, Weight: 5}},
			); err != nil {
				t.Fatal(err)
			}

			t.Run("weighted rollups and duplicate writes", func(t *testing.T) {
				for _, period := range []string{"1h", "24h", "7d", "30d", "1y"} {
					h, err := s.History(ctx, node, "rx_rate", period, now)

					if err != nil {
						t.Fatal(err)
					}

					if math.Abs(h.Total-250) > .0001 {
						t.Fatalf("%s total: %v", period, h.Total)
					}

					if len(h.Points) > 800 {
						t.Fatalf("unbounded points: %d", len(h.Points))
					}
				}

				h, _ := s.History(ctx, node, "rx_rate", "24h", now)
				var found bool

				for _, p := range h.Points {
					if p.Value != nil {
						found = true

						if math.Abs(*p.Value-250.0/15) > .001 {
							t.Fatalf("mean %f", *p.Value)
						}

						if *p.Peak != 30 {
							t.Fatal("peak lost")
						}

						if math.Abs(p.Coverage-.05) > .0001 {
							t.Fatalf("coverage %v", p.Coverage)
						}
					}
				}

				if !found {
					t.Fatal("missing history")
				}
			})

			t.Run("node isolation and gaps", func(t *testing.T) {
				h, _ := s.History(ctx, "different-node", "rx_rate", "1h", now)

				for _, p := range h.Points {
					if p.Value != nil {
						t.Fatal("cross-node history")
					}
				}

				h, _ = s.History(ctx, node, "rx_rate", "1h", now)

				if h.Points[0].Value != nil {
					t.Fatal("missing data rendered as zero")
				}
			})

			t.Run("network mining rollups preserve scale and missing history", func(t *testing.T) {
				n := node + "mining"

				for _, sample := range []struct {
					seconds            time.Duration
					multiplier, weight float64
				}{{20, 1, 10}, {10, 2, 5}} {
					values := map[string]Measurement{}

					for metric, base := range map[string]float64{"hashrate_144": 910e18, "hashrate_1008": 895e18, "difficulty": 123.4e12} {
						values[metric] = Measurement{Value: base * sample.multiplier, Weight: sample.weight}
					}

					if err := s.Save(ctx, n, now.Add(-sample.seconds*time.Second), values); err != nil {
						t.Fatal(err)
					}
				}

				for metric, base := range map[string]float64{"hashrate_144": 910e18, "hashrate_1008": 895e18, "difficulty": 123.4e12} {
					for _, period := range []string{"1h", "24h", "7d", "30d", "1y"} {
						h, err := s.History(ctx, n, metric, period, now)

						if err != nil {
							t.Fatal(err)
						}

						found := false

						for _, p := range h.Points {
							if p.Value == nil {
								continue
							}

							found = true
							want := base * 4 / 3

							if period == "1h" {
								if (*p.Value != base && *p.Value != base*2) || p.Peak == nil || *p.Peak != *p.Value {
									t.Fatalf("raw %s: %+v", metric, p)
								}

								continue
							}

							if math.Abs(*p.Value-want) > want*1e-12 || p.Peak == nil || *p.Peak != base*2 || p.Total != 0 {
								t.Fatalf("%s/%s: %+v", metric, period, p)
							}
						}

						if !found || h.Points[0].Value != nil {
							t.Fatalf("%s/%s: readings missing or gap filled", metric, period)
						}
					}
				}
			})

			t.Run("bucket boundary splitting", func(t *testing.T) {
				n := node + "boundary"
				at := now.Truncate(time.Hour).Add(5 * time.Second)

				if err := s.Save(ctx, n, at, map[string]Measurement{"tx_rate": {Value: 20, Weight: 10, Total: 200}}); err != nil {
					t.Fatal(err)
				}

				var rows []point

				s.db.Where("node = ? AND resolution = ?", n, 3600).Order("at").Find(&rows)

				if len(rows) != 2 || rows[0].Total != 100 || rows[1].Total != 100 {
					t.Fatalf("bad boundary split %+v", rows)
				}
			})

			t.Run("transaction rollback", func(t *testing.T) {
				if err := s.Save(
					ctx,
					node+"invalid",
					now,
					map[string]Measurement{"invalid": {Value: 1, Weight: 10}, "peers": {Value: 1, Weight: 10}},
				); err == nil {
					t.Fatal("accepted invalid metric")
				}

				var count int64

				s.db.Model(&point{}).Where("node = ?", node+"invalid").Count(&count)

				if count != 0 {
					t.Fatal("partial transaction persisted")
				}
			})

			t.Run("retention preserves rollups", func(t *testing.T) {
				n := node + "retention"
				old := now.Add(-60 * 24 * time.Hour)

				if err := s.Save(ctx, n, old, map[string]Measurement{"rx_rate": {Value: 10, Weight: 10, Total: 100}}); err != nil {
					t.Fatal(err)
				}

				if err := s.Prune(ctx, now); err != nil {
					t.Fatal(err)
				}

				var rows []point

				s.db.Where("node = ?", n).Find(&rows)

				if len(rows) != 1 || rows[0].Resolution != 3600 {
					t.Fatalf("incorrect retained rows: %+v", rows)
				}

				if err := s.Prune(ctx, now.Add(366*24*time.Hour)); err != nil {
					t.Fatal(err)
				}

				var count int64

				s.db.Model(&point{}).Where("node = ?", n).Count(&count)

				if count != 0 {
					t.Fatal("expired rows retained")
				}
			})

			t.Run("restart persistence", func(t *testing.T) {
				if err := s.Save(ctx, node, now, map[string]Measurement{"height": {Value: 100, Weight: 10}}); err != nil {
					t.Fatal(err)
				}

				other, err := Open(ctx, driver, dsn)

				if err != nil {
					t.Fatal(err)
				}

				defer other.Close()

				h, err := other.History(ctx, node, "height", "1h", now)

				if err != nil {
					t.Fatal(err)
				}

				if h.Points[len(h.Points)-1].Value == nil {
					t.Fatal("history missing after reopen")
				}
			})

			t.Run("database failure", func(t *testing.T) {
				cancelled, cancel := context.WithCancel(ctx)
				cancel()

				if _, err := s.History(cancelled, node, "height", "1h", now); err == nil {
					t.Fatal("cancelled read succeeded")
				}

				if err := s.Save(cancelled, node, now, map[string]Measurement{"peers": {Value: 1, Weight: 10}}); err == nil {
					t.Fatal("cancelled write succeeded")
				}
			})

			s.db.Where("node LIKE ?", node+"%").Delete(&point{})
		})
	}
}

func TestUnknownDatabase(t *testing.T) {
	if _, err := Open(context.Background(), "mysql", "secret-password"); err == nil {
		t.Fatal("unsupported driver accepted")
	}
}
