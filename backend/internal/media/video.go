package media

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
)

type mp4Box struct {
	kind         string
	contentStart int64
	end          int64
}

func inspectVideoFile(ctx context.Context, file *os.File) (string, int, int, int, error) {
	info, err := file.Stat()
	if err != nil {
		return "", 0, 0, 0, err
	}
	size := info.Size()
	if size < 16 {
		return "", 0, 0, 0, ErrInvalidVideo
	}

	var mimeType string
	var width, height, durationMS int
	var sawFTYP, sawData bool
	reader := &videoReader{ctx: ctx, reader: file, remaining: 100000}
	for offset := int64(0); offset < size; {
		box, err := readMP4Box(reader, offset, size)
		if err != nil {
			return "", 0, 0, 0, ErrInvalidVideo
		}
		switch box.kind {
		case "ftyp":
			brand := make([]byte, 4)
			if box.contentStart+4 > box.end {
				return "", 0, 0, 0, ErrInvalidVideo
			}
			if _, err := reader.ReadAt(brand, box.contentStart); err != nil {
				return "", 0, 0, 0, ErrInvalidVideo
			}
			sawFTYP = true
			if string(brand) == "qt  " {
				mimeType = "video/quicktime"
			} else {
				mimeType = "video/mp4"
			}
		case "mdat":
			sawData = sawData || box.end > box.contentStart
		case "moov":
			movieDuration, movieWidth, movieHeight, err := inspectMoov(reader, box.contentStart, box.end)
			if err != nil {
				return "", 0, 0, 0, err
			}
			if movieDuration > 0 {
				durationMS = movieDuration
			}
			if movieWidth*movieHeight > width*height {
				width, height = movieWidth, movieHeight
			}
		}
		if box.end <= offset {
			return "", 0, 0, 0, ErrInvalidVideo
		}
		offset = box.end
	}

	if !sawFTYP || !sawData || mimeType == "" || durationMS <= 0 || durationMS > MaxVideoDurationMS || !validDimensions(width, height) {
		if durationMS > MaxVideoDurationMS {
			return "", 0, 0, 0, ErrVideoTooLong
		}
		return "", 0, 0, 0, ErrInvalidVideo
	}
	return mimeType, width, height, durationMS, nil
}

func inspectMoov(file io.ReaderAt, start, end int64) (durationMS, width, height int, err error) {
	for offset := start; offset < end; {
		box, boxErr := readMP4Box(file, offset, end)
		if boxErr != nil {
			return 0, 0, 0, ErrInvalidVideo
		}
		switch box.kind {
		case "mvhd":
			durationMS, boxErr = readMovieDuration(file, box)
			if boxErr != nil {
				return 0, 0, 0, ErrInvalidVideo
			}
		case "trak":
			trackWidth, trackHeight, trackErr := inspectTrack(file, box.contentStart, box.end)
			if trackErr != nil {
				return 0, 0, 0, trackErr
			}
			if trackWidth*trackHeight > width*height {
				width, height = trackWidth, trackHeight
			}
		}
		offset = box.end
	}
	return durationMS, width, height, nil
}

func inspectTrack(file io.ReaderAt, start, end int64) (width, height int, err error) {
	for offset := start; offset < end; {
		box, boxErr := readMP4Box(file, offset, end)
		if boxErr != nil {
			return 0, 0, ErrInvalidVideo
		}
		if box.kind == "tkhd" {
			return readTrackDimensions(file, box)
		}
		offset = box.end
	}
	return 0, 0, nil
}

func readMP4Box(reader io.ReaderAt, offset, limit int64) (mp4Box, error) {
	if offset < 0 || offset > limit || limit-offset < 8 {
		return mp4Box{}, ErrInvalidVideo
	}
	header := make([]byte, 16)
	if _, err := reader.ReadAt(header[:8], offset); err != nil {
		return mp4Box{}, err
	}
	size32 := binary.BigEndian.Uint32(header[:4])
	headerSize := int64(8)
	var size int64
	switch size32 {
	case 0:
		size = limit - offset
	case 1:
		if limit-offset < 16 {
			return mp4Box{}, ErrInvalidVideo
		}
		if _, err := reader.ReadAt(header[8:16], offset+8); err != nil {
			return mp4Box{}, err
		}
		size64 := binary.BigEndian.Uint64(header[8:16])
		if size64 > uint64(^uint64(0)>>1) {
			return mp4Box{}, ErrInvalidVideo
		}
		size = int64(size64)
		headerSize = 16
	default:
		size = int64(size32)
	}
	if size < headerSize || size > limit-offset {
		return mp4Box{}, ErrInvalidVideo
	}
	return mp4Box{kind: string(header[4:8]), contentStart: offset + headerSize, end: offset + size}, nil
}

