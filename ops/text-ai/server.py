import hashlib
import json
import logging
import math
import os
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from extremism_normalize import normalize_extremism

ROOT = Path(os.environ.get("KUTEZH_TEXT_AI_ROOT", "/opt/kutezh-text-ai"))
MODEL_DIR = ROOT / "models"
if (MODEL_DIR / "current").is_dir():
    MODEL_DIR = MODEL_DIR / "current"
MODEL_PATH = MODEL_DIR / "model_quantized.onnx"
TOKENIZER_PATH = MODEL_DIR / "tokenizer.json"
MANIFEST_PATH = MODEL_DIR / "manifest.json"
MAX_BODY = 64 * 1024

DEFAULT_MANIFEST = {
    "name": "rubert-tiny-toxicity-int8",
    "version": "legacy",
    "labels": ["non_toxic", "insult", "obscenity", "threat", "dangerous"],
    "thresholds": {
        "insult": 0.97,
        "obscenity": 0.90,
        "threat": 0.80,
    },
    "enforce_labels": ["threat", "obscenity", "insult"],
    "review_labels": [],
    "category_map": {
        "insult": "insult",
        "obscenity": "obscenity",
        "threat": "threat",
    },
    "max_tokens": 256,
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load_manifest():
    data = dict(DEFAULT_MANIFEST)
    if MANIFEST_PATH.is_file():
        loaded = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        data.update(loaded)
    labels = data.get("labels")
    if (
        not isinstance(labels, list)
        or not labels
        or not all(isinstance(x, str) and x for x in labels)
    ):
        raise RuntimeError("invalid model manifest labels")
    data["labels"] = labels
    data["thresholds"] = {str(k): float(v) for k, v in dict(data.get("thresholds") or {}).items()}
    data["enforce_labels"] = [str(x) for x in data.get("enforce_labels") or []]
    data["review_labels"] = [str(x) for x in data.get("review_labels") or []]
    data["category_map"] = {str(k): str(v) for k, v in dict(data.get("category_map") or {}).items()}
    data["max_tokens"] = int(data.get("max_tokens") or 256)
    if data["max_tokens"] < 16 or data["max_tokens"] > 512:
        raise RuntimeError("invalid max_tokens")
    return data


MANIFEST = load_manifest()
LABELS = tuple(MANIFEST["labels"])
THRESHOLDS = MANIFEST["thresholds"]
REVIEW_THRESHOLDS = MANIFEST.get("review_thresholds", THRESHOLDS)
BLOCK_THRESHOLDS = MANIFEST.get("block_thresholds", THRESHOLDS)
with MODEL_PATH.open("rb") as model_file:
    weights_hash = hashlib.file_digest(model_file, "sha256").hexdigest()
if MANIFEST.get("sha256") and weights_hash != MANIFEST["sha256"]:
    raise RuntimeError("Text weights checksum mismatch")
ENFORCE_LABELS = frozenset(MANIFEST["enforce_labels"]) - {
    "profanity",
    "obscenity",
    "obscene",
    "insult",
}
REVIEW_LABELS = frozenset(MANIFEST["review_labels"]) - {"profanity", "obscenity", "obscene"}
MODEL_NAME = str(MANIFEST.get("name") or "text-moderation")
MODEL_VERSION = str(MANIFEST.get("version") or "unknown")
NORMALIZED_LABELS = frozenset(MANIFEST.get("normalized_labels", []))
if "extremism_context" in LABELS:
    NORMALIZED_LABELS |= {"extremism_context"}
if not NORMALIZED_LABELS.issubset(LABELS):
    raise RuntimeError("unknown normalized output")
MAX_TOKENS = int(os.environ.get("KUTEZH_TEXT_AI_MAX_TOKENS", str(MANIFEST["max_tokens"])))

options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
options.enable_cpu_mem_arena = False
options.enable_mem_pattern = False

session = ort.InferenceSession(
    str(MODEL_PATH),
    sess_options=options,
    providers=["CPUExecutionProvider"],
)
input_names = {item.name for item in session.get_inputs()}
tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
tokenizer.enable_truncation(max_length=MAX_TOKENS)

infer_lock = threading.Semaphore(1)
stats_lock = threading.Lock()
latencies = deque(maxlen=256)
request_count = 0
busy_count = 0
error_count = 0
inflight_count = 0


def process_rss_kb():
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except Exception:
        pass
    return 0


def sigmoid(values):
    values = np.clip(values, -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-values))


