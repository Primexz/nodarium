package storage

import (
	"context"
	"errors"
	"os"
)

// DatabaseSize describes the configured database, including SQLite journal files.
// PostgreSQL reports the whole configured database, which may contain other schemas.
type DatabaseSize struct {
	SizeBytes int64  `json:"size_bytes"`
	Driver    string `json:"driver"`
	InMemory  bool   `json:"in_memory"`
}

func (s *Store) Size(ctx context.Context) (DatabaseSize, error) {
	size := DatabaseSize{Driver: s.db.Dialector.Name()}
	db := s.db.WithContext(ctx)
	unavailable := errors.New("database size unavailable")

	switch size.Driver {
	case "postgres":
		if err := db.Raw("SELECT pg_database_size(current_database())").Scan(&size.SizeBytes).Error; err != nil {
			return size, unavailable
		}
	case "sqlite":
		var path string
		result := db.Raw("SELECT file FROM pragma_database_list() WHERE name = 'main'").Scan(&path)
		if result.Error != nil || result.RowsAffected != 1 {
			return size, unavailable
		}
		if path == "" {
			size.InMemory = true
			if err := db.Raw("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()").Scan(&size.SizeBytes).Error; err != nil {
				return size, unavailable
			}
			return size, nil
		}
		for i, suffix := range []string{"", "-wal", "-shm"} {
			info, err := os.Stat(path + suffix)
			if i > 0 && errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return size, unavailable
			}
			size.SizeBytes += info.Size()
		}
	default:
		return size, unavailable
	}

	return size, nil
}
