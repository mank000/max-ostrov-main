package media

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"kutezh/backend/internal/contentanalysis"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	MaxUploadBytes      int64 = 10 << 20
	MaxVideoUploadBytes int64 = 100 << 20
	MaxVideoDurationMS        = 5 * 60 * 1000
)

var (
	ErrInvalidImage        = errors.New("invalid image")
	ErrInvalidVideo        = errors.New("invalid video")
	ErrVideoTooLong        = errors.New("video is too long")
	ErrTooLarge            = errors.New("media is too large")
	ErrNotFound            = errors.New("media not found")
	ErrInUse               = errors.New("media is already attached")
	ErrUnsafeMedia         = errors.New("media violates content policy")
	ErrAnalysisUnavailable = errors.New("media analysis unavailable")
)

type Asset struct {
	ID         int64     `json:"id"`
	MIMEType   string    `json:"mime_type"`
	ByteSize   int64     `json:"byte_size"`
	Width      int       `json:"width"`
	Height     int       `json:"height"`
	DurationMS int       `json:"duration_ms"`
	URL        string    `json:"url"`
	CreatedAt  time.Time `json:"created_at"`
	StorageKey string    `json:"-"`
}

type Repository interface {
	Create(context.Context, int64, string, string, int64, int, int, int) (Asset, error)
	GetReadable(context.Context, int64, int64) (Asset, error)
	Delete(context.Context, int64, int64) (Asset, error)
}

type Service struct {
	repository Repository
	directory  string
	uploads    chan struct{}
	analyzer   *contentanalysis.Analyzer
}

func NewService(repository Repository, directory string) (*Service, error) {
	if directory == "" {
		return nil, errors.New("media directory must not be empty")
	}
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return nil, fmt.Errorf("create media directory: %w", err)
	}
	return &Service{
		repository: repository,
		directory:  directory,
		uploads:    make(chan struct{}, 2),
	}, nil
}

func (s *Service) WithAnalyzer(analyzer *contentanalysis.Analyzer) *Service {
	s.analyzer = analyzer
	return s
}

func (s *Service) Ready() error {
	info, err := os.Stat(s.directory)
	if err != nil {
		return fmt.Errorf("stat media directory: %w", err)
	}
	if !info.IsDir() {
		return errors.New("media path is not a directory")
	}
	probe, err := os.CreateTemp(s.directory, ".health-*")
	if err != nil {
		return fmt.Errorf("write media directory: %w", err)
	}
	name := probe.Name()
	defer func() {
		_ = os.Remove(name)
	}()
	if err := probe.Close(); err != nil {
		return fmt.Errorf("close media readiness probe: %w", err)
	}
	return nil
}

func (s *Service) Upload(ctx context.Context, userID int64, source io.Reader) (Asset, error) {
	return s.upload(ctx, userID, source, false)
}

func (s *Service) UploadAvatar(ctx context.Context, userID int64, source io.Reader) (Asset, error) {
	return s.upload(ctx, userID, source, true)
}

func (s *Service) UploadModeratedImage(ctx context.Context, userID int64, source io.Reader, avatar bool) (Asset, error) {
	asset, err := s.upload(ctx, userID, source, avatar)
	if err != nil {
		return Asset{}, err
	}
	return s.moderate(ctx, userID, asset)
}

func (s *Service) UploadModeratedVideo(ctx context.Context, userID int64, source io.Reader) (Asset, error) {
	asset, err := s.UploadVideo(ctx, userID, source)
	if err != nil {
		return Asset{}, err
	}
	return s.moderate(ctx, userID, asset)
}

func (s *Service) discard(userID, mediaID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.Delete(ctx, userID, mediaID)
}

