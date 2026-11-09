package activity

import (
	"time"

	"volun-data/internal/model"
)

func preparationConfirmed(p model.Project) bool {
	if p.Approval != "approved" {
		return false
	}
	switch p.Status {
	case "进行", "结项", "意向", "统计", "数据", "录入", "审核", "通过", "驳回":
		return true
	}
	return false
}

// The first session is the one with the earliest start, not the earliest end.
func firstSessionEnd(b Basics) (time.Time, bool) {
	var firstStart, firstEnd time.Time
	for _, session := range b.Sessions {
		start, startErr := time.Parse(time.RFC3339, session.Start)
		end, endErr := time.Parse(time.RFC3339, session.End)
		if startErr != nil || endErr != nil || !end.After(start) {
			return time.Time{}, false
		}
		if firstStart.IsZero() || start.Before(firstStart) {
			firstStart, firstEnd = start, end
		}
	}
	return firstEnd, !firstEnd.IsZero()
}

func hoursAvailable(p model.Project, b Basics, now time.Time) bool {
	end, ok := firstSessionEnd(b)
	return preparationConfirmed(p) && ok && !now.Before(end)
}
