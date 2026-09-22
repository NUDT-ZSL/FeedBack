# -*- coding: utf-8 -*-
"""用户反馈聚类与需求线索系统 —— Flask 后端。

状态模型：feedbacks + decisions（决策日志）是唯一真源；
任何变更后都调用 clustering.recompute() 全量重算并持久化。
"""
from __future__ import annotations

import json
import os
import time

from flask import Flask, jsonify, request, send_from_directory

import clustering

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
STATE_FILE = os.environ.get("FEEDBACK_STATE_FILE",
                             os.path.join(DATA_DIR, "state.json"))

app = Flask(__name__, static_folder="static", static_url_path="/static")

state = {"feedbacks": [], "decisions": [], "next_fid": 1, "next_did": 1}
_result = {"clusters": [], "assignment": {}, "conflicts": []}


# ---------- 持久化 ----------

def save_state():
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_FILE)


def load_state():
    global state
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)


# ---------- 核心：全量重算 + 决策日志 ----------

def refresh():
    """每次变更后从头全量重算，保证界面结果 == 重算结果。"""
    global _result
    _result = clustering.recompute(state["feedbacks"], state["decisions"])


def _must_groups():
    uf = clustering._UnionFind([f["id"] for f in state["feedbacks"]])
    for d in state["decisions"]:
        if d["type"] == "must_link":
            uf.union(d["a"], d["b"])
    return uf


def add_decision(dtype, a, b, source, note=""):
    """追加决策；若与既有决策矛盾，以最新人工意图为准消解。"""
    if dtype == "must_link":
        # 新 must_link 会使跨组 cannot_link 失效 -> 移除
        uf = _must_groups()
        uf.union(a, b)
        state["decisions"] = [
            d for d in state["decisions"]
            if not (d["type"] == "cannot_link"
                    and d["a"] in uf.parent and d["b"] in uf.parent
                    and uf.find(d["a"]) == uf.find(d["b"]))
        ]
    else:  # cannot_link：若两端已被 must-link 链连通，逆序拆除直至断开
        uf = _must_groups()
        if a in uf.parent and b in uf.parent and uf.find(a) == uf.find(b):
            kept = list(state["decisions"])
            for d in reversed(list(kept)):
                if d["type"] != "must_link":
                    continue
                trial = [x for x in kept if x is not d]
                uf2 = clustering._UnionFind([f["id"] for f in state["feedbacks"]])
                for x in trial:
                    if x["type"] == "must_link":
                        uf2.union(x["a"], x["b"])
                if a not in uf2.parent or b not in uf2.parent \
                        or uf2.find(a) != uf2.find(b):
                    kept = trial
            state["decisions"] = kept
    state["decisions"].append({
        "id": state["next_did"], "type": dtype, "a": a, "b": b,
        "source": source, "note": note,
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
    })
    state["next_did"] += 1


def apply_ops(ops, source, note=""):
    for dtype, a, b in ops:
        add_decision(dtype, a, b, source, note)
    refresh()
    save_state()
    return full_state()


def retract_cannot_between(ids_x, ids_y):
    """撤回两组反馈之间的 cannot_link 决策（最新人工意图优先）。"""
    xs, ys = set(ids_x), set(ids_y)
    state["decisions"] = [d for d in state["decisions"] if not (
        d["type"] == "cannot_link" and (
            (d["a"] in xs and d["b"] in ys)
            or (d["a"] in ys and d["b"] in xs)))]


def full_state():
    return {
        "feedbacks": state["feedbacks"],
        "clusters": _result["clusters"],
        "assignment": _result["assignment"],
        "conflicts": _result["conflicts"],
        "leads": clustering.build_leads(_result["clusters"]),
        "decisions": state["decisions"],
        "meta": _result.get("meta", {}),
    }


# ---------- API ----------

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/state")
def api_state():
    return jsonify(full_state())


