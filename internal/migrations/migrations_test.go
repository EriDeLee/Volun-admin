package migrations

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"volun-data/internal/auth"
	"volun-data/internal/migration"
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
	for _, model := range []any{&auth.User{}, &auth.Session{}, &auth.LoginTransaction{}} {
		if !db.Migrator().HasTable(model) {
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
	if len(records) != 2 || records[0].Version != 0 || records[1].Version != 1 {
		t.Fatalf("unexpected versions: %+v", records)
	}
}
