import hashlib, io, json, math, os, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps
from image_preprocess import preprocess

ROOT = Path(__file__).resolve().parent
EXPECTED_SHA = "f5c4cbd92adb02e39624fc64fa3c69ca87365b9060797481384f0cd1d9e900f9"
MAX_BODY = 10 * 1024 * 1024


def load_model(root=ROOT):
    cfg = json.loads((root / "model_config.json").read_text())
    model = root / "models/image_v16_fp16.onnx"
    with model.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    if digest != EXPECTED_SHA:
        raise RuntimeError("Unexpected image weights; refusing to start")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
    opts.add_session_config_entry("session.inter_op.allow_spinning", "0")
    session = ort.InferenceSession(
        str(model), sess_options=opts, providers=["CPUExecutionProvider"]
    )
    session.run(
        None,
        {
            session.get_inputs()[0].name: np.zeros(
                (1, *cfg["preprocess"]["input_size"]), dtype=np.float32
            )
        },
    )
    return cfg, session


def crop_explicit(data, cfg, session, region):
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > 8_000_000:
            source.draft("RGB", (2048, 2048))
        ImageOps.exif_transpose(source, in_place=True)
        image = source
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        w, h = image.size
        box = (
            (0, 0, w, max(1, int(h * 0.7)))
            if region == "upper"
            else (int(w * 0.2), int(h * 0.2), max(1, int(w * 0.8)), max(1, int(h * 0.8)))
        )
        with image.crop(box).convert("RGB") as crop:
            buffer = io.BytesIO()
            crop.save(buffer, format="PNG")
    logits, _, _ = session.run(
        None, {session.get_inputs()[0].name: preprocess(buffer.getvalue(), cfg["preprocess"])[None]}
    )
    p = np.exp(logits[0] - logits[0].max())
    p /= p.sum()
    return float(p[3:5].sum())


