package idempotency

const MaxKeyLength = 128

func ValidKey(key string) bool {
	if len(key) < 1 || len(key) > MaxKeyLength {
		return false
	}
	for _, character := range []byte(key) {
		valid := character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || character == '-' || character == '_' ||
			character == '.' || character == ':'
		if !valid {
			return false
		}
	}
	return true
}
