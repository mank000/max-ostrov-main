package httpapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"kutezh/backend/internal/geocoding"
)

type citySearch struct{ client *geocoding.Service }

func newCitySearch(endpoint string) *citySearch {
	return &citySearch{client: geocoding.New(endpoint)}
}

func writeGeocodingError(w http.ResponseWriter, r *http.Request, err error) {
	if r.Context().Err() != nil {
		return
	}
	switch {
	case errors.Is(err, geocoding.ErrBusy):
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusTooManyRequests, "geocoding_busy", "Поиск занят. Повторите запрос через секунду.")
	case errors.Is(err, geocoding.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "geocoding_unavailable", "Поиск мест временно недоступен")
	default:
		writeError(w, http.StatusBadGateway, "geocoding_failed", "Не удалось загрузить адрес. Попробуйте ещё раз.")
	}
}

func (s *citySearch) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(r.URL.Query()) != 1 || len(r.URL.Query()["q"]) != 1 || utf8.RuneCountInString(query) < 2 || utf8.RuneCountInString(query) > 80 {
		writeError(w, http.StatusBadRequest, "invalid_city_query", "Введите от 2 до 80 символов для поиска города")
		return
	}
	result, err := s.client.Cities(r.Context(), query)
	if err != nil {
		writeGeocodingError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cities": result})
}

func (s *citySearch) ServePlaceSearchHTTP(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	query := strings.TrimSpace(values.Get("q"))
	cityName := strings.TrimSpace(values.Get("city"))
	if len(values) != 4 || len(values["q"]) != 1 || len(values["city"]) != 1 || len(values["latitude"]) != 1 || len(values["longitude"]) != 1 ||
		utf8.RuneCountInString(query) < 2 || utf8.RuneCountInString(query) > 80 || utf8.RuneCountInString(cityName) < 1 || utf8.RuneCountInString(cityName) > 120 {
		writeError(w, http.StatusBadRequest, "invalid_place_query", "Укажите место и выбранный город")
		return
	}
	latitude, latErr := strconv.ParseFloat(values.Get("latitude"), 64)
	longitude, lonErr := strconv.ParseFloat(values.Get("longitude"), 64)
	if latErr != nil || lonErr != nil || math.IsNaN(latitude) || math.IsInf(latitude, 0) || math.IsNaN(longitude) || math.IsInf(longitude, 0) ||
		math.Abs(latitude) > 90 || math.Abs(longitude) > 180 {
		writeError(w, http.StatusBadRequest, "invalid_place_query", "Некорректный выбранный город")
		return
	}

	result, err := s.client.Places(r.Context(), query, cityName, latitude, longitude)
	if err != nil {
		writeGeocodingError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"places": result})
}

func (s *citySearch) ServeReverseHTTP(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	if len(values) != 2 || len(values["latitude"]) != 1 || len(values["longitude"]) != 1 {
		writeError(w, http.StatusBadRequest, "invalid_location_query", "Передайте одну широту и одну долготу")
		return
	}
	latitude, latErr := strconv.ParseFloat(values.Get("latitude"), 64)
	longitude, lonErr := strconv.ParseFloat(values.Get("longitude"), 64)
	if latErr != nil || lonErr != nil || math.IsNaN(latitude) || math.IsInf(latitude, 0) || math.IsNaN(longitude) || math.IsInf(longitude, 0) ||
		math.Abs(latitude) > 90 || math.Abs(longitude) > 180 {
		writeError(w, http.StatusBadRequest, "invalid_location_query", "Некорректная точка на карте")
		return
	}
	result, err := s.client.Reverse(r.Context(), latitude, longitude)
	if err != nil {
		writeGeocodingError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"location": result})
}