def analyze(data, cfg, session):
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in ["JPEG", "PNG"] or image.width * image.height > 40_000_000:
            raise ValueError("Invalid image")
    tensor = preprocess(data, cfg["preprocess"])
    sexual, safety, reference = session.run(None, {session.get_inputs()[0].name: tensor[None]})
    p = np.exp(sexual[0] - sexual[0].max())
    p /= p.sum()
    scores = {
        "sexual_explicit": float(p[3:5].sum()),
        "sexual_suggestive": float(p[1:3].sum()),
        "violence": float(1 / (1 + np.exp(-np.clip(safety[0, 1], -40, 40)))),
    }
    for index, label in enumerate(
        ["weapon", "violence", "graphic_violence", "drug_visual", "extremist_symbol"]
    ):
        scores[label] = float(1 / (1 + np.exp(-np.clip(safety[0, index], -40, 40))))
    if not all(math.isfinite(x) and 0 <= x <= 1 for x in scores.values()):
        raise RuntimeError("Invalid scores")
    result = {
        "complete": True,
        "model": "image-v16-fp16-dual-head",
        "version": cfg.get("bundle_version", EXPECTED_SHA),
        "policy_revision": cfg.get("policy_revision", "original"),
        "scores": scores,
        "flags": [],
        "review_flags": [
            label
            for label, score in scores.items()
            if score >= cfg["review_thresholds"].get(label, 1.1)
        ],
        "experimental_labels": ["weapon", "graphic_violence", "drug_visual", "extremist_symbol"],
        "legal_violation_established": False,
        "automatic_action": "none",
    }
    rp = np.exp(reference[0] - reference[0].max())
    rp /= rp.sum()
    scores["sexual_explicit_reference"] = float(rp[3:5].sum())
    cascade = cfg.get("anatomy_cascade")
    if (
        cascade
        and (
            max(scores["sexual_explicit"], scores["sexual_explicit_reference"])
            >= cascade["classifier_min"]
            or scores["sexual_suggestive"] >= 0.8
        )
        and scores["sexual_explicit"] < cascade["classifier_max"]
    ):
        request = urllib.request.Request(
            os.environ.get("KUTEZH_ANATOMY_AI_URL", "http://127.0.0.1:8096/analyze"),
            data=data,
            headers={"Content-Type": "application/octet-stream"},
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                payload = json.loads(response.read(65536))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise RuntimeError("Anatomy temporarily unavailable") from error
        if payload.get("complete") is not True or payload.get("version") != cascade["version"]:
            raise RuntimeError("Anatomy result incomplete or unexpected version")
        for label, threshold in cascade["block_thresholds"].items():
            score = payload.get("scores", {}).get(label)
            if (
                not isinstance(score, (int, float))
                or not math.isfinite(score)
                or not 0 <= score <= 1
            ):
                raise RuntimeError("Invalid anatomy score")
            scores["anatomy_" + label.lower()] = score
            if score >= threshold and "anatomical_nudity" not in result["flags"]:
                result["flags"].append("anatomical_nudity")

    if scores["sexual_explicit"] < 0.9 and not result["flags"]:
        if scores["sexual_explicit"] >= 0.75:
            scores["explicit_upper_crop"] = crop_explicit(data, cfg, session, "upper")
            if scores["explicit_upper_crop"] >= 0.95:
                result["flags"].append("multiview_nudity")
        elif (
            scores["sexual_suggestive"] >= 0.8
            and scores.get("anatomy_female_breast_exposed", 0) >= 0.75
        ):
            scores["explicit_center_crop"] = crop_explicit(data, cfg, session, "center")
            if scores["explicit_center_crop"] >= 0.5:
                result["flags"].append("multiview_nudity")
    return result


def main():
    cfg, session = load_model()
    inference = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, payload):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self.reply(
                    200,
                    {
                        "status": "ok",
                        "version": cfg.get("bundle_version", EXPECTED_SHA),
                        "policy_revision": cfg.get("policy_revision", "original"),
                        "base_model_sha256": EXPECTED_SHA,
                        "precision": "FP16 storage; FP32 compute",
                        "workers": 1,
                    },
                )
            else:
                self.reply(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/analyze":
                self.reply(404, {"error": "not_found"})
                return
            if not inference.acquire(blocking=False):
                self.reply(503, {"error": "busy", "complete": False})
                return
            start = time.monotonic()
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise ValueError("Chunked input unsupported")
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_BODY:
                    self.reply(413, {"error": "input_size", "complete": False})
                    return
                data = self.rfile.read(size)
                if len(data) != size:
                    raise ValueError("Incomplete input")
                result = analyze(data, cfg, session)
                result["latency_ms"] = round((time.monotonic() - start) * 1000, 2)
                self.reply(200, result)
            except (ValueError, OSError, Image.DecompressionBombError):
                self.reply(400, {"error": "invalid_image", "complete": False})
            except Exception:
                self.reply(503, {"error": "inference_failed", "complete": False})
            finally:
                inference.release()

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 16

        def __init__(self, *args, **kwargs):
            self.slots = threading.BoundedSemaphore(4)
            super().__init__(*args, **kwargs)

        def process_request(self, request, address):
            if not self.slots.acquire(blocking=False):
                try:
                    request.sendall(
                        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                finally:
                    self.shutdown_request(request)
                return
            request.settimeout(15)
            try:
                super().process_request(request, address)
            except BaseException:
                self.slots.release()
                raise

        def process_request_thread(self, *args):
            try:
                super().process_request_thread(*args)
            finally:
                self.slots.release()

    server = Server(
        (
            os.environ.get("KUTEZH_IMAGE_AI_BIND", "127.0.0.1"),
            int(os.environ.get("KUTEZH_IMAGE_AI_PORT", "8093")),
        ),
        Handler,
    )
    print(json.dumps({"event": "ready", "version": EXPECTED_SHA}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
