// Package storage owns database models, migrations, and portable history queries.
package storage

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

type Store struct {
	db *gorm.DB
}

type migration struct {
	Version   int `gorm:"primaryKey"`
	AppliedAt time.Time
}

type point struct {
	Node       string `gorm:"primaryKey;size:64"`
	Metric     string `gorm:"primaryKey;size:40"`
	Resolution int64  `gorm:"primaryKey;index:idx_retention,priority:1"`
	At         int64  `gorm:"primaryKey;autoIncrement:false;index:idx_retention,priority:2"`
	Sum        float64
	Weight     float64
	Peak       float64
	Total      float64
	Samples    int64
}

// Measurement values represent the interval ending at the observation timestamp.
// Total is additive (bytes); Weight is observed seconds, never inferred outage time.
type Measurement struct {
	Value, Weight, Total float64
}

type HistoryPoint struct {
	At       int64    `json:"at"`
	Value    *float64 `json:"value"`
	Peak     *float64 `json:"peak"`
	Total    float64  `json:"total"`
	Coverage float64  `json:"coverage"`
	Samples  int64    `json:"samples"`
}

type History struct {
	Metric   string         `json:"metric"`
	Range    string         `json:"range"`
	Interval int64          `json:"interval_seconds"`
	Points   []HistoryPoint `json:"points"`
	Total    float64        `json:"total"`
}

var Metrics = map[string]bool{
	"rx_rate":       true,
	"tx_rate":       true,
	"peers":         true,
	"peers_in":      true,
	"peers_out":     true,
	"height":        true,
	"sync":          true,
	"mempool_count": true,
	"mempool_bytes": true,
	"mempool_usage": true,
	"mempool_fee":   true,
	"hashrate_144":  true,
	"hashrate_1008": true,
	"difficulty":    true,
}

func Open(ctx context.Context, driver, dsn string) (*Store, error) {
	var dialector gorm.Dialector

	switch driver {
	case "sqlite":
		if !strings.HasPrefix(dsn, "file:") && dsn != ":memory:" {
			if err := os.MkdirAll(filepath.Dir(dsn), 0700); err != nil {
				return nil, errors.New("cannot create SQLite data directory")
			}
		}
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dialector = sqlite.Open(dsn + sep + "_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")

	case "postgres":
		dialector = postgres.Open(dsn)

	default:
		return nil, errors.New("unsupported database driver")
	}

	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), DisableAutomaticPing: true})

	if err != nil {
		return nil, errors.New("database initialization failed; check DB_DRIVER and DB_DSN")
	}

	sqlDB, err := db.DB()

	if err != nil {
		return nil, errors.New("database connection unavailable")
	}

	if driver == "sqlite" {
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetMaxIdleConns(1)
	} else {
		sqlDB.SetMaxOpenConns(5)
		sqlDB.SetMaxIdleConns(2)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
	}

	if err = sqlDB.PingContext(ctx); err != nil {
		sqlDB.Close()

		return nil, errors.New("database unreachable; check connection and TLS settings")
	}

	s := &Store{db: db}

	if err = s.migrate(ctx); err != nil {
		sqlDB.Close()

		return nil, errors.New("database migration failed")
	}

	return s, nil
}

func (s *Store) Close() error {
	db, err := s.db.DB()

	if err != nil {
		return err
	}

	return db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.AutoMigrate(&migration{}); err != nil {
			return err
		}

		var current int

		if err := tx.Model(&migration{}).Select("COALESCE(MAX(version), 0)").Scan(&current).Error; err != nil {
			return err
		}

		if current > 1 {
			return errors.New("database schema newer than application")
		}

		if current < 1 {
			if err := tx.AutoMigrate(&point{}); err != nil {
				return err
			}

			return tx.Create(&migration{Version: 1, AppliedAt: time.Now().UTC()}).Error
		}

		return nil
	})
}

