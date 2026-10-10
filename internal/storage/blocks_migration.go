package storage

import (
	"errors"

	"gorm.io/gorm"
)

// consolidateBlocks runs inside the schema migration transaction. Renaming the
// metadata table preserves all rows and indexes without copying the block index.
func consolidateBlocks(tx *gorm.DB) error {
	if err := tx.Migrator().RenameTable("indexed_blocks", "blocks"); err != nil {
		return err
	}
	if err := tx.Migrator().AddColumn(&IndexedBlock{}, "Canonical"); err != nil {
		return err
	}

	var memberships int64
	if err := tx.Table("canonical_blocks").Count(&memberships).Error; err != nil {
		return err
	}
	result := tx.Exec(`UPDATE blocks SET canonical = true
		WHERE EXISTS (SELECT 1 FROM canonical_blocks c
			WHERE c.network = blocks.network AND c.hash = blocks.hash AND c.height = blocks.height)`)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != memberships {
		return errors.New("canonical block mappings do not match indexed metadata")
	}

	// The partial unique index permits multiple stale blocks at a height but
	// enforces a single active block for each network and height.
	if err := tx.Migrator().CreateIndex(&IndexedBlock{}, "idx_blocks_canonical_height"); err != nil {
		return err
	}
	return tx.Migrator().DropTable("canonical_blocks")
}
