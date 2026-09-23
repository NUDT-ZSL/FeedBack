"""运营指标异常归因分析 — 本地 Flask 应用。"""
from __future__ import annotations

from flask import Flask, jsonify, request, send_from_directory

import analysis
import sample_data
from attribution import AttributionEngine

app = Flask(__name__, static_folder="static", static_url_path="/static")

STATE = {"engine": None, "segments": [], "issues": [], "series": {}, "events": None}


def _series_payload():
    out = {}
    for metric, df in STATE["series"].items():
        out[metric] = {
            "dates": [d.strftime("%Y-%m-%d") for d in df.index],
            "values": [round(float(v), 4) for v in df["value"]],
            "baseline": [round(float(v), 4) for v in df["baseline"]],
            "missing": [bool(x) for x in df["is_missing"]],
        }
    return out


def _events_payload():
    ev = STATE["events"]
    return [{
        "event_id": str(r["event_id"]), "event_type": r["event_type"],
        "description": r["description"],
        "date": r["date"].strftime("%Y-%m-%d"),
        "end_date": r["end_date"].strftime("%Y-%m-%d"),
        "metric": r["metric"], "direction": r["direction"],
    } for _, r in ev.iterrows()] if ev is not None else []


def _rebuild(metrics_csv: str, events_csv: str):
    metrics_df, m_issues = analysis.load_metrics(metrics_csv)
    events_df, e_issues = analysis.load_events(events_csv)
    series, s_issues = analysis.build_series(metrics_df)
    segments = analysis.detect_segments(series)
    STATE.update(series=series, events=events_df, segments=segments,
                 issues=m_issues + e_issues + s_issues,
                 engine=AttributionEngine(series, events_df, segments))


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/sample", methods=["POST"])
def load_sample():
    m, e = sample_data.generate()
    _rebuild(m, e)
    return overview()


@app.route("/api/import", methods=["POST"])
def import_data():
    payload = request.get_json(force=True)
    try:
        _rebuild(payload.get("metrics_csv", ""), payload.get("events_csv", ""))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    return overview()


@app.route("/api/overview")
def overview():
    if STATE["engine"] is None:
        return jsonify({"loaded": False})
    eng: AttributionEngine = STATE["engine"]
    segs = []
    for s in STATE["segments"]:
        r = eng.rank(s["id"])
        segs.append({**s, "top_causes": [
            {"event_id": c["event_id"], "event_type": c["event_type"],
             "score": c["score"], "status": c["status"]}
            for c in r["active"][:3]]})
    return jsonify({
        "loaded": True, "segments": segs, "issues": STATE["issues"],
        "series": _series_payload(), "events": _events_payload(),
    })


@app.route("/api/segment/<seg_id>")
def segment_detail(seg_id):
    eng: AttributionEngine = STATE["engine"]
    if eng is None or seg_id not in eng.segments:
        return jsonify({"error": "未知区段"}), 404
    return jsonify({"segment": eng.segments[seg_id], "ranking": eng.rank(seg_id),
                    "history": eng.history[seg_id]})


@app.route("/api/segment/<seg_id>/adjust", methods=["POST"])
def adjust(seg_id):
    eng: AttributionEngine = STATE["engine"]
    if eng is None:
        return jsonify({"error": "尚未导入数据"}), 400
    payload = request.get_json(force=True)
    try:
        ranking, record = eng.adjust(seg_id, str(payload.get("event_id", "")),
                                     payload.get("action", ""), payload.get("weight"))
    except (KeyError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ranking": ranking, "record": record,
                    "history": eng.history[seg_id]})


@app.route("/api/segment/<seg_id>/history")
def history(seg_id):
    eng: AttributionEngine = STATE["engine"]
    if eng is None or seg_id not in eng.segments:
        return jsonify({"error": "未知区段"}), 404
    return jsonify({"history": eng.history[seg_id]})


if __name__ == "__main__":
    print("运营指标异常归因分析已启动: http://127.0.0.1:5050")
    app.run(host="127.0.0.1", port=5050, debug=False)