def _import_lines(lines, source):
    existing = {f["text"] for f in state["feedbacks"]}
    added, skipped = 0, 0
    for raw in lines:
        text = " ".join(str(raw).split())
        if not text:
            continue
        if text in existing:
            skipped += 1
            continue
        existing.add(text)
        state["feedbacks"].append({
            "id": state["next_fid"], "text": text, "source": source,
            "imported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        state["next_fid"] += 1
        added += 1
    refresh()
    save_state()
    out = full_state()
    out["import_report"] = {"added": added, "skipped_duplicates": skipped}
    return out


@app.route("/api/import", methods=["POST"])
def api_import():
    """界面粘贴导入：请求体 {"text": "每行一条反馈"}。"""
    text = (request.get_json(silent=True) or {}).get("text", "")
    return jsonify(_import_lines(text.splitlines(), "paste"))


@app.route("/api/import_file", methods=["POST"])
def api_import_file():
    """本地文件导入（.txt/.csv，每行一条；csv 取最后一列文本）。"""
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "未收到文件"}), 400
    raw = f.read().decode("utf-8-sig", errors="replace")
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if "," in line and line.lower().endswith((".txt",)) is False:
            parts = [p.strip().strip('"') for p in line.split(",")]
            line = parts[-1] if parts else line
        lines.append(line)
    return jsonify(_import_lines(lines, "file:%s" % f.filename))


@app.route("/api/move", methods=["POST"])
def api_move():
    body = request.get_json(force=True)
    fid = int(body["feedback_id"])
    if body["target_cluster_id"] != "new":
        # 移动意图优先：撤回该反馈与目标簇成员间既有的「分开」裁决
        tgt = next(c for c in _result["clusters"]
                   if c["id"] == body["target_cluster_id"])
        retract_cannot_between([fid], tgt["member_ids"])
    ops = clustering.decisions_for_move(
        _result, fid, body["target_cluster_id"])
    return jsonify(apply_ops(ops, "move",
                             "移动反馈 #%s -> %s" % (body["feedback_id"],
                                                     body["target_cluster_id"])))


@app.route("/api/merge", methods=["POST"])
def api_merge():
    body = request.get_json(force=True)
    # 合并意图优先：撤回两簇成员间既有的「分开」裁决
    ca = next(c for c in _result["clusters"] if c["id"] == body["cluster_a"])
    cb = next(c for c in _result["clusters"] if c["id"] == body["cluster_b"])
    retract_cannot_between(ca["member_ids"], cb["member_ids"])
    ops = clustering.decisions_for_merge(
        _result, body["cluster_a"], body["cluster_b"])
    return jsonify(apply_ops(ops, "merge",
                             "合并簇 %s 与 %s" % (body["cluster_a"],
                                                  body["cluster_b"])))


@app.route("/api/split", methods=["POST"])
def api_split():
    body = request.get_json(force=True)
    ids = [int(i) for i in body["feedback_ids"]]
    ops = clustering.decisions_for_split(_result, body["cluster_id"], ids)
    return jsonify(apply_ops(ops, "split",
                             "从簇 %s 拆出 %d 条" % (body["cluster_id"], len(ids))))


@app.route("/api/conflict", methods=["POST"])
def api_conflict():
    """冲突裁决：action = merge（归入同簇）/ separate（保持分开）。"""
    body = request.get_json(force=True)
    a, b = int(body["a"]), int(body["b"])
    if body["action"] == "merge":
        ops, note = [("must_link", a, b)], "冲突裁决：归入同簇"
    else:
        ops, note = [("cannot_link", a, b)], "冲突裁决：保持分开"
    return jsonify(apply_ops(ops, "conflict", note))


@app.route("/api/leads")
def api_leads():
    return jsonify({"leads": clustering.build_leads(_result["clusters"])})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    global state
    state = {"feedbacks": [], "decisions": [], "next_fid": 1, "next_did": 1}
    refresh()
    save_state()
    return jsonify(full_state())


load_state()
refresh()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5057)),
            debug=False)
