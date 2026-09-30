package geocoding

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Service) Cities(ctx context.Context, query string) ([]City, error) {
	key := strings.ToLower(query)
	s.mu.Lock()
	if cached, ok := s.cache[key]; ok && s.now().Before(cached.expires) {
		s.mu.Unlock()
		return cached.cities, nil
	}
	s.mu.Unlock()

	endpoint, err := s.providerEndpoint(false)
	if err != nil {
		return nil, ErrUnavailable
	}
	values := endpoint.Query()
	values.Set("format", "jsonv2")
	values.Set("featureType", "city")
	values.Set("limit", "5")
	values.Set("q", query)
	endpoint.RawQuery = values.Encode()
	body, status, err := s.fetch(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, ErrUpstream
	}

	var data []struct {
		Name string `json:"display_name"`
		Lat  string `json:"lat"`
		Lon  string `json:"lon"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, ErrUpstream
	}
	cities := make([]City, 0, 5)
	for _, item := range data {
		lat, latErr := strconv.ParseFloat(item.Lat, 64)
		lon, lonErr := strconv.ParseFloat(item.Lon, 64)
		if latErr != nil || lonErr != nil || math.IsNaN(lat) || math.IsNaN(lon) || math.Abs(lat) > 90 || math.Abs(lon) > 180 || item.Name == "" {
			continue
		}
		cities = append(cities, City{Name: item.Name, Latitude: lat, Longitude: lon})
		if len(cities) == 5 {
			break
		}
	}
	s.mu.Lock()
	s.pruneCachesLocked()
	s.cache[key] = cachedCities{cities: cities, expires: s.now().Add(24 * time.Hour)}
	s.mu.Unlock()
	return cities, nil
}
