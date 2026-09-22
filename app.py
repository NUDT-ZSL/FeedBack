"""Flask backend for the comment anchor remapping demo."""

from flask import Flask, jsonify, request, send_from_directory

from anchors import DocumentTracker, Edit

app = Flask(__name__, static_folder="static", static_url_path="")

INITIAL_DOCUMENT = (
    "产品需求文档 v1\n"
    "本系统支持用户在线编辑文档，并在文档中添加批注。"
    "批注锚定在具体的文本片段上，编辑后需要重新计算位置。"
    "性能要求：单次映射耗时不超过 10 毫秒。"
    "本功能计划于第三季度发布。"
)


def _anchor(text, needle):
    s = text.index(needle)
    return {"start": s, "end": s + len(needle)}


def _build_tracker():
    comments = []
    specs = [
        ("并在文档中添加批注", "建议补充批注的权限控制说明。"),
        ("性能要求：单次映射耗时不超过 10 毫秒。", "10 毫秒的目标有实测数据支撑吗？"),
        ("第三季度", "发布时间需要和市场的同事再确认一下。"),
    ]
    for i, (needle, content) in enumerate(specs, start=1):
        a = _anchor(INITIAL_DOCUMENT, needle)
        comments.append({"id": i, "content": content, **a})
    return DocumentTracker(INITIAL_DOCUMENT, comments)


tracker = _build_tracker()


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/state")
def get_state():
    return jsonify(tracker.state())


@app.post("/api/edits")
def add_edit():
    body = request.get_json(force=True)
    try:
        edit = Edit(
            kind=body["kind"],
            pos=int(body["pos"]),
            length=int(body.get("length", 0)),
            text=body.get("text", ""),
        )
        state = tracker.add_edit(edit)
    except (KeyError, ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(state)


@app.post("/api/comments/<int:comment_id>/keep")
def keep_comment(comment_id):
    try:
        tracker.keep_comment(comment_id)
    except KeyError:
        return jsonify({"error": "comment not found"}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(tracker.state())


@app.post("/api/comments/<int:comment_id>/delete")
def delete_comment(comment_id):
    try:
        tracker.delete_comment(comment_id)
    except KeyError:
        return jsonify({"error": "comment not found"}), 404
    return jsonify(tracker.state())


@app.post("/api/reset")
def reset():
    global tracker
    tracker = _build_tracker()
    return jsonify(tracker.state())


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", "5071"))
    app.run(host="127.0.0.1", port=port, debug=False)
