package rewards

import "time"

const DailyGameCoins = 30

// День один для всех устройств; смена часового пояса не выдаёт новый лимит.
func gameRewardDay(now time.Time) time.Time { return now.UTC().Truncate(24 * time.Hour) }

func availableGameCoins(wanted, earned int) int {
	return max(0, min(wanted, DailyGameCoins-max(0, earned)))
}
