package model

import "strings"

// NormalizePhone stores mainland mobile numbers without their optional +86 prefix.
// Empty values keep existing accounts usable until a number is bound.
func NormalizePhone(value string) (string, bool) {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "+86")
	value = strings.NewReplacer(" ", "", "-", "").Replace(value)
	if value == "" {
		return "", true
	}
	if len(value) != 11 || value[0] != '1' || value[1] < '3' || value[1] > '9' {
		return "", false
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return "", false
		}
	}
	return value, true
}
