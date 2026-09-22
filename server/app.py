"""Local point cloud LOD viewer server.

Usage:  python server/app.py [--port 8765]
Then open http://127.0.0.1:8765/
"""
import argparse
import os
import sys
import time

import numpy as np
from flask import Flask, jsonify, request, send_from_directory, Response

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from octree import Dataset, load_pointcloud  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
VENDOR = os.path.join(ROOT, "vendor")
UPLOADS = os.path.join(ROOT, "data", "uploads")
os.makedirs(UPLOADS, exist_ok=True)

app = Flask(__name__, static_folder=None)
_state = {"dataset": None, "error": None}


@app.route("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.route("/web/<path:p>")
def web_files(p):
    return send_from_directory(WEB, p)


@app.route("/vendor/<path:p>")
def vendor_files(p):
    return send_from_directory(VENDOR, p)


def _set_dataset(path):
    t0 = time.time()
    pos, col = load_pointcloud(path)
    ds = Dataset(os.path.basename(path), pos, col)
    ds.build_seconds = round(time.time() - t0, 2)
    _state["dataset"] = ds
    _state["error"] = None
    return ds


@app.route("/api/load", methods=["POST"])
def api_load():
    path = (request.json or {}).get("path", "").strip()
    if not path:
        return jsonify({"ok": False, "error": "missing path"}), 400
    if not os.path.isabs(path):
        path = os.path.join(ROOT, path)
    if not os.path.isfile(path):
        return jsonify({"ok": False, "error": "file not found: %s" % path}), 404
    try:
        ds = _set_dataset(path)
    except Exception as exc:  # noqa: BLE001
        _state["error"] = str(exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    m = ds.meta()
    m["ok"] = True
    m["buildSeconds"] = ds.build_seconds
    return jsonify(m)


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "no file"}), 400
    safe = os.path.basename(f.filename)
    dst = os.path.join(UPLOADS, safe)
    f.save(dst)
    try:
        ds = _set_dataset(dst)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 500
    m = ds.meta()
    m["ok"] = True
    m["buildSeconds"] = ds.build_seconds
    return jsonify(m)


@app.route("/api/meta")
def api_meta():
    ds = _state["dataset"]
    if ds is None:
        return jsonify({"ok": False, "error": _state["error"] or "no dataset"}), 404
    m = ds.meta()
    m["ok"] = True
    return jsonify(m)


@app.route("/api/node/<path:nid>")
def api_node(nid):
    ds = _state["dataset"]
    if ds is None or nid not in ds.nodes:
        return Response("not found", status=404)
    return Response(ds.node_payload(nid), mimetype="application/octet-stream")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--load", default=None, help="point cloud file to load at startup")
    args = ap.parse_args()
    if args.load:
        ds = _set_dataset(args.load)
        print("loaded %s: %d points, %d nodes in %.1fs"
              % (ds.name, ds.total_points, len(ds.nodes), ds.build_seconds))
    print("Point cloud viewer: http://127.0.0.1:%d/" % args.port)
    app.run(host="127.0.0.1", port=args.port, threaded=True)
