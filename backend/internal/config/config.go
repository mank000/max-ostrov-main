package config

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHTTPAddress     = "127.0.0.1:8080"
	defaultShutdownTimeout = 10 * time.Second
	defaultMaxAuthMaxAge   = 5 * time.Minute
	defaultSessionTTL      = 24 * time.Hour
	defaultMediaDirectory  = "./var/media"
)

type Config struct {
	PublicURL             string
	ModerationURL         string
	MaintenanceAllowedIDs map[int64]bool
	HTTPAddress           string
	ShutdownTimeout       time.Duration
	MaxBotToken           string
	SupportOwnerMAXID     int64
	MaxAuthMaxAge         time.Duration
	SessionTTL            time.Duration
	SessionCookieSecure   bool
	DatabaseURL           string
	MediaDirectory        string
	GeocodingURL          string
	GeocodingAutocomplete bool
	MediaXAccel           bool
	ModerationHost        string
	ModerationOTPKey      string
	FaceAIURL             string
	ImageAIURL            string
	TextAIURL             string
	TextAIMode            string
}

func Load() (Config, error) {
	databaseURL, err := readSecret("KUTEZH_DATABASE_URL")
	if err != nil {
		return Config{}, err
	}
	botToken, err := readSecret("KUTEZH_BOT_TOKEN")
	if err != nil {
		return Config{}, err
	}
	moderationKey, err := readSecret("KUTEZH_MODERATION_OTP_KEY")
	if err != nil {
		return Config{}, err
	}
	config := Config{
		PublicURL:           strings.TrimRight(strings.TrimSpace(os.Getenv("KUTEZH_PUBLIC_URL")), "/"),
		ModerationURL:       strings.TrimRight(strings.TrimSpace(os.Getenv("KUTEZH_MODERATION_URL")), "/"),
		GeocodingURL:        envOrDefault("KUTEZH_GEOCODING_URL", "https://nominatim.openstreetmap.org/search"),
		HTTPAddress:         envOrDefault("KUTEZH_HTTP_ADDR", defaultHTTPAddress),
		ShutdownTimeout:     defaultShutdownTimeout,
		MaxBotToken:         botToken,
		MaxAuthMaxAge:       defaultMaxAuthMaxAge,
		SessionTTL:          defaultSessionTTL,
		SessionCookieSecure: true,
		DatabaseURL:         databaseURL,
		MediaDirectory:      envOrDefault("KUTEZH_MEDIA_DIR", defaultMediaDirectory),
		ModerationHost:      strings.TrimSpace(os.Getenv("KUTEZH_MODERATION_HOST")),
		ModerationOTPKey:    moderationKey,
		FaceAIURL:           envOrDefault("KUTEZH_FACE_AI_URL", "http://127.0.0.1:8091/analyze"),
		ImageAIURL:          envOrDefault("KUTEZH_IMAGE_AI_URL", "http://127.0.0.1:8093/analyze"),
		TextAIURL:           envOrDefault("KUTEZH_TEXT_AI_URL", "http://127.0.0.1:8092/analyze"),
		TextAIMode:          strings.ToLower(strings.TrimSpace(envOrDefault("KUTEZH_TEXT_AI_MODE", "enforce"))),
	}
	if raw := strings.TrimSpace(os.Getenv("KUTEZH_SUPPORT_OWNER_MAX_ID")); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			return Config{}, fmt.Errorf("KUTEZH_SUPPORT_OWNER_MAX_ID must be a positive MAX ID")
		}
		config.SupportOwnerMAXID = id
	}

	if value := strings.TrimSpace(os.Getenv("KUTEZH_MAINTENANCE_ALLOWED_IDS")); value != "" {
		config.MaintenanceAllowedIDs = make(map[int64]bool)
		for _, raw := range strings.Split(value, ",") {
			id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
			if err != nil || id <= 0 {
				return Config{}, fmt.Errorf("KUTEZH_MAINTENANCE_ALLOWED_IDS must contain positive profile IDs")
			}
			config.MaintenanceAllowedIDs[id] = true
		}
	}

	if strings.TrimSpace(config.HTTPAddress) == "" {
		return Config{}, fmt.Errorf("KUTEZH_HTTP_ADDR must not be empty")
	}
	if strings.TrimSpace(config.DatabaseURL) == "" {
		return Config{}, fmt.Errorf("KUTEZH_DATABASE_URL must not be empty")
	}
	if strings.TrimSpace(config.MediaDirectory) == "" {
		return Config{}, fmt.Errorf("KUTEZH_MEDIA_DIR must not be empty")
	}
	if config.ModerationHost != "" {
		if strings.ContainsAny(config.ModerationHost, "/?#@ \t\r\n") || strings.Contains(config.ModerationHost, "://") {
			return Config{}, fmt.Errorf("KUTEZH_MODERATION_HOST must be an exact host name")
		}
		if len(config.ModerationOTPKey) < 32 {
			return Config{}, fmt.Errorf("KUTEZH_MODERATION_OTP_KEY must contain at least 32 bytes when moderation is enabled")
		}
		if strings.TrimSpace(config.MaxBotToken) == "" {
			return Config{}, fmt.Errorf("KUTEZH_BOT_TOKEN is required when moderation is enabled")
		}
	}

	provider, providerErr := url.Parse(config.GeocodingURL)
	if providerErr != nil || provider.Host == "" || provider.User != nil || provider.Fragment != "" || (provider.Scheme != "https" && provider.Scheme != "http") {
		return Config{}, fmt.Errorf("KUTEZH_GEOCODING_URL must be an absolute HTTP(S) URL without credentials or fragment")
	}
	config.GeocodingAutocomplete, err = readBool("KUTEZH_GEOCODING_AUTOCOMPLETE", false)
	if err != nil {
		return Config{}, err
	}
	if strings.EqualFold(provider.Hostname(), "nominatim.openstreetmap.org") && config.GeocodingAutocomplete {
		return Config{}, fmt.Errorf("public Nominatim forbids autocomplete; configure a permitted provider or disable KUTEZH_GEOCODING_AUTOCOMPLETE")
	}
	config.MediaXAccel, err = readBool("KUTEZH_MEDIA_X_ACCEL", false)
	if err != nil {
		return Config{}, err
	}
	config.ShutdownTimeout, err = readDuration("KUTEZH_SHUTDOWN_TIMEOUT", config.ShutdownTimeout)
	if err != nil {
		return Config{}, err
	}
	config.MaxAuthMaxAge, err = readDuration("KUTEZH_MAX_AUTH_AGE", config.MaxAuthMaxAge)
	if err != nil {
		return Config{}, err
	}
	config.SessionTTL, err = readDuration("KUTEZH_SESSION_TTL", config.SessionTTL)
	if err != nil {
		return Config{}, err
	}
	if value, ok := os.LookupEnv("KUTEZH_SESSION_COOKIE_SECURE"); ok {
		config.SessionCookieSecure, err = strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("parse KUTEZH_SESSION_COOKIE_SECURE: %w", err)
		}
	}
	if config.ModerationHost != "" && !config.SessionCookieSecure {
		return Config{}, fmt.Errorf("KUTEZH_SESSION_COOKIE_SECURE must be true when moderation is enabled")
	}
	switch config.TextAIMode {
	case "off", "shadow", "enforce":
	default:
		return Config{}, fmt.Errorf("KUTEZH_TEXT_AI_MODE must be off, shadow or enforce")
	}
	if config.TextAIMode != "off" {
		textAI, textAIErr := url.Parse(config.TextAIURL)
		if textAIErr != nil || textAI.Host == "" || textAI.User != nil ||
			(textAI.Scheme != "http" && textAI.Scheme != "https") {
			return Config{}, fmt.Errorf("KUTEZH_TEXT_AI_URL must be an absolute HTTP(S) URL")
		}
	}

	for name, value := range map[string]string{"KUTEZH_PUBLIC_URL": config.PublicURL, "KUTEZH_MODERATION_URL": config.ModerationURL} {
		if value == "" {
			continue
		}
		u, err := url.Parse(value)
		if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" ||
			(u.Path != "" && u.Path != "/") || (u.Scheme != "http" && u.Scheme != "https") {
			return Config{}, fmt.Errorf("%s must be an HTTP(S) origin without credentials", name)
		}
		if config.ModerationHost != "" && u.Scheme != "https" {
			return Config{}, fmt.Errorf("%s must use HTTPS in production", name)
		}
	}
	return config, nil
}

