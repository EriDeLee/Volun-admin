package activity

import "testing"

func TestBasicsBeijingCalendarRange(t *testing.T) {
	for _, tc := range []struct {
		name, start, end string
		valid            bool
	}{
		{"UTC early morning", "2026-11-13T16:00:00.000Z", "2026-11-13T18:40:00.000Z", true},
		{"equivalent offset", "2026-11-14T00:00:00+08:00", "2026-11-14T02:40:00+08:00", true},
		{"start before project", "2026-11-13T14:40:00.000Z", "2026-11-13T18:40:00.000Z", false},
		{"end after project", "2026-11-14T14:00:00Z", "2026-11-14T16:00:00Z", false},
		{"late evening", "2026-11-14T14:00:00Z", "2026-11-14T15:59:59Z", true},
		{"end before start", "2026-11-14T02:00:00+08:00", "2026-11-14T01:00:00+08:00", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := Basics{Name: "test", Department: "123", StartsOn: "2026-11-14", EndsOn: "2026-11-14", Location: "123", Sessions: []Session{{ID: "session", Name: "test", Start: tc.start, End: tc.end, Positions: []Position{{ID: "position", Name: "岗位", Capacity: 1}}}}}
			if got := basicsValid(b); got != tc.valid {
				t.Fatalf("basicsValid() = %v, want %v", got, tc.valid)
			}
		})
	}
}

func TestBasicsIncludesFullStartAndEndDays(t *testing.T) {
	b := Basics{Name: "test", Department: "123", StartsOn: "2026-11-13", EndsOn: "2026-11-14", Location: "123", Sessions: []Session{{ID: "session", Name: "test", Start: "2026-11-13T00:00:00+08:00", End: "2026-11-14T23:59:59.999999999+08:00", Positions: []Position{{ID: "position", Name: "岗位", Capacity: 1}}}}}
	if !basicsValid(b) {
		t.Fatal("full project start and end dates should be included")
	}
	b.Sessions[0].Start = "2026-11-13T14:40:00.000Z"
	b.Sessions[0].End = "2026-11-13T18:40:00.000Z"
	if !basicsValid(b) {
		t.Fatal("reported overnight session should fit November 13 through 14")
	}
	b.Sessions[0].End = "2026-11-15T00:00:00+08:00"
	if basicsValid(b) {
		t.Fatal("next day midnight is outside the project date range")
	}
}
