package geocoding

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Service) searchRegionContext(ctx context.Context, latitude, longitude float64) (searchRegion, bool, error) {
	key := searchRegionKey(latitude, longitude)
	s.mu.Lock()
	if cached, ok := s.regionCache[key]; ok && s.now().Before(cached.expires) {
		s.mu.Unlock()
		return cached.region, false, nil
	}
	s.mu.Unlock()

	endpoint, err := s.providerEndpoint(true)
	if err != nil {
		return searchRegion{}, false, err
	}
	values := endpoint.Query()
	values.Set("format", "jsonv2")
	values.Set("addressdetails", "1")
	values.Set("zoom", "10")
	values.Set("lat", strconv.FormatFloat(latitude, 'f', 7, 64))
	values.Set("lon", strconv.FormatFloat(longitude, 'f', 7, 64))
	endpoint.RawQuery = values.Encode()
	body, status, err := s.fetch(ctx, endpoint)
	if err != nil {
		return searchRegion{}, true, err
	}
	if status != http.StatusOK {
		return searchRegion{}, true, ErrUpstream
	}

	var data struct {
		Address struct {
			State         string `json:"state"`
			StateDistrict string `json:"state_district"`
			County        string `json:"county"`
			CountryCode   string `json:"country_code"`
		} `json:"address"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return searchRegion{}, true, err
	}
	region := searchRegion{
		Name:        truncateRunes(firstNonEmpty(data.Address.State, data.Address.StateDistrict, data.Address.County), 120),
		CountryCode: strings.ToLower(strings.TrimSpace(data.Address.CountryCode)),
	}
	if region.Name == "" {
		return searchRegion{}, true, errors.New("region not found")
	}
	s.mu.Lock()
	s.pruneCachesLocked()
	s.regionCache[key] = cachedSearchRegion{region: region, expires: s.now().Add(24 * time.Hour)}
	s.mu.Unlock()
	return region, true, nil
}