func readDuration(name string, fallback time.Duration) (time.Duration, error) {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback, nil
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	if duration <= 0 {
		return 0, fmt.Errorf("%s must be positive", name)
	}

	return duration, nil
}

func envOrDefault(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	return fallback
}

func readBool(name string, fallback bool) (bool, error) {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", name, err)
	}
	return parsed, nil
}

// секреты из Docker-тома читаем только при старте. Два разных источника — ошибка,
// иначе легко перезапустить контейнер не с тем паролем и долго искать причину.
func readSecret(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	filename := strings.TrimSpace(os.Getenv(name + "_FILE"))
	if filename == "" {
		return value, nil
	}
	if value != "" {
		return "", fmt.Errorf("set either %s or %s_FILE, not both", name, name)
	}
	file, err := os.Open(filename)
	if err != nil {
		return "", fmt.Errorf("read %s_FILE: %w", name, err)
	}
	defer file.Close()
	const limit = 64 << 10
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return "", fmt.Errorf("read %s_FILE: %w", name, err)
	}
	if len(data) > limit {
		return "", fmt.Errorf("%s_FILE exceeds 64 KiB", name)
	}
	value = strings.TrimSpace(string(data))
	if value == "" {
		return "", fmt.Errorf("%s_FILE is empty", name)
	}
	return value, nil
}
