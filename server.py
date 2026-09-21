"""Local offline server for the semantic-tree / reading-order tool.

Standard library only. Serves the single-page UI and a small JSON API.
Run:  python server.py [--port 8000]
"""

import argparse
import copy
import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from semantic_tree import (ALWAYS_ANNOUNCED_ROLES, NAME_REQUIRED_ROLES,
                           SKIPPED_ROLES, ConflictError, SemanticTree)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "static")


class SchemeHistory:
    """Keeps named snapshots so the user can switch between schemes."""

    def __init__(self):
        self._entries = []  # [{label, snapshot}]
        self._current = -1

    def push(self, tree, label):
        # Drop any "future" entries if we branched from an older scheme.
        del self._entries[self._current + 1:]
        self._entries.append({"label": label,
                              "snapshot": copy.deepcopy(tree.snapshot())})
        self._current = len(self._entries) - 1

    def switch(self, index):
        if not 0 <= index < len(self._entries):
            raise ConflictError("", "history",
                                f"scheme #{index} does not exist")
        self._current = index
        return SemanticTree.from_snapshot(
            copy.deepcopy(self._entries[index]["snapshot"]))

    def list(self):
        return [{"index": i, "label": e["label"], "active": i == self._current}
                for i, e in enumerate(self._entries)]


class App:
    def __init__(self):
        self.tree = SemanticTree()
        self.history = SchemeHistory()
        self.lock = threading.Lock()
        self.history.push(self.tree, "初始（空树）")

    # Every mutating call goes through here: validate, then snapshot.
    def mutate(self, label, fn):
        with self.lock:
            trial = SemanticTree.from_snapshot(
                copy.deepcopy(self.tree.snapshot()))
            result = fn(trial)  # raises ConflictError -> nothing changes
            self.tree = trial
            self.history.push(self.tree, label)
            return result

    def switch(self, index):
        with self.lock:
            self.tree = self.history.switch(index)

    def state(self):
        with self.lock:
            data = self.tree.to_dict()
            data["history"] = self.history.list()
            data["roles"] = {
                "name_required": sorted(NAME_REQUIRED_ROLES),
                "skipped": sorted(SKIPPED_ROLES),
                "always_announced": sorted(ALWAYS_ANNOUNCED_ROLES),
            }
            return data


APP = App()


def handle_action(payload):
    """Dispatch one API action. Returns (status_code, body_dict)."""
    action = payload.get("action")
    try:
        if action == "add":
            el = APP.mutate(
                f"新增元素 {payload.get('id') or '(自动编号)'}",
                lambda t: t.add_element(
                    role=payload.get("role", "generic"),
                    name=payload.get("name", ""),
                    parent_id=payload.get("parent_id") or None,
                    element_id=payload.get("id") or None,
                    index=payload.get("index")))
            return 200, {"ok": True, "id": el.id}
        if action == "reparent":
            eid = payload["element_id"]
            APP.mutate(f"调整归属 {eid} -> {payload.get('new_parent_id') or '顶层'}",
                       lambda t: t.reparent(
                           eid, payload.get("new_parent_id") or None,
                           payload.get("index")))
            return 200, {"ok": True}
        if action == "reorder":
            eid = payload["element_id"]
            APP.mutate(f"调整顺序 {eid} -> 位置{payload.get('index')}",
                       lambda t: t.reorder(eid, int(payload.get("index", 0))))
            return 200, {"ok": True}
        if action == "set_role":
            eid = payload["element_id"]
            APP.mutate(f"修改角色 {eid} -> {payload.get('role')}",
                       lambda t: t.set_role(eid, payload.get("role", "")))
            return 200, {"ok": True}
        if action == "set_name":
            eid = payload["element_id"]
            APP.mutate(f"修改名称 {eid}",
                       lambda t: t.set_name(eid, payload.get("name", "")))
            return 200, {"ok": True}
        if action == "remove":
            eid = payload["element_id"]
            APP.mutate(f"删除 {eid}",
                       lambda t: t.remove_element(
                           eid, promote_children=bool(
                               payload.get("promote_children", True))))
            return 200, {"ok": True}
        if action == "switch":
            APP.switch(int(payload["index"]))
            return 200, {"ok": True}
        if action == "reset":
            with APP.lock:
                APP.tree = SemanticTree()
                APP.history.push(APP.tree, "清空（空树）")
            return 200, {"ok": True}
        return 400, {"ok": False, "error": f"unknown action '{action}'"}
    except ConflictError as exc:
        return 409, {"ok": False, "conflict": exc.to_dict()}
    except (KeyError, ValueError, TypeError) as exc:
        return 400, {"ok": False, "error": f"bad request: {exc}"}


class Handler(BaseHTTPRequestHandler):
    server_version = "SemanticTreeTool/1.0"

    def log_message(self, fmt, *args):  # quieter console
        pass

    def _send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send_file(os.path.join(STATIC_DIR, "index.html"),
                            "text/html; charset=utf-8")
        elif self.path == "/app.js":
            self._send_file(os.path.join(STATIC_DIR, "app.js"),
                            "text/javascript; charset=utf-8")
        elif self.path == "/api/state":
            self._send_json(200, APP.state())
        else:
            self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/api/action":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"ok": False, "error": f"bad json: {exc}"})
            return
        status, body = handle_action(payload)
        self._send_json(status, body)

    def _send_file(self, path, content_type):
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError:
            self._send_json(404, {"ok": False, "error": "file not found"})
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    parser = argparse.ArgumentParser(description="Offline semantic-tree tool")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Semantic tree tool running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