func readMovieDuration(file io.ReaderAt, box mp4Box) (int, error) {
	payloadSize := box.end - box.contentStart
	if payloadSize < 20 {
		return 0, ErrInvalidVideo
	}
	payload := make([]byte, 32)
	readSize := int64(len(payload))
	if payloadSize < readSize {
		readSize = payloadSize
	}
	if _, err := file.ReadAt(payload[:readSize], box.contentStart); err != nil {
		return 0, err
	}
	version := payload[0]
	var timescale uint32
	var duration uint64
	switch version {
	case 0:
		if len(payload[:readSize]) < 20 {
			return 0, ErrInvalidVideo
		}
		timescale = binary.BigEndian.Uint32(payload[12:16])
		duration = uint64(binary.BigEndian.Uint32(payload[16:20]))
	case 1:
		if len(payload[:readSize]) < 32 {
			return 0, ErrInvalidVideo
		}
		timescale = binary.BigEndian.Uint32(payload[20:24])
		duration = binary.BigEndian.Uint64(payload[24:32])
	default:
		return 0, ErrInvalidVideo
	}
	if timescale == 0 || duration == 0 || duration > ^uint64(0)/1000 {
		return 0, ErrInvalidVideo
	}
	milliseconds := duration * 1000 / uint64(timescale)
	if milliseconds > uint64(^uint(0)>>1) {
		return 0, ErrInvalidVideo
	}
	return int(milliseconds), nil
}

func readTrackDimensions(file io.ReaderAt, box mp4Box) (int, int, error) {
	if box.end-box.contentStart < 84 {
		return 0, 0, ErrInvalidVideo
	}
	var version [1]byte
	if _, err := file.ReadAt(version[:], box.contentStart); err != nil {
		return 0, 0, err
	}
	matrixOffset := 40
	switch version[0] {
	case 0:
	case 1:
		matrixOffset = 52
	default:
		return 0, 0, ErrInvalidVideo
	}
	payloadSize := matrixOffset + 44
	if box.end-box.contentStart < int64(payloadSize) {
		return 0, 0, ErrInvalidVideo
	}
	payload := make([]byte, payloadSize)
	if _, err := file.ReadAt(payload, box.contentStart); err != nil {
		return 0, 0, err
	}
	widthOffset := matrixOffset + 36
	width := float64(binary.BigEndian.Uint32(payload[widthOffset:widthOffset+4])) / 65536
	height := float64(binary.BigEndian.Uint32(payload[widthOffset+4:widthOffset+8])) / 65536
	if width == 0 || height == 0 {
		return 0, 0, nil
	}
	matrixValue := func(offset int) float64 {
		return float64(int32(binary.BigEndian.Uint32(payload[offset:offset+4]))) / 65536
	}
	a, b := matrixValue(matrixOffset), matrixValue(matrixOffset+4)
	c, d := matrixValue(matrixOffset+12), matrixValue(matrixOffset+16)
	displayWidth := int(math.Round(math.Abs(a)*width + math.Abs(c)*height))
	displayHeight := int(math.Round(math.Abs(b)*width + math.Abs(d)*height))
	if !validDimensions(displayWidth, displayHeight) {
		return 0, 0, fmt.Errorf("%w: dimensions", ErrInvalidVideo)
	}
	return displayWidth, displayHeight, nil
}

func videoExtension(mimeType string) (string, error) {
	switch mimeType {
	case "video/mp4":
		return ".mp4", nil
	case "video/quicktime":
		return ".mov", nil
	default:
		return "", errors.New("unsupported video mime type")
	}
}

type videoReader struct {
	ctx       context.Context
	reader    io.ReaderAt
	remaining int
}

func (r *videoReader) ReadAt(buffer []byte, offset int64) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.remaining <= 0 {
		return 0, ErrInvalidVideo
	}
	r.remaining--
	return r.reader.ReadAt(buffer, offset)
}
