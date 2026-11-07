package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/model"
)

func activityV3(db *gorm.DB) error {
	return db.AutoMigrate(&model.Project{})
}
