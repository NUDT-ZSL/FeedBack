"""Local trajectory stop/move analysis tool.

Run:  python app.py [--port 8765] [--no-browser]
Then open the printed URL. No third-party dependencies.
"""
import csv
import io
import json
import os
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import analysis
import sample_data

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

TIME_KEYS = ("time", "timestamp", "t", "datetime", "ts", "时间", "时间戳")
LAT_KEYS = ("lat", "latitude", "纬度")
LON_KEYS = ("lon", "lng", "long", "longitude", "经度")
ACC_KEYS = ("acc", "accuracy", "radius", "hacc", "精度", "精度半径")
DEV_KEYS = ("device", "device_id", "dev", "设备")

SESSION = {}


class Server(ThreadingHTTPServer):
    # Windows treats SO_REUSEADDR as "allow hijacking a bound port"; disable it
    # so a port clash fails loudly instead of silently splitting requests.
    allow_reuse_address = False


def parse_time(v):
    if isinstance(v, (int, float)):
        x = float(v)
    else:
        s = str(v).strip()
        try:
            x = float(s)
        except ValueError:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    if x > 1e12:
        x /= 1000.0
    return x


def _pick(row, keys):
    for k in keys:
        if k in row and row[k] not in (None, ""):
            return row[k]
    return None


def normalize(rec):
    if not isinstance(rec, dict):
        raise ValueError("记录必须是对象")
    low = {str(k).strip().lower(): v for k, v in rec.items()}
    t = _pick(low, TIME_KEYS)
    lat = _pick(low, LAT_KEYS)
    lon = _pick(low, LON_KEYS)
    if t is None or lat is None or lon is None:
        raise ValueError("缺少 time/lat/lon 字段: %r" % (rec,))
    acc = _pick(low, ACC_KEYS)
    return {
        "t": parse_time(t),
        "lat": float(lat),
        "lon": float(lon),
        "acc": float(acc) if acc is not None else None,
        "device": str(_pick(low, DEV_KEYS) or ""),
    }


def parse_points(text):
    text = text.strip()
    if not text:
        raise ValueError("空数据")
    if text[0] in "[{":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("points") or data.get("records") or []
        rows = [normalize(r) for r in data]
    else:
        reader = csv.DictReader(io.StringIO(text))
        rows = [normalize(r) for r in reader]
    if len(rows) < 2:
        raise ValueError("有效定位点不足（至少需要 2 个）")
    rows.sort(key=lambda p: p["t"])
    return rows


def payload():
    return {"points": SESSION["points"], "drift": SESSION["drift"],
            "notices": SESSION["notices"], "segments": SESSION["segments"],
            "stats": analysis.compute_stats(SESSION["segments"])}


def load_points(raw_points):
    result = analysis.analyze(raw_points)
    SESSION.clear()
    SESSION.update(result)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC_DIR, **kw)

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0)))

    def do_GET(self):
        if self.path == "/":
            self.path = "/index.html"
        if self.path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        super().do_GET()

    def do_POST(self):
        try:
            if self.path == "/api/analysis":
                return self._json(payload())
            if self.path == "/api/sample":
                load_points(sample_data.generate())
                return self._json(payload())
            if self.path == "/api/load":
                load_points(parse_points(self._body().decode("utf-8-sig")))
                return self._json(payload())
            if self.path == "/api/override":
                req = json.loads(self._body().decode("utf-8"))
                if req.get("type") not in ("stop", "move"):
                    return self._json({"error": "type 必须是 stop 或 move"}, 400)
                seg = analysis.apply_override(SESSION["points"],
                                              SESSION["segments"],
                                              int(req["segment_id"]),
                                              req["type"])
                out = payload()
                out["changed"] = seg
                return self._json(out)
            return self._json({"error": "not found"}, 404)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return self._json({"error": str(exc)}, 400)


def main():
    port = 8765
    open_browser = "--no-browser" not in sys.argv
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    load_points(sample_data.generate())
    try:
        server = Server(("127.0.0.1", port), Handler)
    except OSError:
        print("端口 %d 被占用，请用 --port 指定其他端口" % port)
        sys.exit(1)
    url = "http://127.0.0.1:%d/" % port
    print("轨迹分段分析工具已启动: %s  (Ctrl+C 退出)" % url)
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser_open(url)).start()
    server.serve_forever()


def webbrowser_open(url):
    try:
        webbrowser.open(url)
    except Exception:
        pass


if __name__ == "__main__":
    main()
