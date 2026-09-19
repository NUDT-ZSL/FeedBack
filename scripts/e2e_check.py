"""End-to-end smoke test against a live local server (not for CI)."""
import json
import os
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from feedback_app.server import serve
from feedback_app.store import Store

BASE = "http://127.0.0.1:8899"


def req(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                              headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main():
    store = Store(path=None)
    t = threading.Thread(target=serve, args=(store, "127.0.0.1", 8899), daemon=True)
    t.start()
    time.sleep(0.5)

    with urllib.request.urlopen(BASE + "/") as resp:
        assert resp.status == 200 and b"html" in resp.read()
    print("static UI ok")

    samples = [
        ("客服", "登录时提示密码错误，明明输入的是对的", ["登录"]),
        ("问卷", "登录失败，一直说密码不对", ["登录"]),
        ("App", "希望增加深色模式，晚上太刺眼", ["界面"]),
        ("App", "建议出夜间深色主题", []),
        ("客服", "导出报表经常卡在百分之九十", ["报表"]),
    ]
    for source, text, tags in samples:
        s, _ = req("/api/feedback", "POST",
                    {"source": source, "text": text, "tags": tags})
        assert s == 200
    _, st = req("/api/state")
    print("clusters:", [(c["label"][:12], len(c["member_ids"]))
                        for c in st["clusters"]])
    assert st["evidence"], "expected borderline evidence"

    ids = [c["id"] for c in st["clusters"]]
    s, r = req("/api/op/merge", "POST",
               {"cluster_a": ids[0], "ids": None, "cluster_b": ids[1]})
    print("merge:", s, r["message"])

    _, st = req("/api/state")
    big = max(st["clusters"], key=lambda c: len(c["member_ids"]))
    s, r = req("/api/op/split", "POST",
               {"cluster_id": big["id"], "feedback_ids": big["member_ids"][:1]})
    print("split:", s, r["message"])

    _, st = req("/api/state")
    tgt = st["clusters"][0]["id"]
    fb_id = st["clusters"][-1]["members"][0]["id"]
    s, r = req("/api/op/move", "POST",
               {"feedback_id": fb_id, "target_cluster_id": tgt})
    print("move:", s, r["message"])

    s, _ = req("/api/feedback/" + fb_id, "PUT", {"text": "完全无关的内容zzz"})
    print("edit:", s)
    s, _ = req("/api/feedback/" + fb_id, "DELETE")
    print("delete:", s)

    s, r = req("/api/settings", "POST", {"threshold": 0.12, "band": 0.05})
    print("settings:", s)
    s, r = req("/api/op/reset", "POST", {})
    print("reset:", s, r["message"])
    print("E2E OK")


if __name__ == "__main__":
    main()
