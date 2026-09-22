from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .engine import QueueEngine
from .loader import ManifestError, load_manifest, parse_manifest
from .models import Manifest

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"


class AppSession:
    def __init__(self, manifest: Manifest, tick_seconds: float = 0.8, auto_start: bool = True):
        self.engine = QueueEngine(manifest)
        self.tick_seconds = tick_seconds
        self.running = auto_start
        self.lock = threading.RLock()
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name="queue-clock", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        while not self._stop.wait(self.tick_seconds):
            with self.lock:
                if self.running:
                    self.engine.tick()

    def replace_manifest(self, manifest: Manifest) -> None:
        with self.lock:
            self.engine = QueueEngine(manifest)

    def stop(self) -> None:
        self._stop.set()


def create_handler(session_holder: dict[str, AppSession]):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AutoDemoQueue/1.0"

        def log_message(self, fmt: str, *args: object) -> None:
            return

        def _json(self, payload: object, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _file(self, path: Path, content_type: str) -> None:
            if not path.exists():
                self._json({"error": "not found"}, 404)
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            route = urlparse(self.path).path
            if route == "/api/state":
                with session_holder["session"].lock:
                    payload = session_holder["session"].engine.to_dict()
                    payload["sim_running"] = session_holder["session"].running
                self._json(payload)
            elif route == "/":
                self._file(STATIC / "index.html", "text/html; charset=utf-8")
            elif route == "/app.js":
                self._file(STATIC / "app.js", "application/javascript; charset=utf-8")
            elif route == "/styles.css":
                self._file(STATIC / "styles.css", "text/css; charset=utf-8")
            else:
                self._json({"error": "not found"}, 404)

        def do_POST(self) -> None:
            route = urlparse(self.path).path
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length else b"{}"
                body = json.loads(raw.decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError) as exc:
                self._json({"error": f"请求 JSON 无效：{exc}"}, 400)
                return
            try:
                session = session_holder["session"]
                with session.lock:
                    if route == "/api/load":
                        manifest = parse_manifest(body.get("manifest", body))
                        session.replace_manifest(manifest)
                        self._json({"ok": True, "state": session.engine.to_dict()})
                    elif route == "/api/tasks/fail":
                        session.engine.fail_task(str(body["task_id"]), str(body.get("reason", "手动模拟失败")))
                        self._json(session.engine.to_dict())
                    elif route == "/api/tasks/retry":
                        session.engine.retry_task(str(body["task_id"]))
                        self._json(session.engine.to_dict())
                    elif route == "/api/machines/pause":
                        session.engine.set_machine_paused(str(body["machine_id"]), bool(body.get("paused", True)))
                        self._json(session.engine.to_dict())
                    elif route == "/api/materials/replace":
                        impact = session.engine.replace_material(
                            str(body["material_id"]),
                            str(body.get("new_version", "new")),
                            bool(body.get("rerun", False)),
                            body.get("selected_tasks"),
                        )
                        self._json({"impact": impact, "state": session.engine.to_dict()})
                    elif route == "/api/materials/impact":
                        self._json(session.engine.material_impact(
                            str(body["material_id"]), str(body.get("new_version", "new"))
                        ))
                    elif route == "/api/stale/accept":
                        accepted = session.engine.accept_stale(body.get("task_ids"))
                        self._json({"accepted": accepted, "state": session.engine.to_dict()})
                    elif route == "/api/sim":
                        session.running = bool(body.get("running", not session.running))
                        if body.get("tick"):
                            session.engine.tick()
                        state = session.engine.to_dict()
                        state["sim_running"] = session.running
                        self._json(state)
                    elif route == "/api/reset":
                        manifest = session.engine.manifest
                        session.replace_manifest(manifest)
                        self._json(session.engine.to_dict())
                    else:
                        self._json({"error": "not found"}, 404)
            except (KeyError, ValueError, ManifestError) as exc:
                issues = getattr(exc, "issues", None)
                if issues:
                    self._json({"error": str(exc), "issues": [item.to_dict() for item in issues]}, 400)
                else:
                    self._json({"error": str(exc)}, 400)

    return Handler


def run_server(manifest_path: str | Path, host: str = "127.0.0.1", port: int = 8765) -> None:
    manifest = load_manifest(manifest_path)
    holder = {"session": AppSession(manifest)}
    server = ThreadingHTTPServer((host, port), create_handler(holder))
    print(f"AutoDemo 队列操作台：http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        holder["session"].stop()
        server.server_close()
