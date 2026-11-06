package database

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"volun-data/internal/config"
)

func TestSQLitePersistenceAndForeignKeys(t *testing.T) {
	cfg := config.Database{Driver: "sqlite", SQLitePath: filepath.Join(t.TempDir(), "nested", "local.db"), ConnectTimeout: time.Second}
	db, err := Open(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	for _, sql := range []string{
		"CREATE TABLE parents (id INTEGER PRIMARY KEY)",
		"CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))",
		"INSERT INTO parents (id) VALUES (1)",
		"INSERT INTO children (id, parent_id) VALUES (1, 1)",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec("INSERT INTO children (id, parent_id) VALUES (2, 999)").Error; err == nil {
		t.Fatal("foreign key violation was accepted")
	}
	if err := pool.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	reopenedPool, err := reopened.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopenedPool.Close() })
	var count int64
	if err := reopened.Table("children").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("persisted rows = %d, want 1", count)
	}
}

func TestSQLiteMemoryDatabaseSurvivesConnectionReuse(t *testing.T) {
	db, err := Open(context.Background(), config.Database{Driver: "sqlite", SQLitePath: ":memory:", ConnectTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Exec("CREATE TABLE sample (id INTEGER PRIMARY KEY)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO sample (id) VALUES (1)").Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Table("sample").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("memory rows = %d, want 1", count)
	}
}
