package geocoding

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type cachedCities struct {
	cities  []City
	expires time.Time
}

type cachedReverseLocation struct {
	location Location
	expires  time.Time
}

type cachedPlaces struct {
	places  []Place
	expires time.Time
}

type cachedSearchRegion struct {
	region  searchRegion
	expires time.Time
}

type Service struct {
	endpoint     string
	client       *http.Client
	now          func() time.Time
	mu           sync.Mutex
	cache        map[string]cachedCities
	reverseCache map[string]cachedReverseLocation
	placeCache   map[string]cachedPlaces
	regionCache  map[string]cachedSearchRegion
	sleep        func(context.Context, time.Duration) error
	gate         chan struct{}
	inflight     map[string]*providerCall
	responses    map[string]providerResult
	interval     time.Duration
	next         time.Time
}

func New(endpoint string) *Service {
	if endpoint == "" {
		endpoint = "https://nominatim.openstreetmap.org/search"
	}
	return &Service{
		endpoint: endpoint,
		client: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		now:          time.Now,
		cache:        make(map[string]cachedCities),
		reverseCache: make(map[string]cachedReverseLocation),
		placeCache:   make(map[string]cachedPlaces),
		regionCache:  make(map[string]cachedSearchRegion),
		sleep:        sleepContext,
		gate:         make(chan struct{}, 1),
		inflight:     make(map[string]*providerCall),
		responses:    make(map[string]providerResult),
		interval:     time.Second,
	}
}
func (s *Service) providerEndpoint(reverse bool) (*url.URL, error) {
	endpoint, err := url.Parse(s.endpoint)
	if err != nil {
		return nil, err
	}
	if endpoint.Host == "" || endpoint.User != nil || endpoint.Fragment != "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") {
		return nil, errors.New("invalid geocoding endpoint")
	}
	if reverse {
		path := strings.TrimRight(endpoint.Path, "/")
		if strings.HasSuffix(path, "/search") {
			endpoint.Path = strings.TrimSuffix(path, "/search") + "/reverse"
		}
	}
	return endpoint, nil
}
func providerRequest(ctx context.Context, endpoint *url.URL) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Language", "ru")
	request.Header.Set("User-Agent", "Kutezh/1.0 (https://kutezh-social.ru; geocoding)")
	return request, nil
}
func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
