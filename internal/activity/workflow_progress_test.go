package activity

import (
	"testing"
	"time"

	"volun-data/internal/model"
)

func TestHoursAvailableAfterFirstSession(t *testing.T) {
	basics := Basics{Sessions: []Session{
		{ID: "second", Start: "2026-11-09T10:00:00+08:00", End: "2026-11-09T11:00:00+08:00"},
		{ID: "first", Start: "2026-11-09T08:00:00+08:00", End: "2026-11-09T12:00:00+08:00"},
	}}
	for _, tc := range []struct {
		name, approval, status, now string
		want                        bool
	}{
		{"second session ended but first still running", "approved", "进行", "2026-11-09T11:59:59+08:00", false},
		{"exact first end", "approved", "进行", "2026-11-09T12:00:00+08:00", true},
		{"UTC equivalent", "approved", "进行", "2026-11-09T04:00:00Z", true},
		{"later stage", "approved", "数据", "2026-11-09T13:00:00+08:00", true},
		{"preparation unconfirmed", "approved", "招募", "2026-11-09T13:00:00+08:00", false},
		{"approval pending", "pending", "进行", "2026-11-09T13:00:00+08:00", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now, err := time.Parse(time.RFC3339, tc.now)
			if err != nil {
				t.Fatal(err)
			}
			if got := hoursAvailable(model.Project{Approval: tc.approval, Status: tc.status}, basics, now); got != tc.want {
				t.Fatalf("hoursAvailable() = %v, want %v", got, tc.want)
			}
		})
	}
	for _, tc := range []struct {
		name   string
		basics Basics
	}{
		{"no sessions", Basics{}},
		{"invalid end", Basics{Sessions: []Session{{Start: "2026-11-09T08:00:00Z", End: "invalid"}}}},
		{"reversed range", Basics{Sessions: []Session{{Start: "2026-11-09T08:00:00Z", End: "2026-11-09T07:00:00Z"}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if hoursAvailable(model.Project{Approval: "approved", Status: "进行"}, tc.basics, time.Now()) {
				t.Fatal("invalid schedule unlocked hours")
			}
		})
	}
}
