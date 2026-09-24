"""素材适配工作台 - 本地服务器(仅标准库, 无外部依赖)。

启动: python server.py [port]   默认端口 8000
数据持久化到同目录 data.json, 全部离线运行。
"""
import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fitlogic import derive_plan, STRATEGY_LABELS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

SEED = {
    "assets": [
        {"id": "a1", "name": "主视觉横幅", "width": 2400, "height": 900,
         "minReadable": {"width": 1800, "height": 600}},
        {"id": "a2", "name": "产品方图", "width": 1500, "height": 1500,
         "minReadable": {"width": 900, "height": 900}},
        {"id": "a3", "name": "竖版海报", "width": 1080, "height": 1920,
         "minReadable": {"width": 800, "height": 1400}},
    ],
    "specs": [
        {"id": "s1", "name": "首页 Banner", "width": 1920, "height": 640,
         "safeMargin": 60, "allowedStrategies": ["scale", "crop"]},
        {"id": "s2", "name": "信息流卡片", "width": 1080, "height": 1080,
         "safeMargin": 40, "allowedStrategies": ["scale", "crop", "recompose"]},
        {"id": "s3", "name": "App 开屏", "width": 1125, "height": 2436,
         "safeMargin": 80, "allowedStrategies": ["crop", "recompose"]},
    ],
    "assignments": [
        {"assetId": "a1", "specId": "s1", "override": None},
        {"assetId": "a1", "specId": "s2", "override": None},
        {"assetId": "a2", "specId": "s2", "override": None},
        {"assetId": "a3", "specId": "s3", "override": None},
    ],
}


def load_state():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    save_state(SEED)
    return json.loads(json.dumps(SEED))


def save_state(state):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def build_results(state):
    """对每个分配独立推导适配方案, 结果互不共享。"""
    assets = {a["id"]: a for a in state["assets"]}
    specs = {s["id"]: s for s in state["specs"]}
    results = []
    for asg in state["assignments"]:
        asset, spec = assets.get(asg["assetId"]), specs.get(asg["specId"])
        if not asset or not spec:
            continue
        plan = derive_plan(asset, spec, asg.get("override"))
        results.append({
            "assetId": asset["id"], "assetName": asset["name"],
            "specId": spec["id"], "specName": spec["name"],
            "override": asg.get("override"),
            "plan": plan,
        })
    return results


def find(items, item_id):
    return next((x for x in items if x["id"] == item_id), None)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        state = load_state()
        body = self._read_body()
        parts = [p for p in self.path.split("/") if p]  # e.g. api/assets/a1
        if len(parts) < 2 or parts[0] != "api":
            return self._send_json({"error": "not found"}, 404)
        coll = parts[1]

        if coll == "assets" and len(parts) == 2:
            item = {"id": uuid.uuid4().hex[:8], "name": body["name"],
                    "width": int(body["width"]), "height": int(body["height"]),
                    "minReadable": {"width": int(body.get("mrWidth", 0)),
                                    "height": int(body.get("mrHeight", 0))}}
            state["assets"].append(item)
        elif coll == "specs" and len(parts) == 2:
            item = {"id": uuid.uuid4().hex[:8], "name": body["name"],
                    "width": int(body["width"]), "height": int(body["height"]),
                    "safeMargin": int(body.get("safeMargin", 0)),
                    "allowedStrategies": body.get("allowedStrategies",
                                                  ["scale", "crop", "recompose"])}
            state["specs"].append(item)
        elif coll == "assignments" and len(parts) == 2:
            pair = (body["assetId"], body["specId"])
            if any(a["assetId"] == pair[0] and a["specId"] == pair[1]
                   for a in state["assignments"]):
                return self._send_json({"error": "该分配已存在"}, 409)
            state["assignments"].append(
                {"assetId": pair[0], "specId": pair[1], "override": None})
        else:
            return self._send_json({"error": "not found"}, 404)
        save_state(state)
        return self._send_json(self._state_with_results())

    def do_PUT(self):
        state = load_state()
        body = self._read_body()
        parts = [p for p in self.path.split("/") if p]
        if len(parts) < 3 or parts[0] != "api":
            return self._send_json({"error": "not found"}, 404)
        coll, item_id = parts[1], parts[2]

        if coll == "assets" and len(parts) == 3:
            item = find(state["assets"], item_id)
            if not item:
                return self._send_json({"error": "not found"}, 404)
            item.update({"name": body["name"], "width": int(body["width"]),
                         "height": int(body["height"]),
                         "minReadable": {"width": int(body.get("mrWidth", 0)),
                                         "height": int(body.get("mrHeight", 0))}})
        elif coll == "specs" and len(parts) == 3:
            item = find(state["specs"], item_id)
            if not item:
                return self._send_json({"error": "not found"}, 404)
            item.update({"name": body["name"], "width": int(body["width"]),
                         "height": int(body["height"]),
                         "safeMargin": int(body.get("safeMargin", 0)),
                         "allowedStrategies": body.get("allowedStrategies",
                                                       item["allowedStrategies"])})
        elif coll == "assignments" and len(parts) == 5 and parts[4] == "override":
            asg = next((a for a in state["assignments"]
                        if a["assetId"] == item_id and a["specId"] == parts[3]), None)
            if not asg:
                return self._send_json({"error": "not found"}, 404)
            asg["override"] = body.get("strategy")  # None 表示恢复自动
        else:
            return self._send_json({"error": "not found"}, 404)
        save_state(state)
        return self._send_json(self._state_with_results())

    def do_DELETE(self):
        state = load_state()
        parts = [p for p in self.path.split("/") if p]
        if len(parts) < 3 or parts[0] != "api":
            return self._send_json({"error": "not found"}, 404)
        coll, item_id = parts[1], parts[2]
        if coll == "assets":
            state["assets"] = [a for a in state["assets"] if a["id"] != item_id]
            state["assignments"] = [a for a in state["assignments"]
                                    if a["assetId"] != item_id]
        elif coll == "specs":
            state["specs"] = [s for s in state["specs"] if s["id"] != item_id]
            state["assignments"] = [a for a in state["assignments"]
                                    if a["specId"] != item_id]
        elif coll == "assignments" and len(parts) == 4:
            state["assignments"] = [
                a for a in state["assignments"]
                if not (a["assetId"] == item_id and a["specId"] == parts[3])]
        else:
            return self._send_json({"error": "not found"}, 404)
        save_state(state)
        return self._send_json(self._state_with_results())


    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _state_with_results(self):
        state = load_state()
        state["results"] = build_results(state)
        state["strategyLabels"] = STRATEGY_LABELS
        return state

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/api/state":
            return self._send_json(self._state_with_results())
        path = "/index.html" if self.path == "/" else self.path.split("?")[0]
        full = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            return self._send_json({"error": "not found"}, 404)
        ctype = {".html": "text/html", ".js": "text/javascript",
                 ".css": "text/css"}.get(os.path.splitext(full)[1], "text/plain")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    load_state()  # 首次运行生成种子数据
    print("素材适配工作台: http://127.0.0.1:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
