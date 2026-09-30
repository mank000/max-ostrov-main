import { FaceDetector } from '@mediapipe/tasks-vision'
import loader from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import wasm from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import model from './blaze-face-short-range.tflite?url'

let detector: FaceDetector | undefined
self.onmessage = async ({ data }: MessageEvent<{ type: 'init' | 'frame'; image?: ImageBitmap; timestamp: number }>) => {
  try {
    if (data.type === 'init') {
      detector = await FaceDetector.createFromOptions({
        wasmLoaderPath: new URL(loader, self.location.origin).href,
        wasmBinaryPath: new URL(wasm, self.location.origin).href,
      }, {
        baseOptions: { modelAssetPath: new URL(model, self.location.origin).href, delegate: 'CPU' },
        runningMode: 'VIDEO', minDetectionConfidence: .7,
      })
      self.postMessage({ type: 'ready' })
    } else if (detector && data.image) {
      const result = detector.detectForVideo(data.image, data.timestamp)
      self.postMessage({ type: 'result', faces: result.detections.map((face) => ({
        box: face.boundingBox, score: face.categories[0]?.score ?? 0,
      })) })
    }
  } catch {
    self.postMessage({ type: 'error' })
  } finally { data.image?.close() }
}
