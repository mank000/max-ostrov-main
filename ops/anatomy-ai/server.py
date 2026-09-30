import json, os, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from detector import load, detect, MODEL_SHA

ROOT = Path(__file__).resolve().parent
MAX_BODY = 10 * 1024 * 1024


def main():
    session = load(ROOT / "models/320n.onnx")
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, payload):
            data = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.reply(
                    200,
                    {
                        "status": "ok",
                        "version": MODEL_SHA,
                        "source_url": "https://kutezh-social.ru/ai-components/anatomy-source.zip",
                    },
                )
            else:
                self.reply(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/analyze":
                self.reply(404, {"error": "not_found"})
                return
            if not lock.acquire(blocking=False):
                self.reply(503, {"error": "busy", "complete": False})
                return
            start = time.monotonic()
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise ValueError("Chunked request unsupported")
                n = int(self.headers.get("Content-Length", "0"))
                if not 0 < n <= MAX_BODY:
                    self.reply(413, {"error": "input_size", "complete": False})
                    return
                data = self.rfile.read(n)
                if len(data) != n:
                    raise ValueError("Incomplete input")
                self.reply(
                    200,
                    {
                        "complete": True,
                        "version": MODEL_SHA,
                        "scores": detect(data, session),
                        "latency_ms": round((time.monotonic() - start) * 1000, 2),
                    },
                )
            except (ValueError, OSError):
                self.reply(400, {"error": "invalid_image", "complete": False})
            except Exception:
                self.reply(503, {"error": "inference_failed", "complete": False})
            finally:
                lock.release()

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 8

        def __init__(self, *a):
            self.slots = threading.BoundedSemaphore(2)
            super().__init__(*a)

        def process_request(self, r, address):
            if not self.slots.acquire(blocking=False):
                try:
                    r.sendall(
                        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                finally:
                    self.shutdown_request(r)
                return
            r.settimeout(15)
            try:
                super().process_request(r, address)
            except BaseException:
                self.slots.release()
                raise

        def process_request_thread(self, *a):
            try:
                super().process_request_thread(*a)
            finally:
                self.slots.release()

    Server(
        (
            os.environ.get("KUTEZH_ANATOMY_AI_BIND", "127.0.0.1"),
            int(os.environ.get("KUTEZH_ANATOMY_AI_PORT", "8096")),
        ),
        Handler,
    ).serve_forever()


if __name__ == "__main__":
    main()
