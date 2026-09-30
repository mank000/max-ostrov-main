package geocoding

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type providerResult struct {
	body    []byte
	status  int
	expires time.Time
}

type providerCall struct {
	done     chan struct{}
	cancel   context.CancelFunc
	waiters  int
	result   providerResult
	err      error
	complete bool
}

func (s *Service) fetch(ctx context.Context, endpoint *url.URL) ([]byte, int, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	key := endpoint.String()
	s.mu.Lock()
	if result, ok := s.responses[key]; ok && s.now().Before(result.expires) {
		s.mu.Unlock()
		return result.body, result.status, nil
	}
	call, exists := s.inflight[key]
	if !exists {
		if len(s.inflight) >= 32 {
			s.mu.Unlock()
			return nil, 0, ErrBusy
		}
		shared, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		call = &providerCall{done: make(chan struct{}), cancel: cancel}
		s.inflight[key] = call
		go s.runLookup(shared, key, endpoint, call)
	}
	call.waiters++
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		call.waiters--
		if call.waiters == 0 && !call.complete {
			if s.inflight[key] == call {
				delete(s.inflight, key)
			}
			call.cancel()
		}
		s.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	case <-call.done:
		return call.result.body, call.result.status, call.err
	}
}

func (s *Service) runLookup(ctx context.Context, key string, endpoint *url.URL, call *providerCall) {
	result, err := s.queryProvider(ctx, endpoint)
	s.mu.Lock()
	call.result, call.err, call.complete = result, err, true
	if err == nil && (result.status == http.StatusOK || result.status == http.StatusNotFound) {
		now := s.now()
		for candidate, cached := range s.responses {
			if !now.Before(cached.expires) {
				delete(s.responses, candidate)
			}
		}
		if len(s.responses) >= 512 {
			for candidate := range s.responses {
				delete(s.responses, candidate)
				break
			}
		}
		result.expires = now.Add(15 * time.Minute)
		s.responses[key] = result
	}
	if s.inflight[key] == call {
		delete(s.inflight, key)
	}
	close(call.done)
	s.mu.Unlock()
	call.cancel()
}

func (s *Service) queryProvider(ctx context.Context, endpoint *url.URL) (providerResult, error) {
	select {
	case s.gate <- struct{}{}:
	case <-ctx.Done():
		return providerResult{}, ctx.Err()
	}
	defer func() { <-s.gate }()
	s.mu.Lock()
	delay := s.next.Sub(s.now())
	s.mu.Unlock()
	if delay > 0 {
		if err := s.sleep(ctx, delay); err != nil {
			return providerResult{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return providerResult{}, err
	}
	request, err := providerRequest(ctx, endpoint)
	if err != nil {
		return providerResult{}, ErrUnavailable
	}
	s.mu.Lock()
	s.next = s.now().Add(s.interval)
	s.mu.Unlock()
	response, err := s.client.Do(request)
	if err != nil {
		return providerResult{}, ErrUpstream
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusServiceUnavailable {
		delay := 5 * time.Second
		if seconds, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && seconds > 0 {
			delay = time.Duration(min(seconds, 60)) * time.Second
		} else if date, err := http.ParseTime(response.Header.Get("Retry-After")); err == nil && date.After(s.now()) {
			delay = min(date.Sub(s.now()), time.Minute)
		}
		s.mu.Lock()
		s.next = s.now().Add(delay)
		s.mu.Unlock()
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (512<<10)+1))
	if err != nil || len(body) > 512<<10 || (response.StatusCode == http.StatusOK && !json.Valid(body)) {
		return providerResult{}, ErrUpstream
	}
	return providerResult{body: body, status: response.StatusCode}, nil
}
