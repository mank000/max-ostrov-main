package contentanalysis

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

// Video sampling is partial visual coverage, never an assertion about audio or
// every frame. Process frames serially, using the same image model instance.
const VideoSamplingVersion = "adaptive-frames-v2"

// At most twelve serial inferences; no parallel FFmpeg processes or resident model.
func videoSampleTimes(durationMS int) []int {
	count := min(12, max(3, (durationMS+9999)/10000))
	start := min(100, durationMS/10)
	end := max(start, durationMS-max(1, min(1000, max(250, durationMS/10))))
	times := make([]int, count)
	for i := range times {
		times[i] = start + (end-start)*i/(count-1)
	}
	return times
}

type videoFrame struct {
	TimestampMS int      `json:"timestamp_ms"`
	Analysis    Analysis `json:"analysis"`
}
type videoResult struct {
	MediaID           int64        `json:"media_id"`
	Frames            []videoFrame `json:"frames"`
	SampledOnly       bool         `json:"sampled_only"`
	AudioAnalyzed     bool         `json:"audio_analyzed"`
	FrameTextAnalyzed bool         `json:"frame_text_analyzed"`
}
type boundedFrame struct{ bytes.Buffer }

func (b *boundedFrame) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1<<20 {
		return 0, fmt.Errorf("frame too large")
	}
	return b.Buffer.Write(p)
}
func (a *Analyzer) Video(ctx context.Context, key string, durationMS int) ([]videoFrame, error) {
	if key == "" || filepath.Base(key) != key || key == "." || key == ".." || durationMS <= 0 || durationMS > 300000 {
		return nil, fmt.Errorf("invalid video")
	}
	root, err := os.OpenRoot(a.mediaDir)
	if err != nil {
		return nil, fmt.Errorf("video storage unavailable")
	}
	defer root.Close()
	file, err := root.Open(key)
	if err != nil {
		return nil, fmt.Errorf("video unavailable")
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() <= 0 || stat.Size() > 100<<20 {
		return nil, fmt.Errorf("invalid video size")
	}
	frames := []videoFrame{}
	for _, ms := range videoSampleTimes(durationMS) {
		if _, err = file.Seek(0, 0); err != nil {
			return nil, fmt.Errorf("video seek failed")
		}
		work, cancel := context.WithTimeout(ctx, 8*time.Second)
		// ExtraFiles passes the validated open file, preventing path/symlink races.
		cmd := exec.CommandContext(work, "ffmpeg", "-nostdin", "-v", "error", "-max_alloc", "67108864", "-threads", "1", "-protocol_whitelist", "file,pipe", "-ss", strconv.FormatFloat(float64(ms)/1000, 'f', 3, 64), "-i", "/dev/fd/3", "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease", "-filter_threads", "1", "-threads", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1")
		cmd.ExtraFiles = []*os.File{file}
		var output boundedFrame
		cmd.Stdout = &output
		err = cmd.Run()
		cancel()
		if err != nil || output.Len() == 0 {
			return nil, fmt.Errorf("video frame extraction failed")
		}
		result, err := a.request(ctx, a.imageURL, "application/octet-stream", bytes.NewReader(output.Bytes()))
		if err != nil {
			return nil, err
		}
		if result.Version != ImageVersion {
			return nil, fmt.Errorf("unexpected video frame model version")
		}
		frames = append(frames, videoFrame{TimestampMS: ms, Analysis: result})
	}
	return frames, nil
}