func (s *Service) UploadVideo(ctx context.Context, userID int64, source io.Reader) (Asset, error) {
	select {
	case s.uploads <- struct{}{}:
		defer func() {
			<-s.uploads
		}()
	case <-ctx.Done():
		return Asset{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}

	temporary, err := os.CreateTemp(s.directory, ".video-upload-*")
	if err != nil {
		return Asset{}, fmt.Errorf("create video upload: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = os.Remove(temporaryPath)
	}()

	limited := io.LimitReader(source, MaxVideoUploadBytes+1)
	written, err := io.Copy(temporary, limited)
	if err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return Asset{}, fmt.Errorf("store video upload: %w", err)
	}
	if written == 0 {
		return Asset{}, ErrInvalidVideo
	}
	if written > MaxVideoUploadBytes {
		return Asset{}, ErrTooLarge
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}

	file, err := os.Open(temporaryPath)
	if err != nil {
		return Asset{}, fmt.Errorf("inspect video upload: %w", err)
	}
	mimeType, width, height, durationMS, inspectErr := inspectVideoFile(ctx, file)
	closeInspectErr := file.Close()
	if inspectErr != nil {
		return Asset{}, inspectErr
	}
	if closeInspectErr != nil {
		return Asset{}, closeInspectErr
	}
	extension, err := videoExtension(mimeType)
	if err != nil {
		return Asset{}, ErrInvalidVideo
	}
	key, err := randomKey(extension)
	if err != nil {
		return Asset{}, fmt.Errorf("generate media key: %w", err)
	}
	path := filepath.Join(s.directory, key)
	if err := os.Chmod(temporaryPath, 0o640); err != nil {
		return Asset{}, fmt.Errorf("secure video file: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return Asset{}, fmt.Errorf("store video file: %w", err)
	}
	asset, err := s.repository.Create(ctx, userID, key, mimeType, written, width, height, durationMS)
	if err != nil {
		_ = os.Remove(path)
		return Asset{}, err
	}
	asset.URL = "/api/v1/media/" + fmt.Sprint(asset.ID) + "/content"
	return asset, nil
}

func (s *Service) upload(ctx context.Context, userID int64, source io.Reader, avatar bool) (Asset, error) {
	select {
	case s.uploads <- struct{}{}:
		defer func() {
			<-s.uploads
		}()
	case <-ctx.Done():
		return Asset{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}
	limited := io.LimitReader(source, MaxUploadBytes+1)
	contents, err := io.ReadAll(limited)
	if err != nil {
		return Asset{}, fmt.Errorf("read image: %w", err)
	}
	if int64(len(contents)) > MaxUploadBytes {
		return Asset{}, ErrTooLarge
	}
	if len(contents) == 0 {
		return Asset{}, ErrInvalidImage
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}

	mimeType := http.DetectContentType(contents)
	var extension string
	switch mimeType {
	case "image/jpeg":
		extension = ".jpg"
	case "image/png":
		extension = ".png"
	default:
		return Asset{}, ErrInvalidImage
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(contents))
	if err != nil || !validDimensions(config.Width, config.Height) {
		return Asset{}, ErrInvalidImage
	}
	decoded, _, err := image.Decode(bytes.NewReader(contents))
	if err != nil {
		return Asset{}, ErrInvalidImage
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if !validDimensions(width, height) || width != config.Width || height != config.Height {
		return Asset{}, ErrInvalidImage
	}

	if mimeType == "image/jpeg" {
		decoded = orientImage(decoded, jpegOrientation(contents))
		width, height = decoded.Bounds().Dx(), decoded.Bounds().Dy()
	}
	if avatar {
		decoded = squareAvatar(decoded, 512)
		width, height = decoded.Bounds().Dx(), decoded.Bounds().Dy()
	}
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}

	key, err := randomKey(extension)
	if err != nil {
		return Asset{}, fmt.Errorf("generate media key: %w", err)
	}
	path := filepath.Join(s.directory, key)
	temporary, err := os.CreateTemp(s.directory, ".upload-*")
	if err != nil {
		return Asset{}, fmt.Errorf("create media file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = os.Remove(temporaryPath)
	}()

	output := &imageWriter{
		ctx:       ctx,
		writer:    temporary,
		remaining: MaxUploadBytes,
	}
	switch mimeType {
	case "image/jpeg":
		err = jpeg.Encode(output, decoded, &jpeg.Options{Quality: 88})
	case "image/png":
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		err = encoder.Encode(output, decoded)
	}
	if err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return Asset{}, fmt.Errorf("process image: %w", err)
	}
	if err := os.Chmod(temporaryPath, 0o640); err != nil {
		return Asset{}, fmt.Errorf("secure media file: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return Asset{}, fmt.Errorf("store media file: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		_ = os.Remove(path)
		return Asset{}, fmt.Errorf("inspect media file: %w", err)
	}
	if info.Size() > MaxUploadBytes {
		_ = os.Remove(path)
		return Asset{}, ErrTooLarge
	}

	asset, err := s.repository.Create(ctx, userID, key, mimeType, info.Size(), width, height, 0)
	if err != nil {
		_ = os.Remove(path)
		return Asset{}, err
	}
	asset.URL = "/api/v1/media/" + fmt.Sprint(asset.ID) + "/content"
	return asset, nil
}

func squareAvatar(source image.Image, maximum int) image.Image {
	bounds := source.Bounds()
	side := bounds.Dx()
	if bounds.Dy() < side {
		side = bounds.Dy()
	}
	targetSide := side
	if targetSide > maximum {
		targetSide = maximum
	}
	left := bounds.Min.X + (bounds.Dx()-side)/2
	top := bounds.Min.Y + (bounds.Dy()-side)/2
	target := image.NewRGBA(image.Rect(0, 0, targetSide, targetSide))
	for y := 0; y < targetSide; y++ {
		sourceY := top + y*side/targetSide
		for x := 0; x < targetSide; x++ {
			sourceX := left + x*side/targetSide
			target.Set(x, y, source.At(sourceX, sourceY))
		}
	}
	return target
}

func (s *Service) Open(ctx context.Context, userID, mediaID int64) (Asset, *os.File, error) {
	asset, err := s.repository.GetReadable(ctx, userID, mediaID)
	if err != nil {
		return Asset{}, nil, err
	}
	if !validStorageKey(asset.StorageKey) {
		return Asset{}, nil, ErrNotFound
	}
	file, err := os.Open(filepath.Join(s.directory, asset.StorageKey))
	if errors.Is(err, os.ErrNotExist) {
		return Asset{}, nil, ErrNotFound
	}
	if err != nil {
		return Asset{}, nil, fmt.Errorf("open media: %w", err)
	}
	return asset, file, nil
}

func (s *Service) Delete(ctx context.Context, userID, mediaID int64) error {
	asset, err := s.repository.Delete(ctx, userID, mediaID)
	if err != nil {
		return err
	}
	if !validStorageKey(asset.StorageKey) {
		return ErrNotFound
	}
	if err := os.Remove(filepath.Join(s.directory, asset.StorageKey)); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.WarnContext(ctx, "media removal queued for retry", "media_id", mediaID, "error", err)
	}
	return nil
}

func randomKey(extension string) (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value) + extension, nil
}

func validDimensions(width, height int) bool {
	return width >= 1 && height >= 1 && width <= 12000 && height <= 12000 && int64(width)*int64(height) <= 24_000_000
}

type imageWriter struct {
	ctx       context.Context
	writer    io.Writer
	remaining int64
}

func (w *imageWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if int64(len(data)) > w.remaining {
		return 0, ErrTooLarge
	}
	n, err := w.writer.Write(data)
	w.remaining -= int64(n)
	return n, err
}
