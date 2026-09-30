package geocoding

import (
	"math"
	"strconv"
	"strings"
)

func searchRegionKey(latitude, longitude float64) string {
	return strconv.FormatFloat(latitude, 'f', 3, 64) + "," + strconv.FormatFloat(longitude, 'f', 3, 64)
}
func normalizePlaceName(value string) string {
	value = strings.TrimSpace(value)
	if comma := strings.IndexByte(value, ','); comma >= 0 {
		value = value[:comma]
	}
	return strings.ToLower(strings.TrimSpace(value))
}
func samePlaceName(left, right string) bool {
	return normalizePlaceName(left) == normalizePlaceName(right)
}
func approximateDistance(latitude, longitude, otherLatitude, otherLongitude float64) float64 {
	cosLatitude := math.Cos(latitude * math.Pi / 180)
	dLat := otherLatitude - latitude
	dLon := math.Remainder(otherLongitude-longitude, 360) * cosLatitude
	return dLat*dLat + dLon*dLon
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
func streetAddress(road, house string) string {
	road = strings.TrimSpace(road)
	house = strings.TrimSpace(house)
	if road == "" {
		return ""
	}
	if house == "" {
		return road
	}
	return road + ", " + house
}
func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