def score_flags(scores, allowed, thresholds):
    result = []
    for label in allowed:
        threshold = thresholds.get(label)
        if threshold is not None and scores.get(label, 0.0) >= threshold:
            result.append(label)
    result.sort(key=lambda label: scores.get(label, 0.0), reverse=True)
    return result


def analyze(text):
    encoding = tokenizer.encode(text)
    ids = np.asarray([encoding.ids], dtype=np.int64)
    mask = np.asarray([encoding.attention_mask], dtype=np.int64)
    type_ids = np.asarray([encoding.type_ids], dtype=np.int64)

    feeds = {}
    if "input_ids" in input_names:
        feeds["input_ids"] = ids
    if "attention_mask" in input_names:
        feeds["attention_mask"] = mask
    if "token_type_ids" in input_names:
        feeds["token_type_ids"] = type_ids

    started = time.perf_counter()
    logits = np.asarray(session.run(None, feeds)[0]).reshape(-1)
    if NORMALIZED_LABELS:
        normalized = normalize_extremism(text)

        extra = tokenizer.encode(normalized)
        if extra.ids != encoding.ids or extra.attention_mask != encoding.attention_mask:
            extra_feeds = {
                "input_ids": np.asarray([extra.ids], dtype=np.int64),
                "attention_mask": np.asarray([extra.attention_mask], dtype=np.int64),
                "token_type_ids": np.asarray([extra.type_ids], dtype=np.int64),
            }
            second = np.asarray(
                session.run(None, {k: v for k, v in extra_feeds.items() if k in input_names})[0]
            ).reshape(-1)
            if len(second) != len(LABELS):
                raise RuntimeError("context output mismatch")
            for label in NORMALIZED_LABELS:
                index = LABELS.index(label)
                logits[index] = second[index]
            context_truncated = bool(extra.overflowing)
        else:
            context_truncated = bool(extra.overflowing)
    else:
        context_truncated = False
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    if len(logits) != len(LABELS):
        raise RuntimeError(f"model outputs {len(logits)} logits for {len(LABELS)} labels")
    if not np.isfinite(logits).all():
        raise RuntimeError("non-finite model output")
    probabilities = sigmoid(logits)

    scores = {label: float(probabilities[index]) for index, label in enumerate(LABELS)}
    if "non_toxic" in scores and "dangerous" in scores:
        scores["toxicity"] = float(1.0 - scores["non_toxic"] * (1.0 - scores["dangerous"]))

    flags = score_flags(scores, ENFORCE_LABELS, BLOCK_THRESHOLDS)
    review_flags = score_flags(scores, REVIEW_LABELS, REVIEW_THRESHOLDS)
    truncated = bool(encoding.overflowing) or context_truncated

    with stats_lock:
        global request_count
        request_count += 1
        latencies.append(elapsed_ms)

    top = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:4]
    logging.info(
        "analyze model=%s version=%s tokens=%d truncated=%s latency_ms=%.2f flags=%s review=%s top=%s",
        MODEL_NAME,
        MODEL_VERSION,
        len(encoding.ids),
        truncated,
        elapsed_ms,
        ",".join(flags) or "-",
        ",".join(review_flags) or "-",
        ",".join(f"{name}:{value:.4f}" for name, value in top),
    )
    return scores, flags, review_flags, elapsed_ms, len(encoding.ids), truncated


