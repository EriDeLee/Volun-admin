package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/model"
)

func userPhoneV5(db *gorm.DB) error {
	if err := db.AutoMigrate(&model.User{}); err != nil {
		return err
	}
	return db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users (phone) WHERE phone <> ''").Error
}