func (s *Store) Save(ctx context.Context, node string, at time.Time, values map[string]Measurement) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for metric, v := range values {
			if !Metrics[metric] || v.Weight <= 0 || math.IsNaN(v.Value) || math.IsInf(v.Value, 0) {
				return errors.New("invalid measurement")
			}

			raw := point{
				Node:    node,
				Metric:  metric,
				At:      at.UnixMilli(),
				Sum:     v.Value * v.Weight,
				Weight:  v.Weight,
				Peak:    v.Value,
				Total:   v.Total,
				Samples: 1,
			}

			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&raw)

			if result.Error != nil {
				return result.Error
			}

			if result.RowsAffected == 0 {
				continue
			}

			// All resolutions are updated with the raw insert in one transaction.
			// Split observations at bucket boundaries to preserve time-weighted means.
			end := at.UnixMilli()
			start := end - int64(v.Weight*1000)

			for _, resolution := range []int64{300, 3600} {
				width := resolution * 1000

				for cursor := start; cursor < end; {
					bucket := cursor / width * width
					until := min(end, bucket+width)
					weight := float64(until-cursor) / 1000
					p := point{
						Node:       node,
						Metric:     metric,
						Resolution: resolution,
						At:         bucket,
						Sum:        v.Value * weight,
						Weight:     weight,
						Peak:       v.Value,
						Total:      v.Total * weight / v.Weight,
						Samples:    1,
					}

					update := map[string]any{
						"sum":     gorm.Expr("points.sum + ?", p.Sum),
						"weight":  gorm.Expr("points.weight + ?", p.Weight),
						"total":   gorm.Expr("points.total + ?", p.Total),
						"samples": gorm.Expr("points.samples + 1"),
						"peak":    gorm.Expr("CASE WHEN points.peak > ? THEN points.peak ELSE ? END", p.Peak, p.Peak),
					}

					if err := tx.Clauses(clause.OnConflict{
						Columns:   []clause.Column{{Name: "node"}, {Name: "metric"}, {Name: "resolution"}, {Name: "at"}},
						DoUpdates: clause.Assignments(update),
					}).Create(&p).Error; err != nil {
						return err
					}

					cursor = until
				}
			}
		}

		return nil
	})
}

func (s *Store) Prune(ctx context.Context, now time.Time) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for resolution, age := range map[int64]time.Duration{0: 48 * time.Hour, 300: 30 * 24 * time.Hour, 3600: 365 * 24 * time.Hour} {
			// Keep a partially overlapping bucket until its entire interval expires.
			if err := tx.Where("resolution = ? AND at < ?", resolution, now.Add(-age).UnixMilli()-resolution*1000).Delete(&point{}).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

func (s *Store) History(ctx context.Context, node, metric, period string, now time.Time) (History, error) {
	h := History{Metric: metric, Range: period, Points: []HistoryPoint{}}

	if !Metrics[metric] {
		return h, errors.New("unknown metric")
	}

	type window struct {
		duration             time.Duration
		resolution, interval int64
	}

	windows := map[string]window{
		"1h":  {time.Hour, 0, 10},
		"24h": {24 * time.Hour, 300, 300},
		"7d":  {7 * 24 * time.Hour, 300, 900},
		"30d": {30 * 24 * time.Hour, 3600, 3600},
		"1y":  {365 * 24 * time.Hour, 3600, 43200},
	}

	w, ok := windows[period]

	if !ok {
		return h, errors.New("invalid range")
	}

	h.Interval = w.interval
	width := w.interval * 1000
	start := now.Add(-w.duration).UnixMilli() / width * width
	end := now.UnixMilli() / width * width
	var rows []point

	if err := s.db.WithContext(ctx).Where(
		"node = ? AND metric = ? AND resolution = ? AND at >= ? AND at <= ?",
		node,
		metric,
		w.resolution,
		start,
		now.UnixMilli(),
	).Order("at ASC").Limit(20000).Find(&rows).Error; err != nil {
		return h, errors.New("history database unavailable")
	}

	buckets := map[int64]point{}

	for _, p := range rows {
		k := p.At / width * width
		a, exists := buckets[k]
		a.Sum += p.Sum
		a.Weight += p.Weight
		a.Total += p.Total
		a.Samples += p.Samples

		if !exists || p.Peak > a.Peak {
			a.Peak = p.Peak
		}

		buckets[k] = a
	}

	for at := start; at <= end; at += width {
		p := HistoryPoint{At: at}

		if a, ok := buckets[at]; ok && a.Weight > 0 {
			v := a.Sum / a.Weight
			p.Value = &v
			peak := a.Peak
			p.Peak = &peak
			p.Total = a.Total
			p.Coverage = math.Min(1, a.Weight/float64(w.interval))
			p.Samples = a.Samples
			h.Total += a.Total
		}

		h.Points = append(h.Points, p)
	}

	return h, nil
}
