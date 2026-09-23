"""Local HTTP server for the note-threading app (stdlib only)."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from core import Engine, UserError

ROOT = os.path.dirname(os.path.abspath(__file__))
ENGINE = Engine()


def parse_lines(text):
    """Parse lines of 'source | time | text' (or bare text) into notes."""
    notes = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3:
            notes.append({"source": parts[0], "ts": parts[1],
                          "text": "|".join(parts[2:]).strip()})
        else:
            notes.append({"text": line})
    return notes


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path, ctype):
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            self._send({"error": "not found"}, 404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send_file(os.path.join(ROOT, "static", "index.html"),
                            "text/html; charset=utf-8")
        elif self.path == "/api/state":
            self._send(ENGINE.state())
        elif self.path == "/api/sample":
            self._send_file(os.path.join(ROOT, "sample_notes.json"),
                            "application/json; charset=utf-8")
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
            if self.path == "/api/import":
                notes = body.get("notes")
                if notes is None and "text" in body:
                    notes = parse_lines(body["text"])
                if not notes:
                    raise UserError("没有可导入的笔记")
                ENGINE.add_notes(notes)
                st = ENGINE.state()
                st["affected"] = [t["id"] for t in st["threads"]]
                self._send(st)
            elif self.path == "/api/move":
                affected = ENGINE.move_note(body["note_id"], body["target"])
                self._send(ENGINE.state(affected))
            elif self.path == "/api/merge":
                affected = ENGINE.merge_threads(body["thread_a"], body["thread_b"])
                self._send(ENGINE.state(affected))
            elif self.path == "/api/split":
                affected = ENGINE.split_note(body["note_id"])
                self._send(ENGINE.state(affected))
            elif self.path == "/api/undo":
                ENGINE.undo()
                st = ENGINE.state()
                st["affected"] = [t["id"] for t in st["threads"]]
                self._send(st)
            elif self.path == "/api/reset":
                ENGINE.reset()
                self._send(ENGINE.state())
            else:
                self._send({"error": "not found"}, 404)
        except UserError as e:
            self._send({"error": str(e)}, e.status)
        except (KeyError, ValueError) as e:
            self._send({"error": "请求参数错误: %s" % e}, 400)
        except Exception as e:  # noqa: BLE001
            self._send({"error": "服务器错误: %s" % e}, 500)

    def log_message(self, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "8000"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("笔记线索整理应用已启动: http://127.0.0.1:%d" % port)
    srv.serve_forever()


if __name__ == "__main__":
    main()
