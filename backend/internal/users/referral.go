package users

import (
	"strconv"
	"strings"
)

func referralUserID(startParam string) (int64, bool) {
	const prefix = "ref_"
	if !strings.HasPrefix(startParam, prefix) {
		return 0, false
	}
	raw := strings.TrimPrefix(startParam, prefix)
	if raw == "" || len(raw) > 19 || raw[0] == '0' {
		return 0, false
	}
	for _, char := range raw {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}
