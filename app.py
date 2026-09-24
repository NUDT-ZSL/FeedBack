# -*- coding: utf-8 -*-
"""本地交互界面服务：载入规则与请求、执行推导、接受临时改写并返回增量重推结果。"""
import json
import os

from flask import Flask, jsonify, request, send_from_directory

from engine import Engine

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")

with open(os.path.join(BASE, "sample_data.json"), encoding="utf-8") as f:
    SAMPLE = json.load(f)

app = Flask(__name__)
engine = Engine(SAMPLE)


@app.route("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC, filename)


@app.route("/api/state")
def state():
    return jsonify({
        "nodes": list(engine.nodes.values()),
        "rules": list(engine.rules.values()),
        "requests": list(engine.requests.values()),
        "results": engine.summaries(),
    })


@app.route("/api/trace/<qid>")
def trace(qid):
    d = engine.derivations.get(qid)
    if d is None:
        return jsonify({"error": "请求不存在: %s" % qid}), 404
    return jsonify({
        "request": engine.requests[qid],
        "outcome": d["outcome"],
        "trace": d["trace"],
        "route": d["route"],
        "deps": d["deps"],
    })


@app.route("/api/mutate", methods=["POST"])
def mutate():
    mut = request.get_json(force=True)
    try:
        report = engine.apply_mutation(mut)
    except (KeyError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(report)


@app.route("/api/reset", methods=["POST"])
def reset():
    engine.reset(SAMPLE)
    return jsonify({"ok": True, "results": engine.summaries()})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
