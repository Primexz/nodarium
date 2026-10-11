package storage

import (
	"context"
	"time"

	"gorm.io/gorm/clause"
)

// ActivityEvent stores quiet observations, never the transaction stream.
// Text is localized by clients from Kind and structured fields.
type ActivityEvent struct {
	ID             string `json:"id" gorm:"primaryKey;size:64"`
	Node           string `json:"-" gorm:"size:64;index:idx_activity_node_time,priority:1"`
	At             int64  `json:"at" gorm:"index:idx_activity_node_time,priority:2"`
	Kind           string `json:"kind" gorm:"size:24"`
	Status         string `json:"status,omitempty"`
	PreviousStatus string `json:"previous_status,omitempty"`
	Hash           string `json:"hash,omitempty"`
	Height         *int64 `json:"height"`
	BlockTime      *int64 `json:"block_time"`
	PreviousHash   string `json:"previous_hash,omitempty"`
	Depth          *int64 `json:"depth"`
}

type ActivityPage struct {
	Events           []ActivityEvent `json:"events"`
	Cursor           string          `json:"cursor,omitempty"`
	PersistenceError bool            `json:"persistence_error"`
}

func (s *Store) SaveActivity(ctx context.Context, event ActivityEvent) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&event).Error
}

func (s *Store) Activity(ctx context.Context, node, kind string, beforeAt int64, beforeID string) (ActivityPage, error) {
	rows := []ActivityEvent{}
	q := s.db.WithContext(ctx).Where("node = ? AND at >= ?", node, time.Now().AddDate(0, 0, -30).UnixMilli())
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	if beforeID != "" {
		q = q.Where("at < ? OR (at = ? AND id < ?)", beforeAt, beforeAt, beforeID)
	}
	err := q.Order("at DESC, id DESC").Limit(51).Find(&rows).Error
	page := ActivityPage{Events: rows}
	if len(rows) > 50 {
		page.Events = rows[:50]
	}
	return page, err
}

func (s *Store) PruneActivity(ctx context.Context) error {
	db := s.db.WithContext(ctx)
	if err := db.Where("at < ?", time.Now().AddDate(0, 0, -30).UnixMilli()).Delete(&ActivityEvent{}).Error; err != nil {
		return err
	}
	var nodes []string
	if err := db.Model(&ActivityEvent{}).Distinct("node").Pluck("node", &nodes).Error; err != nil {
		return err
	}
	for _, node := range nodes {
		var frontier ActivityEvent
		result := db.Where("node = ?", node).Order("at DESC, id DESC").Offset(99999).Limit(1).Find(&frontier)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			if err := db.Where("node = ? AND (at < ? OR (at = ? AND id < ?))", node, frontier.At, frontier.At, frontier.ID).Delete(&ActivityEvent{}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