def stats_payload():
    with stats_lock:
        values = sorted(latencies)
        count = request_count
        busy = busy_count
        errors = error_count
        inflight = inflight_count
    avg = sum(values) / len(values) if values else 0.0
    p95 = values[min(len(values) - 1, math.ceil(len(values) * 0.95) - 1)] if values else 0.0
    return {
        "status": "ok",
        "requests": count,
        "busy": busy,
        "errors": errors,
        "rss_kb": process_rss_kb(),
        "avg_latency_ms": round(avg, 2),
        "p95_latency_ms": round(p95, 2),
        "p50_latency_ms": round(values[len(values) // 2], 2) if values else 0,
        "p99_latency_ms": round(values[min(len(values) - 1, math.ceil(len(values) * 0.99) - 1)], 2)
        if values
        else 0,
        "queue_depth": max(0, inflight - 1),
        "active_requests": inflight,
        "max_tokens": MAX_TOKENS,
        "model": MODEL_NAME,
        "version": MODEL_VERSION,
        "labels": list(LABELS),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "KutezhTextAI/2"

    def log_message(self, *_):
        return

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in {"/health", "/ready"}:
            self.send_json(
                200,
                {
                    "status": "ok",
                    "model": MODEL_NAME,
                    "version": MODEL_VERSION,
                    "labels": list(LABELS),
                },
            )
            return
        if self.path == "/stats":
            self.send_json(200, stats_payload())
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/analyze":
            self.send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "invalid_length"})
            return
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "payload_too_large"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            text = payload.get("text", "")
            if not isinstance(text, str):
                raise ValueError("text must be a string")
            text = text.strip()
        except Exception:
            self.send_json(400, {"error": "invalid_json"})
            return
        if not text:
            scores = {label: 0.0 for label in LABELS}
            if "non_toxic" in scores:
                scores["non_toxic"] = 1.0
            self.send_json(
                200,
                {
                    "model": MODEL_NAME,
                    "version": MODEL_VERSION,
                    "complete": True,
                    "scores": scores,
                    "flags": [],
                    "review_flags": [],
                    "latency_ms": 0.0,
                    "tokens": 0,
                    "truncated": False,
                },
            )
            return

        global inflight_count
        with stats_lock:
            inflight_count += 1
        if not infer_lock.acquire(timeout=0.25):
            with stats_lock:
                global busy_count
                busy_count += 1
                inflight_count -= 1
            self.send_json(503, {"error": "busy"})
            return
        try:
            scores, flags, review_flags, latency_ms, tokens, truncated = analyze(text)
            self.send_json(
                200,
                {
                    "model": MODEL_NAME,
                    "version": MODEL_VERSION,
                    "complete": True,
                    "scores": scores,
                    "flags": flags,
                    "review_flags": review_flags,
                    "latency_ms": round(latency_ms, 2),
                    "tokens": tokens,
                    "truncated": truncated,
                },
            )
        except Exception:
            logging.exception("analysis failed")
            with stats_lock:
                global error_count
                error_count += 1
            self.send_json(500, {"error": "analysis_failed"})
        finally:
            with stats_lock:
                inflight_count -= 1
            infer_lock.release()


class BoundedServer(ThreadingHTTPServer):
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
        request.settimeout(10)
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


if __name__ == "__main__":
    analyze("тест")
    server = BoundedServer(
        (
            os.environ.get("KUTEZH_TEXT_AI_BIND", "127.0.0.1"),
            int(os.environ.get("KUTEZH_TEXT_AI_PORT", "8092")),
        ),
        Handler,
    )
    server.daemon_threads = True
    logging.info(
        "text moderation server started model=%s version=%s labels=%d rss_kb=%d",
        MODEL_NAME,
        MODEL_VERSION,
        len(LABELS),
        process_rss_kb(),
    )
    server.serve_forever()
