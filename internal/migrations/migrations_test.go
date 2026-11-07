package migrations

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"volun-data/internal/migration"
	"volun-data/internal/model"
)

func TestInitializeV0AndUpgradeOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := migration.Run(db, All()[:1]); err != nil {
		t.Fatal(err)
	}
	for _, entity := range []any{&model.User{}, &model.Session{}, &model.LoginTransaction{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatal("v0 did not initialize authentication schema")
		}
	}
	for range 2 {
		if err := migration.Run(db, All()); err != nil {
			t.Fatal(err)
		}
	}
	var records []migration.Record
	if err := db.Order("version").Find(&records).Error; err != nil {
		t.Fatal(err)
	}
	if len(records) != 4 || records[0].Version != 0 || records[1].Version != 1 || records[2].Version != 2 || records[3].Version != 3 {
		t.Fatalf("unexpected versions: %+v", records)
	}
}
