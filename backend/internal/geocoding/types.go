package geocoding

import (
	"errors"
)

type City struct {
	Name      string  `json:"name"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type Place struct {
	Title     string  `json:"title"`
	Subtitle  string  `json:"subtitle"`
	City      string  `json:"city"`
	Region    string  `json:"region"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Scope     string  `json:"scope"`
	Category  string  `json:"category,omitempty"`
}

type searchRegion struct {
	Name        string
	CountryCode string
}

type Location struct {
	VenueName string `json:"venue_name"`
	Address   string `json:"address"`
	City      string `json:"city"`
}

var (
	ErrBusy        = errors.New("geocoding busy")
	ErrUnavailable = errors.New("geocoding unavailable")
	ErrUpstream    = errors.New("geocoding request failed")
)
