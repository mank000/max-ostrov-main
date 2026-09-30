package geocoding

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *Service) Places(ctx context.Context, query, cityName string, latitude, longitude float64) ([]Place, error) {
	cacheKey := strings.ToLower(query) + "|" + strings.ToLower(cityName) + "|" + searchRegionKey(latitude, longitude)
	s.mu.Lock()
	if cached, ok := s.placeCache[cacheKey]; ok && s.now().Before(cached.expires) {
		s.mu.Unlock()
		return cached.places, nil
	}
	s.mu.Unlock()

	region, _, err := s.searchRegionContext(ctx, latitude, longitude)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		region = searchRegion{Name: cityName}
	}

	endpoint, err := s.providerEndpoint(false)
	if err != nil {
		return nil, ErrUnavailable
	}
	providerValues := endpoint.Query()
	providerValues.Set("format", "jsonv2")
	providerValues.Set("addressdetails", "1")
	providerValues.Set("namedetails", "1")
	providerValues.Set("dedupe", "1")
	providerValues.Set("limit", "20")
	providerValues.Set("q", query+", "+region.Name)
	if region.CountryCode != "" {
		providerValues.Set("countrycodes", region.CountryCode)
	}
	endpoint.RawQuery = providerValues.Encode()
	body, status, err := s.fetch(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, ErrUpstream
	}

	var data []struct {
		Name        string  `json:"name"`
		DisplayName string  `json:"display_name"`
		Lat         string  `json:"lat"`
		Lon         string  `json:"lon"`
		Type        string  `json:"type"`
		Category    string  `json:"category"`
		Importance  float64 `json:"importance"`
		Address     struct {
			HouseNumber   string `json:"house_number"`
			Road          string `json:"road"`
			Pedestrian    string `json:"pedestrian"`
			Amenity       string `json:"amenity"`
			Shop          string `json:"shop"`
			Tourism       string `json:"tourism"`
			Leisure       string `json:"leisure"`
			Office        string `json:"office"`
			City          string `json:"city"`
			Town          string `json:"town"`
			Village       string `json:"village"`
			Hamlet        string `json:"hamlet"`
			Municipality  string `json:"municipality"`
			County        string `json:"county"`
			StateDistrict string `json:"state_district"`
			State         string `json:"state"`
		} `json:"address"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, ErrUpstream
	}

	type rankedPlace struct {
		place      Place
		distance   float64
		importance float64
	}
	ranked := make([]rankedPlace, 0, 12)
	seen := make(map[string]struct{}, 20)
	for _, item := range data {
		lat, latErr := strconv.ParseFloat(item.Lat, 64)
		lon, lonErr := strconv.ParseFloat(item.Lon, 64)
		if latErr != nil || lonErr != nil || math.IsNaN(lat) || math.IsNaN(lon) || math.Abs(lat) > 90 || math.Abs(lon) > 180 {
			continue
		}
		itemRegion := firstNonEmpty(item.Address.State, item.Address.StateDistrict, item.Address.County)
		if region.CountryCode != "" && itemRegion != "" && !strings.EqualFold(strings.TrimSpace(itemRegion), strings.TrimSpace(region.Name)) {
			continue
		}
		itemCity := firstNonEmpty(item.Address.City, item.Address.Town, item.Address.Village, item.Address.Hamlet, item.Address.Municipality, item.Address.County)
		road := firstNonEmpty(item.Address.Road, item.Address.Pedestrian)
		title := firstNonEmpty(item.Name, item.Address.Amenity, item.Address.Shop, item.Address.Tourism, item.Address.Leisure, item.Address.Office, streetAddress(road, item.Address.HouseNumber))
		if title == "" && item.DisplayName != "" {
			title = strings.TrimSpace(strings.Split(item.DisplayName, ",")[0])
		}
		title = truncateRunes(title, 160)
		if title == "" {
			continue
		}
		scope := "region"
		if samePlaceName(itemCity, cityName) {
			scope = "city"
		}
		key := strings.ToLower(title) + "|" + strconv.FormatFloat(lat, 'f', 5, 64) + "|" + strconv.FormatFloat(lon, 'f', 5, 64)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		ranked = append(ranked, rankedPlace{
			place: Place{
				Title:     title,
				Subtitle:  truncateRunes(item.DisplayName, 220),
				City:      truncateRunes(itemCity, 100),
				Region:    truncateRunes(itemRegion, 120),
				Latitude:  lat,
				Longitude: lon,
				Scope:     scope,
				Category:  truncateRunes(firstNonEmpty(item.Category, item.Type), 80),
			},
			distance:   approximateDistance(latitude, longitude, lat, lon),
			importance: item.Importance,
		})
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].place.Scope != ranked[j].place.Scope {
			return ranked[i].place.Scope == "city"
		}
		if math.Abs(ranked[i].distance-ranked[j].distance) > 0.000001 {
			return ranked[i].distance < ranked[j].distance
		}
		return ranked[i].importance > ranked[j].importance
	})
	places := make([]Place, 0, min(12, len(ranked)))
	for _, item := range ranked {
		places = append(places, item.place)
		if len(places) == 12 {
			break
		}
	}
	s.mu.Lock()
	s.pruneCachesLocked()
	s.placeCache[cacheKey] = cachedPlaces{places: places, expires: s.now().Add(12 * time.Hour)}
	s.mu.Unlock()
	return places, nil
}
