import {
  Input,
  Output,
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  Conversion,
  canEncodeAudio,
} from 'mediabunny'
import type { EditSettings } from './media'

self.onmessage = async (
  event: MessageEvent<{ file: File; edit: EditSettings }>,
) => {
  const { file, edit } = event.data
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })
  try {
    if (!edit.muted && !(await canEncodeAudio('aac'))) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
      registerAacEncoder()
    }
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('В файле нет видеодорожки')
    const rotated = edit.rotation === 90 || edit.rotation === 270
    const w = rotated ? track.displayHeight : track.displayWidth
    const h = rotated ? track.displayWidth : track.displayHeight
    const scale = Math.min(1, 480 / Math.min(w, h), 854 / Math.max(w, h))
    const width = edit.portrait
      ? 480
      : Math.max(2, Math.floor((w * scale) / 2) * 2)
    const height = edit.portrait
      ? 854
      : Math.max(2, Math.floor((h * scale) / 2) * 2)
    const target = new BufferTarget()
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    })
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      // Reserve 100 ms for AAC encoder padding while keeping the uploaded file within 180 seconds.
      trim: { start: edit.start, end: Math.min(edit.end, edit.start + 179.9) },
      video: {
        codec: 'avc',
        width,
        height,
        fit: edit.portrait ? 'cover' : 'contain',
        rotate: edit.rotation,
        allowTransformationMetadata: false,
        frameRate: 30,
        bitrate: 1_200_000,
        keyFrameInterval: 2,
        forceTranscode: true,
      },
      audio: edit.muted
        ? { discard: true }
        : { codec: 'aac', bitrate: 96_000, numberOfChannels: 2 },
    })
    if (
      !conversion.isValid ||
      conversion.discardedTracks.some(
        (item) => item.reason !== 'discarded_by_user',
      )
    ) {
      throw new Error(
        'Этот браузер не может обработать кодек видео или звука. Выберите другой файл или откройте редактор в обновлённом браузере.',
      )
    }
    conversion.onProgress = (progress) => self.postMessage({ progress })
    await conversion.execute()
    if (!target.buffer || target.buffer.byteLength > 40 * 1024 * 1024)
      throw new Error(
        'Ролик получился слишком большим. Выберите более короткий фрагмент.',
      )
    self.postMessage({ buffer: target.buffer }, { transfer: [target.buffer] })
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : 'Не удалось подготовить видео',
    })
  } finally {
    input.dispose()
  }
}
