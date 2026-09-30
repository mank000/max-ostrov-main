package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type ClipEdit struct {
	Start    float64
	End      float64
	Muted    bool
	Rotation int
	Portrait bool
}

// TranscodeClip is used when WebCodecs cannot decode a source track on the device.
// The result still passes UploadClip's independent encoded-track checks.
func (s *Service) TranscodeClip(ctx context.Context, userID int64, source io.Reader, edit ClipEdit) (Asset, error) {
	if math.IsNaN(edit.Start) || math.IsNaN(edit.End) || math.IsInf(edit.Start, 0) || math.IsInf(edit.End, 0) ||
		edit.Start < 0 || edit.End-edit.Start < .25 || edit.End-edit.Start > 180 || edit.Start > 7200 ||
		(edit.Rotation != 0 && edit.Rotation != 90 && edit.Rotation != 180 && edit.Rotation != 270) {
		return Asset{}, ErrInvalidVideo
	}
	acquired := false
	select {
	case s.uploads <- struct{}{}:
		acquired = true
	case <-ctx.Done():
		return Asset{}, ctx.Err()
	}
	defer func() {
		if acquired {
			<-s.uploads
		}
	}()
	input, err := os.CreateTemp(s.directory, ".clip-source-*")
	if err != nil {
		return Asset{}, err
	}
	defer os.Remove(input.Name())
	defer input.Close()
	size, err := io.Copy(input, io.LimitReader(source, MaxVideoUploadBytes+1))
	if err != nil {
		return Asset{}, err
	}
	if size > MaxVideoUploadBytes {
		return Asset{}, ErrTooLarge
	}
	if size == 0 {
		return Asset{}, ErrInvalidVideo
	}
	output, err := os.CreateTemp(s.directory, ".clip-encoded-*.mp4")
	if err != nil {
		return Asset{}, err
	}
	defer os.Remove(output.Name())
	defer output.Close()
	filters := []string{}
	switch edit.Rotation {
	case 90:
		filters = append(filters, "transpose=clock")
	case 180:
		filters = append(filters, "hflip", "vflip")
	case 270:
		filters = append(filters, "transpose=cclock")
	}
	if edit.Portrait {
		filters = append(filters, "scale=480:854:force_original_aspect_ratio=increase", "crop=480:854")
	} else {
		filters = append(filters, "scale=480:854:force_original_aspect_ratio=decrease:force_divisible_by=2")
	}
	args := []string{"-nostdin", "-v", "error", "-max_alloc", "67108864", "-threads", "2",
		"-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,avi,mpegts,flv,ogg", "-i", input.Name(),
		"-ss", strconv.FormatFloat(edit.Start, 'f', 3, 64), "-t", strconv.FormatFloat(math.Min(edit.End-edit.Start, 179.8), 'f', 3, 64),
		"-map", "0:v:0", "-map_metadata", "-1", "-vf", strings.Join(filters, ","), "-filter_threads", "2",
		"-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "30", "-b:v", "1200k", "-maxrate", "1200k", "-bufsize", "2400k"}
	if edit.Muted {
		args = append(args, "-an")
	} else {
		args = append(args, "-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k", "-ac", "2")
	}
	args = append(args, "-movflags", "+faststart", "-y", output.Name())
	encodeCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := exec.CommandContext(encodeCtx, "ffmpeg", args...).Run(); err != nil {
		if errors.Is(encodeCtx.Err(), context.DeadlineExceeded) {
			return Asset{}, encodeCtx.Err()
		}
		return Asset{}, ErrInvalidVideo
	}
	info, err := output.Stat()
	if err != nil {
		return Asset{}, err
	}
	if info.Size() > 40<<20 {
		return Asset{}, ErrTooLarge
	}
	if _, err := output.Seek(0, io.SeekStart); err != nil {
		return Asset{}, err
	}
	// Free the encoder slot before UploadClip acquires its own upload slot.
	<-s.uploads
	acquired = false
	return s.UploadClip(ctx, userID, output)
}

// ffprobe independently checks the encoded tracks from either encoder;
// neither file names nor the MP4 presentation matrix prove a 480p encode.
func (s *Service) UploadClip(ctx context.Context, userID int64, source io.Reader) (Asset, error) {
	asset, err := s.UploadVideo(ctx, userID, io.LimitReader(source, (40<<20)+1))
	if err != nil {
		return Asset{}, err
	}
	accepted := false
	defer func() {
		if !accepted {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = s.Delete(cleanup, userID, asset.ID)
		}
	}()
	if asset.ByteSize > 40<<20 || asset.DurationMS > 180000 || min(asset.Width, asset.Height) > 480 || max(asset.Width, asset.Height) > 854 {
		return Asset{}, ErrInvalidVideo
	}
	file, err := os.Open(filepath.Join(s.directory, asset.StorageKey))
	if err != nil {
		return Asset{}, err
	}
	defer file.Close()
	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	command := exec.CommandContext(probeCtx, "ffprobe", "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,codec_name,width,height,duration:format=duration", "-of", "json", "/dev/fd/3")
	command.ExtraFiles = []*os.File{file}
	output, err := command.Output()
	if err != nil {
		return Asset{}, fmt.Errorf("%w: cannot inspect encoded clip", ErrInvalidVideo)
	}
	var probe struct {
		Streams []struct {
			Type     string `json:"codec_type"`
			Codec    string `json:"codec_name"`
			Width    int    `json:"width"`
			Height   int    `json:"height"`
			Duration string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(output, &probe) != nil {
		return Asset{}, ErrInvalidVideo
	}
	duration, err := strconv.ParseFloat(probe.Format.Duration, 64)
	if err != nil || math.IsNaN(duration) || duration <= 0 || duration > 180 {
		return Asset{}, ErrInvalidVideo
	}
	videos := 0
	audio := 0
	for _, track := range probe.Streams {
		if track.Type == "video" {
			videos++
			if track.Codec != "h264" || track.Width <= 0 || track.Height <= 0 || min(track.Width, track.Height) > 480 || max(track.Width, track.Height) > 854 {
				return Asset{}, ErrInvalidVideo
			}
		}
		if track.Type == "audio" {
			audio++
			if track.Codec != "aac" {
				return Asset{}, ErrInvalidVideo
			}
		}
	}
	if videos != 1 || audio > 1 {
		return Asset{}, ErrInvalidVideo
	}
	repository, ok := s.repository.(interface {
		ApproveClip(context.Context, int64) error
	})
	if !ok {
		return Asset{}, ErrInvalidVideo
	}
	if err := repository.ApproveClip(ctx, asset.ID); err != nil {
		return Asset{}, err
	}
	accepted = true
	return asset, nil
}
func (r *PostgresRepository) ApproveClip(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_assets SET clip_ready=true WHERE id=$1`, id)
	return err
}
