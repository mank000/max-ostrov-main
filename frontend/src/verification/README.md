# Automatic face capture

The browser uses MediaPipe Tasks Vision 1.0.1 with the official BlazeFace short-range float16 model (version 1), downloaded from:
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

Model card: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf
MediaPipe distribution: Apache-2.0. Model SHA256 is recorded in model.sha256.

Vite emits hashed, same-origin model and WASM assets. They load only when the scanner opens. No camera frames go to Google. A worker processes one downscaled frame at a time; two stable, centered single-face detections trigger capture. Tracks stop before JPEG encoding and the existing authenticated server verification request. This is capture assistance, not proof of liveness or identity; server age/face validation remains authoritative.

`job.ts` keeps the pending status across Settings remounts. Images are not stored in browser storage. Errors allow retry; cancellation, backgrounding and unmount release camera and worker.

Validation: `node --test frontend/tests/face-quality.test.mjs` from the repository root. Browser QA must additionally exercise the real worker, no-face camera, capture, track cleanup and delayed server response.

Production CSP must allow `wasm-unsafe-eval` in `script-src` for the detector worker. Keep JavaScript `unsafe-eval` disabled. Validate against the actual nginx headers, not only Vite preview.
