package activity

import "slices"

// Legacy single-assignment records remain readable without a data migration.
func memberAssignments(m Member) []Assignment {
	if len(m.Assignments) > 0 {
		return m.Assignments
	}
	return []Assignment{{SessionID: m.SessionID, PositionID: m.PositionID}}
}

func normalizeMember(m *Member) {
	if len(m.Assignments) > 0 {
		m.SessionID = m.Assignments[0].SessionID
		m.PositionID = m.Assignments[0].PositionID
	}
}

func memberAssigned(m Member, sessionID string) bool {
	for _, a := range memberAssignments(m) {
		if a.SessionID == sessionID {
			return true
		}
	}
	return false
}

func assignmentsValid(m Member, basics Basics) bool {
	seen := map[Assignment]bool{}
	assignments := memberAssignments(m)
	if len(assignments) == 0 || len(assignments) > 100 {
		return false
	}
	for _, a := range assignments {
		if !assigned(basics, a.SessionID, a.PositionID) || seen[a] {
			return false
		}
		seen[a] = true
	}
	return true
}

func sameAssignments(a, b Member) bool {
	left, right := memberAssignments(a), memberAssignments(b)
	if len(left) != len(right) {
		return false
	}
	for _, choice := range left {
		if !slices.Contains(right, choice) {
			return false
		}
	}
	return true
}

func hasCapacity(m Member, state State) bool {
	for _, choice := range memberAssignments(m) {
		count := 0
		for _, old := range state.Members {
			if old.ID != m.ID && slices.Contains(memberAssignments(old), choice) {
				count++
			}
		}
		for _, session := range state.Basics.Sessions {
			if session.ID != choice.SessionID {
				continue
			}
			for _, position := range session.Positions {
				if position.ID == choice.PositionID && count >= position.Capacity {
					return false
				}
			}
		}
	}
	return true
}
