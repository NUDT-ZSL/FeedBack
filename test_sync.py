#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线笔记同步链路的端到端 API 测试。
运行前先启动 server.py。覆盖：离线入队语义、顺序提交、幂等、
冲突检测、三种解决方式、中断后断点续传。
"""
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8765"
passed = failed = 0


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


def op(op_id, nid, t, base, title="T", content="C"):
    return {"op_id": op_id, "note_id": nid, "type": t,
            "base_version": base, "title": title, "content": content}


print("== 1. 离线改动按产生顺序提交 ==")
call("POST", "/api/debug/reset")
s, r = call("POST", "/api/op", op("op1", "n1", "create", 0, "现场记录", "第一段"))
check("create 应用成功", s == 200 and r["status"] == "applied" and r["version"] == 1)
s, r = call("POST", "/api/op", op("op2", "n1", "update", 1, "现场记录", "第一段+第二段"))
check("基于 v1 的 update 应用成功", s == 200 and r["version"] == 2)

print("== 2. 幂等：重试不会重复提交 ==")
s, r = call("POST", "/api/op", op("op2", "n1", "update", 1, "现场记录", "第一段+第二段"))
check("重复 op_id 返回 duplicate", s == 200 and r["status"] == "duplicate")
s, st = call("GET", "/api/state")
note = [n for n in st["notes"] if n["id"] == "n1"][0]
check("版本未被重复推进", note["version"] == 2, f"version={note['version']}")

print("== 3. 冲突检测：本地基于旧版本，服务端已有新版本 ==")
s, r = call("POST", "/api/debug/server-edit",
            {"note_id": "n1", "title": "现场记录", "content": "服务端他人修改"})
check("模拟服务端修改成功", s == 200 and r["note"]["version"] == 3)
s, r = call("POST", "/api/op", op("op3", "n1", "update", 2, "现场记录", "本地离线修改"))
check("旧基线提交返回 409 冲突", s == 409 and r["status"] == "conflict")
check("冲突响应带服务端快照", r["server_note"]["content"] == "服务端他人修改")
s, st = call("GET", "/api/state")
note = [n for n in st["notes"] if n["id"] == "n1"][0]
check("冲突时服务端内容未被覆盖", note["content"] == "服务端他人修改")

print("== 4. 冲突解决：保留本地 / 手动合并 ==")
s, r = call("POST", "/api/resolve",
            {"op_id": "rs1", "note_id": "n1", "base_version": 3,
             "title": "现场记录", "content": "合并后的内容"})
check("解决结果应用成功", s == 200 and r["version"] == 4)
s, r = call("POST", "/api/resolve",
            {"op_id": "rs2", "note_id": "n1", "base_version": 3,
             "title": "x", "content": "x"})
check("过期基线的解决被拒绝", s == 409)
s, r = call("POST", "/api/resolve",
            {"op_id": "rs1", "note_id": "n1", "base_version": 3,
             "title": "现场记录", "content": "合并后的内容"})
check("解决结果重试幂等", s == 200 and r["status"] == "duplicate")

print("== 5. 删除与删除冲突 ==")
s, r = call("POST", "/api/op", op("op9", "n1", "delete", 4))
check("delete 应用成功", s == 200)
s, r = call("POST", "/api/op", op("op10", "n1", "update", 4, "t", "c"))
check("已删除笔记的 update 报冲突", s == 409)

print("== 6. 断点续传语义（队列状态机） ==")
# 服务端只能验证幂等与顺序无关的正确性；中断保留由前端状态机保证，
# 这里验证：部分提交成功后，重放整个队列不会破坏数据。
call("POST", "/api/debug/reset")
call("POST", "/api/op", op("a1", "m1", "create", 0, "甲", "v1"))
call("POST", "/api/op", op("a2", "m1", "update", 1, "甲", "v2"))
# 模拟"提交到一半断网"：a3 未提交；重连后只补交 a3
s, r = call("POST", "/api/op", op("a3", "m1", "update", 2, "甲", "v3"))
check("断网恢复后续传成功", s == 200 and r["version"] == 3)
# 客户端异常重放已完成的 a1/a2：应幂等忽略
s1, r1 = call("POST", "/api/op", op("a1", "m1", "create", 0, "甲", "v1"))
s2, r2 = call("POST", "/api/op", op("a2", "m1", "update", 1, "甲", "v2"))
check("重放已完成改动被幂等忽略",
      r1["status"] == "duplicate" and r2["status"] == "duplicate")
s, st = call("GET", "/api/state")
note = [n for n in st["notes"] if n["id"] == "m1"][0]
check("重放后数据未被破坏", note["version"] == 3 and note["content"] == "v3")

print(f"\n结果: {passed} 通过, {failed} 失败")
raise SystemExit(1 if failed else 0)
