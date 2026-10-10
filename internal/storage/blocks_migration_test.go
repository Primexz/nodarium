package storage

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// These fixtures retain the version-two schema, independently of current models.
type legacyIndexedBlock struct {
	Network             string `gorm:"primaryKey;size:64;index:idx_block_time,priority:1;index:idx_block_retry,priority:1"`
	Hash                string `gorm:"primaryKey;size:64"`
	Height              int64
	Previous            string
	Time                int64 `gorm:"index:idx_block_time,priority:2"`
	MedianTime          int64
	Difficulty          float64
	Version             int64
	Bits                string
	Nonce               int64
	MerkleRoot          string
	SizeBytes           *int64
	WeightUnits         *int64
	TransactionCount    *int64
	SubsidySats         *int64
	TotalFeesSats       *int64
	TotalOutputSats     *int64
	AverageFeeRate      *float64
	MedianFeeRate       *float64
	Statistics          string
	CoinbaseHex         string
	CoinbaseAddresses   string
	PoolJSON            string
	PoolStatus          string
	PoolMethod          string
	DefinitionsRevision string
	MetadataStatus      string
	StatisticsStatus    string
	NeedsRetry          bool      `gorm:"index:idx_block_retry,priority:2"`
	RetryAt             time.Time `gorm:"index:idx_block_retry,priority:3"`
	UpdatedAt           time.Time
}

type legacyCanonicalBlock struct {
	Network string `gorm:"primaryKey;size:64"`
	Height  int64  `gorm:"primaryKey;autoIncrement:false"`
	Hash    string `gorm:"size:64;index"`
}

func (legacyIndexedBlock) TableName() string   { return "indexed_blocks" }
func (legacyCanonicalBlock) TableName() string { return "canonical_blocks" }

