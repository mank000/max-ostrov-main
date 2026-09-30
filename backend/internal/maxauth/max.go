package maxauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *Service) ValidateMAX(initData string) (User, error) {
	user, authenticatedAt, err := s.readMAXIdentity(initData)
	if err != nil {
		return User{}, err
	}
	if s.now().Sub(authenticatedAt) > s.maxAge {
		return User{}, ErrExpiredInitData
	}
	return user, nil
}

func (s *Service) ResumeMAX(initData, token string) (Session, error) {
	user, _, err := s.readMAXIdentity(initData)
	if err != nil {
		return Session{}, err
	}
	return s.resumeSession(user.ProviderUserID, token)
}

func (s *Service) readMAXIdentity(initData string) (User, time.Time, error) {
	if s.botToken == "" {
		return User{}, time.Time{}, ErrUnavailable
	}
	values, err := url.ParseQuery(initData)
	if err != nil {
		return User{}, time.Time{}, ErrInvalidInitData
	}
	for _, entries := range values {
		if len(entries) != 1 {
			return User{}, time.Time{}, ErrInvalidInitData
		}
	}
	// Decode each parameter once. Decoding the entire query first turns encoded
	// '&' and '+' in names or avatar URLs into query delimiters and corrupts HMAC.
	// https://dev.max.ru/docs/webapps/validation
	signature, err := hex.DecodeString(values.Get("hash"))
	if err != nil || len(signature) != sha256.Size {
		return User{}, time.Time{}, ErrInvalidInitData
	}
	values.Del("hash")
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+values.Get(key))
	}
	secret := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = secret.Write([]byte(s.botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	_, _ = mac.Write([]byte(strings.Join(parts, "\n")))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return User{}, time.Time{}, ErrInvalidInitData
	}
	var user User
	if err := json.Unmarshal([]byte(values.Get("user")), &user); err != nil || user.ID <= 0 {
		return User{}, time.Time{}, ErrInvalidInitData
	}
	authDate, err := strconv.ParseInt(values.Get("auth_date"), 10, 64)
	if err != nil || authDate <= 0 {
		return User{}, time.Time{}, ErrInvalidInitData
	}

	now := s.now()
	authenticatedAt := time.Unix(authDate, 0)
	if authenticatedAt.After(now.Add(time.Minute)) {
		return User{}, time.Time{}, ErrExpiredInitData
	}

	startParam := values.Get("start_param")
	if len(startParam) > 512 {
		return User{}, time.Time{}, ErrInvalidInitData
	}
	user.ProviderUserID = user.ID
	user.StartParam = startParam
	return user, authenticatedAt, nil
}
