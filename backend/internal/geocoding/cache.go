package geocoding

import (
	"time"
)

func (s *Service) pruneCachesLocked() {
	now := s.now()
	for name, cached := range s.cache {
		if !now.Before(cached.expires) {
			delete(s.cache, name)
		}
	}
	for key, cached := range s.reverseCache {
		if !now.Before(cached.expires) {
			delete(s.reverseCache, key)
		}
	}
	for key, cached := range s.placeCache {
		if !now.Before(cached.expires) {
			delete(s.placeCache, key)
		}
	}
	for key, cached := range s.regionCache {
		if !now.Before(cached.expires) {
			delete(s.regionCache, key)
		}
	}
	if len(s.cache) >= 256 {
		for name := range s.cache {
			delete(s.cache, name)
			break
		}
	}
	if len(s.reverseCache) >= 512 {
		for key := range s.reverseCache {
			delete(s.reverseCache, key)
			break
		}
	}
	if len(s.placeCache) >= 512 {
		for key := range s.placeCache {
			delete(s.placeCache, key)
			break
		}
	}
	if len(s.regionCache) >= 256 {
		for key := range s.regionCache {
			delete(s.regionCache, key)
			break
		}
	}
}
func (s *Service) storeReverse(key string, location Location) {
	s.mu.Lock()
	s.pruneCachesLocked()
	s.reverseCache[key] = cachedReverseLocation{location: location, expires: s.now().Add(24 * time.Hour)}
	s.mu.Unlock()
}