// Migrations require a whole legacy schema. Give PostgreSQL an isolated schema
// so these tests cannot alter the database used by other integration tests.
func migrationStore(t *testing.T, driver string) *Store {
	t.Helper()
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var dialect gorm.Dialector
	if driver == "sqlite" {
		dialect = sqlite.Open(filepath.Join(t.TempDir(), "migration.db"))
	} else {
		dsn := os.Getenv("TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_POSTGRES_DSN not set")
		}
		base, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		conn, err := base.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		schema := fmt.Sprintf("block_migration_%d", time.Now().UnixNano())
		if err := base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dialect = postgres.Open(parsed.String())
	}
	db, err := gorm.Open(dialect, config)
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{db: db}
	t.Cleanup(func() { store.Close() })
	if err := db.AutoMigrate(&migration{}, &point{}, &legacyIndexedBlock{}, &legacyCanonicalBlock{}, &BlockIndexState{}); err != nil {
		t.Fatal(err)
	}
	for _, version := range []int{1, 2} {
		if err := db.Create(&migration{Version: version, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	return store
}

func TestConsolidateBlockTables(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			s := migrationStore(t, driver)
			ctx := t.Context()
			now := time.Now().UTC().Truncate(time.Second)
			rows := []legacyIndexedBlock{
				{Network: "main", Hash: "genesis", Height: 0, Time: 100, StatisticsStatus: "complete", PoolStatus: "unknown", MetadataStatus: "complete", Statistics: `{"totalfee":10}`, TotalFeesSats: new(int64(10)), TotalOutputSats: new(int64(9007199254740993)), PoolJSON: `{"id":1}`, CoinbaseHex: "abcd", CoinbaseAddresses: `["address"]`, UpdatedAt: now},
				{Network: "main", Hash: "active", Height: 1, Time: 200, MetadataStatus: "partial", NeedsRetry: true, RetryAt: now.Add(-time.Hour), UpdatedAt: now},
				{Network: "main", Hash: "stale", Height: 1, Time: 300, MetadataStatus: "partial", NeedsRetry: true, RetryAt: now.Add(-2 * time.Hour), UpdatedAt: now},
				{Network: "test", Hash: "active", Height: 1, Time: 400, MetadataStatus: "pruned", UpdatedAt: now},
			}
			memberships := []legacyCanonicalBlock{{Network: "main", Height: 0, Hash: "genesis"}, {Network: "main", Height: 1, Hash: "active"}, {Network: "test", Height: 1, Hash: "active"}}
			state := BlockIndexState{Network: "main", Chain: "main", TipHash: "active", TipHeight: 1, NextHeight: -1, HeadHeight: 1, HeadHash: "active", DefinitionsRevision: "revision", AttributionHeight: 1, Revision: 15, BlockCoverage: BlockCoverage{Headers: 2, Statistics: 1, Pools: 1, OldestHeight: new(int64(0))}, UpdatedAt: now}
			for _, value := range []any{&rows, &memberships, &state} {
				if err := s.db.Create(value).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.Save(ctx, "node", now, map[string]Measurement{"peers": {Value: 4, Weight: 10}}); err != nil {
				t.Fatal(err)
			}
			before, err := s.History(ctx, "node", "peers", "1h", now)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.migrate(ctx); err != nil {
				t.Fatal(err)
			}
			if err := s.migrate(ctx); err != nil {
				t.Fatal(err)
			}
			if !s.db.Migrator().HasTable("blocks") || s.db.Migrator().HasTable("indexed_blocks") || s.db.Migrator().HasTable("canonical_blocks") {
				t.Fatal("legacy block tables remain")
			}
			restored, err := s.BlockState(ctx, "main")
			if err != nil || !restored.UpdatedAt.Equal(state.UpdatedAt) {
				t.Fatalf("checkpoint timestamp changed: %+v, %v", restored, err)
			}
			restored.UpdatedAt = state.UpdatedAt
			if !reflect.DeepEqual(restored, state) {
				t.Fatalf("checkpoint changed: %+v, %v", restored, err)
			}
			after, err := s.History(ctx, "node", "peers", "1h", now)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal("monitoring history changed")
			}
			for _, row := range rows {
				block, exists, err := s.IndexedBlock(ctx, row.Network, row.Hash)
				if err != nil || !exists {
					t.Fatalf("block lost: %s, %v", row.Hash, err)
				}
				want := IndexedBlock{Network: row.Network, Hash: row.Hash, Height: row.Height, Canonical: row.Hash != "stale", Time: row.Time, StatisticsStatus: row.StatisticsStatus, PoolStatus: row.PoolStatus, MetadataStatus: row.MetadataStatus, Statistics: row.Statistics, TotalFeesSats: row.TotalFeesSats, TotalOutputSats: row.TotalOutputSats, PoolJSON: row.PoolJSON, CoinbaseHex: row.CoinbaseHex, CoinbaseAddresses: row.CoinbaseAddresses, NeedsRetry: row.NeedsRetry, RetryAt: row.RetryAt, UpdatedAt: row.UpdatedAt}
				// Compare timestamps by instant, independent of database location.
				if !block.UpdatedAt.Equal(want.UpdatedAt) || !block.RetryAt.Equal(want.RetryAt) {
					t.Fatal("timestamps changed")
				}
				block.UpdatedAt, block.RetryAt = want.UpdatedAt, want.RetryAt
				if !reflect.DeepEqual(block, want) {
					t.Fatalf("metadata changed: got %+v, want %+v", block, want)
				}
			}
			retry, err := s.NextBlockRetry(ctx, "main", now)
			if err != nil || retry == nil || retry.Hash != "active" {
				t.Fatalf("stale retry included: %+v, %v", retry, err)
			}
			start, end, err := s.BlockTimeBounds(ctx, "main")
			if err != nil || start != 100 || end != 200 {
				t.Fatalf("stale time bounds: %d %d, %v", start, end, err)
			}
			page, err := s.BlockPage(ctx, "main", 100, false, 10)
			if err != nil || len(page) != 2 || page[0].Hash != "active" {
				t.Fatalf("page: %+v, %v", page, err)
			}
			// Resume writes against the migrated table and refresh existing rows.
			if err := s.CommitBlockIndex(ctx, state, page, nil); err != nil {
				t.Fatal(err)
			}
			coverage, err := s.BlockCoverage(ctx, "main")
			if err != nil || !reflect.DeepEqual(coverage, state.BlockCoverage) {
				t.Fatalf("coverage changed: %+v, %v", coverage, err)
			}
		})
	}
}

func TestBlockMigrationRollsBackInvalidMembership(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			s := migrationStore(t, driver)
			row := legacyIndexedBlock{Network: "main", Hash: "block", Height: 1}
			mapping := legacyCanonicalBlock{Network: "main", Height: 2, Hash: "block"}
			if err := s.db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.db.Create(&mapping).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.migrate(t.Context()); err == nil {
				t.Fatal("accepted mismatched canonical metadata")
			}
			if s.db.Migrator().HasTable("blocks") || !s.db.Migrator().HasTable("indexed_blocks") || !s.db.Migrator().HasTable("canonical_blocks") {
				t.Fatal("failed migration changed tables")
			}
			var count int64
			if err := s.db.Model(&migration{}).Where("version = 3").Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("failed migration advanced version: %d, %v", count, err)
			}
			var retained legacyIndexedBlock
			if err := s.db.First(&retained).Error; err != nil || retained.Hash != row.Hash {
				t.Fatal("failed migration lost data")
			}
			if err := s.db.Model(&legacyCanonicalBlock{}).Where("network = ?", "main").Update("height", 1).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.migrate(t.Context()); err != nil {
				t.Fatalf("cannot retry migration: %v", err)
			}
		})
	}
}
