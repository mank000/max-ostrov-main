package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"kutezh/backend/internal/events"
)

func parseNearbyQuery(r *http.Request) (events.NearbyQuery, bool) {
	values := r.URL.Query()
	allowed := map[string]bool{"latitude": true, "longitude": true, "radius_meters": true}
	if len(values) != len(allowed) {
		return events.NearbyQuery{}, false
	}
	for key, entries := range values {
		if !allowed[key] || len(entries) != 1 {
			return events.NearbyQuery{}, false
		}
	}

	latitude, err := strconv.ParseFloat(values.Get("latitude"), 64)
	if err != nil {
		return events.NearbyQuery{}, false
	}
	longitude, err := strconv.ParseFloat(values.Get("longitude"), 64)
	if err != nil {
		return events.NearbyQuery{}, false
	}
	radius, err := strconv.ParseInt(values.Get("radius_meters"), 10, 64)
	if err != nil {
		return events.NearbyQuery{}, false
	}
	return events.NearbyQuery{Latitude: latitude, Longitude: longitude, RadiusMeters: radius}, true
}

func parseViewportQuery(r *http.Request) (events.ViewportQuery, bool) {
	values := r.URL.Query()
	allowed := map[string]bool{"west": true, "south": true, "east": true, "north": true, "after_id": true}
	for key, entries := range values {
		if !allowed[key] || len(entries) != 1 {
			return events.ViewportQuery{}, false
		}
	}
	for _, key := range []string{"west", "south", "east", "north"} {
		if values.Get(key) == "" {
			return events.ViewportQuery{}, false
		}
	}
	parseCoordinate := func(key string) (float64, bool) {
		value, err := strconv.ParseFloat(values.Get(key), 64)
		return value, err == nil
	}
	west, ok := parseCoordinate("west")
	if !ok {
		return events.ViewportQuery{}, false
	}
	south, ok := parseCoordinate("south")
	if !ok {
		return events.ViewportQuery{}, false
	}
	east, ok := parseCoordinate("east")
	if !ok {
		return events.ViewportQuery{}, false
	}
	north, ok := parseCoordinate("north")
	if !ok {
		return events.ViewportQuery{}, false
	}
	var afterID int64
	if value := values.Get("after_id"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed <= 0 {
			return events.ViewportQuery{}, false
		}
		afterID = parsed
	}
	return events.ViewportQuery{West: west, South: south, East: east, North: north, AfterID: afterID}, true
}

func parseEventFilter(r *http.Request) (events.Filter, bool) {
	values := r.URL.Query()
	allowed := map[string]bool{
		"category": true, "city": true, "starts_from": true,
		"starts_to": true, "price_max_rubles": true,
	}
	for key, entries := range values {
		if !allowed[key] || len(entries) != 1 {
			return events.Filter{}, false
		}
	}
	filter := events.Filter{Category: values.Get("category"), City: values.Get("city")}
	for key, target := range map[string]**time.Time{
		"starts_from": &filter.StartsFrom,
		"starts_to":   &filter.StartsTo,
	} {
		if value := values.Get(key); value != "" {
			parsed, err := time.Parse(time.RFC3339, value)
			if err != nil {
				return events.Filter{}, false
			}
			*target = &parsed
		}
	}
	if value := values.Get("price_max_rubles"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return events.Filter{}, false
		}
		filter.PriceMaxRubles = &parsed
	}
	return filter, true
}
