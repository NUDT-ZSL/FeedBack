"""Flask API + static UI for the multi-channel feedback triage system."""
import json
import os
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request, send_from_directory

from triage import TriageStore

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "data.json")

app = Flask(__name__, static_folder="static", static_url_path="/static")


def _load() -> TriageStore:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, encoding="utf-8") as f:
            return TriageStore.from_dict(json.load(f))
    return TriageStore()


def _save(store: TriageStore):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store.to_dict(), f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA_FILE)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/board")
def board():
    return jsonify(_load().board())


@app.post("/api/import")
def import_feedback():
    entries = (request.json or {}).get("entries", [])
    if not entries:
        return jsonify({"error": "entries 不能为空"}), 400
    for e in entries:
        if not e.get("text"):
            return jsonify({"error": "每条反馈必须包含 text"}), 400
    store = _load()
    result = store.import_feedback(entries)
    _save(store)
    return jsonify(result)


@app.post("/api/demands/<demand_id>/merge-confirm")
def merge_confirm(demand_id):
    body = request.json or {}
    store = _load()
    try:
        store.confirm_merge(demand_id, body["item_id"], body["accept"],
                            body.get("operator", "运营"))
    except KeyError as e:
        return jsonify({"error": str(e)}), 404
    _save(store)
    return jsonify(store.board())


@app.post("/api/demands/<demand_id>/contradictions/<cid>/resolve")
def resolve_contradiction(demand_id, cid):
    body = request.json or {}
    store = _load()
    try:
        store.resolve_contradiction(demand_id, cid,
                                    body.get("note", ""), body.get("operator", "运营"))
    except (KeyError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    _save(store)
    return jsonify(store.board())


@app.post("/api/demands/<demand_id>/adjudicate")
def adjudicate(demand_id):
    body = request.json or {}
    store = _load()
    try:
        store.adjudicate(demand_id, body["disposition"], body["priority"],
                         body.get("note", ""), body.get("operator", "运营"))
    except (KeyError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    _save(store)
    return jsonify(store.board())


@app.post("/api/demands/merge")
def merge_demands():
    body = request.json or {}
    store = _load()
    try:
        store.merge_demands(body["source_id"], body["target_id"],
                            body.get("operator", "运营"))
    except KeyError as e:
        return jsonify({"error": str(e)}), 404
    _save(store)
    return jsonify(store.board())


@app.post("/api/reset")
def reset():
    if os.path.exists(DATA_FILE):
        os.remove(DATA_FILE)
    return jsonify({"ok": True})


@app.post("/api/sample")
def load_sample():
    now = datetime.now(timezone.utc).astimezone()
    def ago(hours):
        return (now - timedelta(hours=hours)).isoformat(timespec="seconds")
    sample = [
        {"source": "工单", "feature": "数据导出",
         "text": "导出报表时系统崩溃，数据丢失，无法使用，请尽快处理",
         "reported_at": ago(5)},
        {"source": "社区", "feature": "数据导出",
         "text": "导出报表直接闪退报错，希望尽快修复导出功能",
         "reported_at": ago(30)},
        {"source": "客服记录", "feature": "数据导出",
         "text": "客户反馈导出报表失败，报错提示文件生成异常",
         "reported_at": ago(50)},
        {"source": "社区", "feature": "深色模式",
         "text": "希望保留深色模式的自动切换，很好用很方便",
         "reported_at": ago(10)},
        {"source": "工单", "feature": "深色模式",
         "text": "建议去掉深色模式自动切换，很难用，经常闪眼睛",
         "reported_at": ago(20)},
        {"source": "客服记录", "feature": "深色模式",
         "text": "有用户希望关闭深色模式自动切换，也有用户希望保留，反馈不一致",
         "reported_at": ago(26)},
        {"source": "工单", "feature": "消息通知",
         "text": "建议消息通知默认开启，太安静了容易错过工单",
         "reported_at": ago(3)},
        {"source": "社区", "feature": "消息通知",
         "text": "能不能优化一下通知设置，希望增加免打扰时段",
         "reported_at": ago(70)},
        {"source": "客服记录", "feature": "账号安全",
         "text": "用户担心账号存在安全风险，建议加强二次验证",
         "reported_at": ago(2)},
    ]
    store = _load()
    result = store.import_feedback(sample)
    _save(store)
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
