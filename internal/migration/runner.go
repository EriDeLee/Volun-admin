package migration

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

type Record struct {
	Version   int `gorm:"primaryKey;autoIncrement:false"`
	Name      string
	AppliedAt time.Time
}

func (Record) TableName() string { return "schema_migrations" }

type Step struct {
	Version int
	Name    string
	Up      func(*gorm.DB) error
}

func Run(db *gorm.DB, steps []Step) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(764921031)").Error; err != nil {
				return err
			}
		}
		if !tx.Migrator().HasTable(&Record{}) {
			if err := tx.Migrator().CreateTable(&Record{}); err != nil {
				return err
			}
		}
		var latestVersion int
		if err := tx.Model(&Record{}).Select("COALESCE(MAX(version), -1)").Scan(&latestVersion).Error; err != nil {
			return err
		}
		if len(steps) > 0 && latestVersion > steps[len(steps)-1].Version {
			return fmt.Errorf("database schema is newer than this application")
		}
		for _, step := range steps {
			if step.Version <= latestVersion {
				continue
			}
			if step.Version != latestVersion+1 {
				return fmt.Errorf("migration sequence gap before version %d", step.Version)
			}
			if err := step.Up(tx); err != nil {
				return fmt.Errorf("migration %04d %s: %w", step.Version, step.Name, err)
			}
			if err := tx.Create(&Record{Version: step.Version, Name: step.Name, AppliedAt: time.Now().UTC()}).Error; err != nil {
				return err
			}
			latestVersion = step.Version
		}
		return nil
	})
}
