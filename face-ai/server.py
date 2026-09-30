import json
import os
import threading
from io import BytesIO
from PIL import Image, UnidentifiedImageError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import hashlib
import struct

MODEL_DIR = Path(os.environ.get("FACE_AI_MODEL_DIR", "/opt/kutezh/face-ai/models"))
MAX_BODY = 20 * 1024 * 1024 + 4
FACE_MARGIN = 0.10
PIPELINE_VERSION = "vit-int8-yunet-crop10-sface-v3"
MATCH_THRESHOLD = 0.60
AUTO_MATCH_ENABLED = os.environ.get("FACE_AI_AUTO_MATCH_ENABLED", "0") == "1"

cv2.setNumThreads(1)
inference_lock = threading.Lock()
request_slots = threading.BoundedSemaphore(2)

detector = cv2.FaceDetectorYN.create(
    str(MODEL_DIR / "face_detection_yunet_2023mar.onnx"),
    "",
    (320, 320),
    0.85,
    0.3,
    5000,
)
AGE_MODEL_SHA256 = "b5aa06f90ed6bd4905e215a8fa65c09f84bf7732c5ec3c85f20ebfb4bad0218f"
model_path = MODEL_DIR / "age_vit_int8.onnx"
if hashlib.sha256(model_path.read_bytes()).hexdigest() != AGE_MODEL_SHA256:
    raise RuntimeError("Age model checksum mismatch")
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
options.enable_cpu_mem_arena = False
options.enable_mem_pattern = False
age_session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
age_input_name = age_session.get_inputs()[0].name
FACE_MODEL_SHA256 = "2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a"
face_model_path = MODEL_DIR / "face_recognition_sface_2021dec_int8.onnx"
recognizer = None
if AUTO_MATCH_ENABLED:
    if hashlib.sha256(face_model_path.read_bytes()).hexdigest() != FACE_MODEL_SHA256:
        raise RuntimeError("Face recognition model checksum mismatch")
    recognizer = cv2.FaceRecognizerSF.create(str(face_model_path), "")


def decode_image(data):
    with Image.open(BytesIO(data)) as header:
        if header.width * header.height > 20_000_000:
            raise ValueError("image too large")
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("invalid image")
    height, width = image.shape[:2]
    if max(width, height) > 1280:
        scale = 1280.0 / max(width, height)
        image = cv2.resize(image, (int(width * scale), int(height * scale)))
    return image


def detect_faces(image):
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    return faces


def analyze(data, avatar=None):
    with inference_lock:
        return analyze_locked(data, avatar)


def analyze_locked(data, avatar=None):
    image = decode_image(data)
    height, width = image.shape[:2]
    faces = detect_faces(image)
    if faces is None:
        return {"face_count": 0, "age": 0, "face_score": 0}
    if len(faces) != 1:
        return {"face_count": int(len(faces)), "age": 0, "face_score": float(max(face[-1] for face in faces))}
    face = faces[0]
    x, y, w, h = face[:4]
    margin_x = w * FACE_MARGIN
    margin_y = h * FACE_MARGIN
    x1 = max(0, int(x - margin_x))
    y1 = max(0, int(y - margin_y))
    x2 = min(width, int(x + w + margin_x))
    y2 = min(height, int(y + h + margin_y))
    crop = image[y1:y2, x1:x2]
    if min(w, h) < 64 or float(face[-1]) < 0.9:
        raise ValueError("face too small or uncertain")
    if crop.size == 0 or min(crop.shape[:2]) < 48:
        raise ValueError("face too small")
    rgb = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)).resize((224, 224), Image.Resampling.BILINEAR)
    tensor = np.asarray(rgb, dtype=np.float32) / 255.0
    tensor = (tensor - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    result = age_session.run(None, {age_input_name: tensor.transpose(2, 0, 1)[None]})
    age = float(np.asarray(result[0]).reshape(-1)[0])
    if not np.isfinite(age) or age < 0 or age > 100:
        raise ValueError("age outside supported range")
    result = {"face_count": 1, "age": age, "face_score": float(face[-1]),
              "model_version": AGE_MODEL_SHA256, "pipeline_version": PIPELINE_VERSION,
              "avatar_match": False, "avatar_comparison_enabled": recognizer is not None}
    if avatar is not None and recognizer is not None:
        avatar_image = decode_image(avatar)
        avatar_faces = detect_faces(avatar_image)
        if avatar_faces is not None and len(avatar_faces) == 1:
            avatar_face = avatar_faces[0]
            if min(avatar_face[2], avatar_face[3]) >= 64 and float(avatar_face[-1]) >= 0.9:
                live_feature = recognizer.feature(recognizer.alignCrop(image, face))
                avatar_feature = recognizer.feature(recognizer.alignCrop(avatar_image, avatar_face))
                score = float(recognizer.match(live_feature, avatar_feature, cv2.FaceRecognizerSF_FR_COSINE))
                if np.isfinite(score):
                    result["avatar_match"] = score >= MATCH_THRESHOLD
    return result


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.respond(200, {"status": "ok", "model": "age-vit-int8+sface-int8" if recognizer is not None else "age-vit-int8",
                           "version": AGE_MODEL_SHA256, "face_version": FACE_MODEL_SHA256 if recognizer is not None else None,
                           "auto_avatar_match": recognizer is not None, "pipeline": PIPELINE_VERSION})

    def do_POST(self):
        if self.path != "/analyze":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 1024 or length > MAX_BODY:
            self.respond(400, {"error": "invalid image"})
            return
        if not request_slots.acquire(blocking=False):
            self.respond(503, {"error": "analysis busy"})
            return
        try:
            self.connection.settimeout(15)
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("incomplete image")
            avatar = None
            if self.headers.get("Content-Type") == "application/x-kutezh-face-pair":
                if len(data) < 8:
                    raise ValueError("incomplete face pair")
                scan_length = struct.unpack(">I", data[:4])[0]
                avatar_length = len(data) - 4 - scan_length
                if scan_length < 1024 or scan_length > 10 * 1024 * 1024 or avatar_length < 1024 or avatar_length > 10 * 1024 * 1024:
                    raise ValueError("invalid face pair")
                avatar = data[4 + scan_length:]
                data = data[4:4 + scan_length]
            result = analyze(data, avatar)
        except (ValueError, UnidentifiedImageError, Image.DecompressionBombError, struct.error):
            self.respond(422, {"error": "image analysis failed"})
            return
        except Exception:
            self.respond(503, {"error": "analysis unavailable"})
            return
        finally:
            request_slots.release()
        self.respond(200, result)

    def log_message(self, format, *args):
        return

    def respond(self, status, body):
        payload = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    bind = os.environ.get("FACE_AI_BIND", "127.0.0.1")
    port = int(os.environ.get("FACE_AI_PORT", "8091"))
    ThreadingHTTPServer((bind, port), Handler).serve_forever()
