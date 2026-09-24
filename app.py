"""本地复习规划工具：纯标准库 HTTP 服务，数据保存在本机 data.json。

运行：python app.py  （启动后自动在浏览器打开复习界面）
"""
import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import srs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
INDEX_FILE = os.path.join(BASE_DIR, "static", "index.html")
PORT = 8765

_lock = threading.Lock()


def load_items():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return []


def save_items(items):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


ITEMS = load_items()


def find_item(item_id):
    for it in ITEMS:
        if it["id"] == item_id:
            return it
    return None


def state_payload():
    with _lock:
        queue = [it["id"] for it in srs.today_queue(ITEMS)]
        return {
            "today": srs.today_str(),
            "queue": queue,
            "items": [srs.describe(it) for it in ITEMS],
        }


def import_items(raw_list):
    """批量导入，返回 (成功数, 错误列表)。"""
    ok, errors = 0, []
    with _lock:
        for i, raw in enumerate(raw_list):
            try:
                if not isinstance(raw, dict) or not raw.get("title"):
                    raise ValueError("缺少 title 字段")
                item = srs.make_item(
                    title=str(raw["title"]),
                    content=str(raw.get("content", "")),
                    mastery=float(raw.get("mastery", 0.3)),
                    importance=int(raw.get("importance", 3)),
                    last_review=raw.get("last_review") or None,
                    interval_days=raw.get("interval_days"),
                    streak=int(raw.get("streak", 0)),
                )
                srs._parse_day(item["last_review"])  # 校验日期
                ITEMS.append(item)
                ok += 1
            except (ValueError, TypeError, KeyError) as exc:
                errors.append("第 %d 条：%s" % (i + 1, exc))
        if ok:
            save_items(ITEMS)
    return ok, errors

class Handler(BaseHTTPRequestHandler):
    server_version = "ReviewPlanner/1.0"

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg, status=400):
        self._send_json({"error": msg}, status)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("请求体为空")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            raise ValueError("请求体不是合法的 JSON")

    def log_message(self, fmt, *args):  # 静默日志
        pass

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            try:
                with open(INDEX_FILE, "rb") as f:
                    body = f.read()
            except OSError:
                self._send_error("界面文件缺失：static/index.html", 500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/state":
            self._send_json(state_payload())
        else:
            self._send_error("未知接口：%s" % path, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/import":
                data = self._read_json()
                raw = data.get("items")
                if not isinstance(raw, list) or not raw:
                    raise ValueError("items 必须是非空数组")
                ok, errors = import_items(raw)
                self._send_json({"imported": ok, "errors": errors,
                                 "state": state_payload()})
            elif path == "/api/items":
                data = self._read_json()
                ok, errors = import_items([data])
                if errors:
                    raise ValueError(errors[0])
                self._send_json({"state": state_payload()})
            elif path.startswith("/api/items/") and path.endswith("/review"):
                item_id = path.split("/")[3]
                data = self._read_json()
                if "correct" not in data:
                    raise ValueError("缺少 correct 字段")
                with _lock:
                    item = find_item(item_id)
                    if item is None:
                        self._send_error("条目不存在：%s" % item_id, 404)
                        return
                    _, reasons = srs.apply_review(item, bool(data["correct"]))
                    save_items(ITEMS)
                self._send_json({"reasons": reasons, "state": state_payload()})
            else:
                self._send_error("未知接口：%s" % path, 404)
        except ValueError as exc:
            self._send_error(str(exc))
        except Exception as exc:  # 兜底，保证前端能收到错误提示
            self._send_error("服务器内部错误：%s" % exc, 500)

    def do_PUT(self):
        path = urlparse(self.path).path
        try:
            if path.startswith("/api/items/"):
                item_id = path.split("/")[3]
                changes = self._read_json()
                if not isinstance(changes, dict) or not changes:
                    raise ValueError("修改内容为空")
                allowed = {"mastery", "importance", "last_review",
                           "interval_days", "title", "content", "streak"}
                unknown = set(changes) - allowed
                if unknown:
                    raise ValueError("不支持的字段：%s" % ", ".join(sorted(unknown)))
                with _lock:
                    item = find_item(item_id)
                    if item is None:
                        self._send_error("条目不存在：%s" % item_id, 404)
                        return
                    _, reasons = srs.apply_manual_edit(item, changes)
                    save_items(ITEMS)
                self._send_json({"reasons": reasons, "state": state_payload()})
            else:
                self._send_error("未知接口：%s" % path, 404)
        except ValueError as exc:
            self._send_error(str(exc))
        except Exception as exc:
            self._send_error("服务器内部错误：%s" % exc, 500)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/items/"):
            item_id = path.split("/")[3]
            with _lock:
                item = find_item(item_id)
                if item is None:
                    self._send_error("条目不存在：%s" % item_id, 404)
                    return
                ITEMS.remove(item)
                save_items(ITEMS)
            self._send_json({"state": state_payload()})
        else:
            self._send_error("未知接口：%s" % path, 404)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = "http://127.0.0.1:%d/" % PORT
    print("复习规划工具已启动：%s （按 Ctrl+C 停止）" % url)
    print("数据保存在：%s" % DATA_FILE)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
