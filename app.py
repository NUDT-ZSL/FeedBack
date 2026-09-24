"""本地轨迹分段分析工具 Flask 后端。"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory

import segmenter
from segmenter import Point
import sample_data

app = Flask(__name__, static_folder="static", static_url_path="/static")

STATE = {
    "points": [],      # List[Point] 原始点
    "params": dict(segmenter.DEFAULT_PARAMS),
    "segments": [],
    "flags": {},
    "kept": [],
    "pts": [],         # 过滤漂移后的点列(分段下标基于它)
}


def parse_time(value):
    """支持 Unix 秒/毫秒与常见时间字符串。"""
    if isinstance(value, (int, float)):
        v = float(value)
        return v / 1000.0 if v > 1e12 else v
    s = str(value).strip()
    try:
        v = float(s)
        return v / 1000.0 if v > 1e12 else v
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19], fmt).timestamp()
        except ValueError:
            continue
    raise ValueError("无法解析时间: %r" % value)


def parse_records(payload):
    """接受 JSON 数组或 CSV 文本(time,lat,lon[,acc])。"""
    records = []
    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, str):
        text = payload.strip()
        if text.startswith("["):
            records = json.loads(text)
        else:
            rows = list(csv.reader(io.StringIO(text)))
            if rows and not rows[0][0].strip().replace(".", "", 1).isdigit():
                rows = rows[1:]  # 跳过表头
            records = [r for r in rows if len(r) >= 3]
    points = []
    for r in records:
        if isinstance(r, dict):
            t = parse_time(r.get("time", r.get("t")))
            lat, lon = float(r["lat"]), float(r.get("lon", r.get("lng")))
            acc = r.get("acc", r.get("accuracy"))
        else:
            t = parse_time(r[0])
            lat, lon = float(r[1]), float(r[2])
            acc = r[3] if len(r) > 3 and str(r[3]).strip() != "" else None
        points.append(Point(t=t, lat=lat, lon=lon,
                            acc=float(acc) if acc is not None else None))
    points.sort(key=lambda p: p.t)
    if len(points) < 2:
        raise ValueError("至少需要 2 条定位记录")
    return points


def run_analysis(points):
    segments, flags, kept = segmenter.segment(points, STATE["params"])
    STATE["points"] = points
    STATE["segments"] = segments
    STATE["flags"] = flags
    STATE["kept"] = kept
    STATE["pts"] = [points[i] for i in kept]


def state_payload():
    points = STATE["points"]
    return {
        "points": [{"t": p.t, "lat": p.lat, "lon": p.lon, "acc": p.acc}
                   for p in points],
        "kept_points": [{"t": p.t, "lat": p.lat, "lon": p.lon, "acc": p.acc}
                        for p in STATE["pts"]],
        "drift": {str(k): v for k, v in STATE["flags"].items()},
        "segments": STATE["segments"],
        "summary": segmenter.summarize(STATE["segments"], STATE["flags"]),
        "params": STATE["params"],
    }


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/sample")
def api_sample():
    run_analysis(sample_data.build())
    return jsonify(state_payload())


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    body = request.get_json(force=True)
    try:
        points = parse_records(body.get("data"))
    except (ValueError, KeyError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400
    if "params" in body and isinstance(body["params"], dict):
        for k, v in body["params"].items():
            if k in STATE["params"]:
                STATE["params"][k] = float(v)
    run_analysis(points)
    return jsonify(state_payload())


@app.route("/api/override", methods=["POST"])
def api_override():
    if not STATE["segments"]:
        return jsonify({"error": "尚未加载轨迹"}), 400
    body = request.get_json(force=True)
    try:
        segmenter.override_segment(STATE["segments"], STATE["pts"],
                                   int(body["id"]), body["type"], STATE["params"])
    except (ValueError, StopIteration, KeyError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(state_payload())


if __name__ == "__main__":
    print("轨迹分段分析工具: http://127.0.0.1:5050")
    app.run(host="127.0.0.1", port=5050, debug=False)
