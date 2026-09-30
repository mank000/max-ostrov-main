package rewards

// Неизвестный вид товара нельзя молча списать без выдачи.
func validatePurchaseItem(item Item, input PurchaseInput) error {
	if item.CoinPrice <= 0 {
		return ErrInvalidInput
	}
	switch item.Kind {
	case "profile_decoration":
		if input.TargetEventID != nil {
			return ErrInvalidInput
		}
	case "profile_boost", "event_boost":
		if item.DurationHours == nil || *item.DurationHours <= 0 {
			return ErrInvalidInput
		}
		if item.Kind == "event_boost" {
			if input.TargetEventID == nil || *input.TargetEventID <= 0 {
				return ErrInvalidInput
			}
		} else if input.TargetEventID != nil {
			return ErrInvalidInput
		}
	default:
		// Подарки отправляются отдельным методом: там проверяются получатель и дружба.
		return ErrInvalidInput
	}
	return nil
}
