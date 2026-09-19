# -*- coding: utf-8 -*-
"""离线评分工作台服务：标准库 HTTP 服务 + JSON API，无需联网依赖。"""
import json
import os
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from store import Store

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")

store = Store()


def seed_demo():
    """内置演示数据：覆盖冲突、缺测、前置阻断等典型情形。"""
    store.reset()
    rules = store.get_rules()
    rules["dimensions"] = {
        "theory": {"name": "理论掌握", "weight": 1, "pass_line": 60, "prereqs": []},
        "skill": {"name": "技能操作", "weight": 2, "pass_line": 70,
                  "prereqs": ["theory"]},
        "project": {"name": "项目实践", "weight": 2, "pass_line": 60,
                    "prereqs": ["skill"]},
        "attitude": {"name": "学习态度", "weight": 1, "pass_line": 60, "prereqs": []},
    }
    store.set_rules(rules)
    recs = []

    def add(s, d, v, who, at):
        recs.append({"student": s, "dimension": d, "value": v,
                     "evaluator": who, "recorded_at": at})
    # 张三：技能维度两位评价者冲突（B vs D），其余正常
    add("张三", "theory", "B", "王老师", "2026-09-10 10:00")
    add("张三", "skill", "B", "王老师", "2026-09-11 14:00")
    add("张三", "skill", "D", "李老师", "2026-09-11 16:30")
    add("张三", "project", 82, "王老师", "2026-09-15 09:00")
    add("张三", "attitude", "A", "辅导员", "2026-09-12 11:00")
    # 李四：理论未达标 -> 技能/项目被前置阻断；态度缺测
    add("李四", "theory", 45, "王老师", "2026-09-10 10:05")
    add("李四", "skill", 88, "李老师", "2026-09-11 14:10")
    add("李四", "project", 91, "王老师", "2026-09-15 09:20")
    # 王五：全部采证且等级取值一致
    add("王五", "theory", "A", "王老师", "2026-09-10 10:10")
    add("王五", "skill", 92, "李老师", "2026-09-11 14:20")
    add("王五", "project", "B", "王老师", "2026-09-15 09:40")
    add("王五", "attitude", "B", "辅导员", "2026-09-12 11:05")
    store.add_evidence(recs)


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200, ctype="application/json; charset=utf-8"):
        body = obj.encode("utf-8") if isinstance(obj, str) else \
            json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(STATIC, "index.html"), "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/state":
            with store._lock:
                s = {"students": store.list_students(), "rules": store.get_rules()}
            self._send(s)
        elif path.startswith("/api/student/"):
            name = path[len("/api/student/"):]
            import urllib.parse
            name = urllib.parse.unquote(name)
            with store._lock:
                detail = store.student_detail(name)
            self._send(detail if detail else {"error": "not found"},
                       200 if detail else 404)
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            data = self._body()
            if path == "/api/import":
                recs = data.get("records", [])
                for r in recs:
                    if not r.get("student") or not r.get("dimension") \
                            or "value" not in r:
                        raise ValueError("记录缺少 student/dimension/value 字段")
                with store._lock:
                    affected = store.add_evidence(recs)
                self._send({"ok": True, "affected": affected})
            elif path == "/api/rules":
                with store._lock:
                    affected = store.set_rules(data)
                self._send({"ok": True, "affected": affected})
            elif path == "/api/evidence/delete":
                with store._lock:
                    student = store.delete_evidence(data.get("id"))
                self._send({"ok": student is not None, "affected": student})
            elif path == "/api/verify":
                with store._lock:
                    ok, bad = store.verify_consistency()
                self._send({"ok": ok, "mismatched": bad})
            elif path == "/api/reset":
                with store._lock:
                    seed_demo()
                self._send({"ok": True})
            else:
                self._send({"error": "not found"}, 404)
        except (ValueError, KeyError) as e:
            self._send({"error": str(e)}, 400)


def main():
    if not store.list_students():
        seed_demo()
    port = 8765
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d/" % port
    print("评分工作台已启动：%s （按 Ctrl+C 停止）" % url)
    webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
