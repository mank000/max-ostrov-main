package geocoding

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *Service) Reverse(ctx context.Context, latitude, longitude float64) (Location, error) {
	key := strconv.FormatFloat(latitude, 'f', 5, 64) + "," + strconv.FormatFloat(longitude, 'f', 5, 64)
	s.mu.Lock()
	if cached, ok := s.reverseCache[key]; ok && s.now().Before(cached.expires) {
		s.mu.Unlock()
		return cached.location, nil
	}
	s.mu.Unlock()

	endpoint, err := s.providerEndpoint(true)
	if err != nil {
		return Location{}, ErrUnavailable
	}
	providerValues := endpoint.Query()
	providerValues.Set("format", "jsonv2")
	providerValues.Set("addressdetails", "1")
	providerValues.Set("zoom", "18")
	providerValues.Set("lat", strconv.FormatFloat(latitude, 'f', 7, 64))
	providerValues.Set("lon", strconv.FormatFloat(longitude, 'f', 7, 64))
	endpoint.RawQuery = providerValues.Encode()
	body, status, err := s.fetch(ctx, endpoint)
	if err != nil {
		return Location{}, err
	}
	if status == http.StatusNotFound {
		location := Location{}
		s.storeReverse(key, location)
		return location, nil
	}
	if status != http.StatusOK {
		return Location{}, ErrUpstream
	}

	var data struct {
		Name    string `json:"name"`
		Error   string `json:"error"`
		Address struct {
			HouseNumber   string `json:"house_number"`
			Road          string `json:"road"`
			Pedestrian    string `json:"pedestrian"`
			Footway       string `json:"footway"`
			Path          string `json:"path"`
			Amenity       string `json:"amenity"`
			Leisure       string `json:"leisure"`
			Tourism       string `json:"tourism"`
			Building      string `json:"building"`
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
		return Location{}, ErrUpstream
	}
	if data.Error != "" {
		return Location{}, ErrUpstream
	}
	location := Location{}
	road := firstNonEmpty(data.Address.Road, data.Address.Pedestrian, data.Address.Footway, data.Address.Path)
	location.VenueName = truncateRunes(firstNonEmpty(data.Name, data.Address.Amenity, data.Address.Leisure, data.Address.Tourism, data.Address.Building), 160)
	location.Address = truncateRunes(streetAddress(road, data.Address.HouseNumber), 240)
	location.City = truncateRunes(firstNonEmpty(
		data.Address.City,
		data.Address.Town,
		data.Address.Village,
		data.Address.Hamlet,
		data.Address.Municipality,
		data.Address.County,
		data.Address.StateDistrict,
		data.Address.State,
	), 80)
	s.storeReverse(key, location)
	return location, nil
}
