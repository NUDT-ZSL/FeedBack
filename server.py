"""Offline local server for the movement-pattern review tool.

Run:  python server.py [port]     then open http://127.0.0.1:8017/
Stdlib only; no network access needed at runtime.
"""
import csv
import io
import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from store import Store

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
STORE = Store()


def parse_time(v):
    """Accept epoch seconds or an ISO-like timestamp; return epoch seconds."""
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    try:
        return float(s)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
                "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except ValueError:
            continue
    raise ValueError("unparseable time: %r" % s)


def parse_import(text):
    """Parse CSV or JSON text into raw point dicts."""
    text = text.strip()
    if not text:
        return []
    if text[0] in "[{":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("points", [])
        return [{"target": r["target"], "t": parse_time(r.get("t", r.get("time"))),
                 "lat": r["lat"], "lon": r["lon"]} for r in data]
    rows = list(csv.DictReader(io.StringIO(text)))
    out = []
    for r in rows:
        key_t = "t" if "t" in r else "time"
        out.append({"target": r["target"], "t": parse_time(r[key_t]),
                    "lat": float(r["lat"]), "lon": float(r["lon"])})
    return out


def state_payload():
    s = STORE
    return {
        "params": s.params,
        "points": sorted(s.points.values(), key=lambda p: (p["target"], p["t"], p["seq"])),
        "segments": s.segments,
        "relations": [r for key in sorted(s.relations) for r in s.relations[key]],
        "events": s.events,
        "verify": s.verify(),
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200, ctype="application/json; charset=utf-8"):
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8") or "{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            return self._send(state_payload())
        if path == "/":
            path = "/index.html"
        fp = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            return self._send({"error": "not found"}, 404)
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
                 ".css": "text/css"}.get(os.path.splitext(fp)[1], "text/plain")
        with open(fp, "rb") as f:
            return self._send(f.read(), 200, ctype)

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            d = self._body()
            if path == "/api/import":
                pts = parse_import(d.get("text", "")) if "text" in d else [
                    {"target": p["target"], "t": parse_time(p.get("t", p.get("time"))),
                     "lat": p["lat"], "lon": p["lon"]} for p in d.get("points", [])]
                STORE.add_points(pts)
            elif path == "/api/point/update":
                f = dict(d.get("fields", {}))
                if "t" in f:
                    f["t"] = parse_time(f["t"])
                STORE.update_point(d["id"], f)
            elif path == "/api/point/delete":
                STORE.delete_point(d["id"])
            elif path == "/api/params":
                STORE.set_params(d)
            elif path == "/api/reset":
                STORE.__init__()
            else:
                return self._send({"error": "unknown route"}, 404)
            return self._send(state_payload())
        except Exception as e:  # surface data problems to the UI
            return self._send({"error": str(e)}, 400)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8017
    print("Serving on http://127.0.0.1:%d/  (Ctrl+C to stop)" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
