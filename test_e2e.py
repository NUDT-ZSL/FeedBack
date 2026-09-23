# -*- coding: utf-8 -*-
"""端到端验证:导入、定位、归纳、候选、增量调整。"""
import json
import urllib.request

BASE = "http://127.0.0.1:5050"


def post(path, body):
    req = urllib.request.Request(BASE + path,
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def get(path):
    return json.load(urllib.request.urlopen(BASE + path))


r = post("/api/sample", {})
print("stats:", r["stats"])
s = r["state"]
assert r["stats"]["events"] == 7, r["stats"]
assert r["stats"]["incomplete"] == 4, r["stats"]
assert r["stats"]["correct"] == 2, r["stats"]

for p in s["patterns"]:
    print(" ", p["id"], p["label"], "| events:", p["event_ids"],
          "| rev:", p["revision"])
for i in s["incompletes"]:
    print("  incomplete:", i["record_id"], "|", i["reason"],
          "|", i["missing_position"])

t = [t for t in s["trajectories"] if t["record_id"] == "R1"][0]
marks = [(st["index"], st["reached"], st["is_error"]) for st in t["steps"]]
print("R1 trajectory:", marks)
assert marks[1] == (1, True, True) and marks[2][0] == 2 and not marks[2][1]

# 候选归属:取 S01 移项模式中的一条事件
pat_move = [p for p in s["patterns"] if "移项" in p["label"]][0]
eid = pat_move["event_ids"][0]
c = get("/api/events/%s/candidates" % eid)
print("candidates for", eid, ":", [(x["pattern_id"], x["score"]) for x in c["candidates"]])
assert len(c["candidates"]) >= 2, "应能看到多个候选归属"

# 手动调整:把该事件改归到「去括号」模式,验证只有两个模式被重新归纳
target = [p for p in s["patterns"] if "去括号" in p["label"]][0]["id"]
before = {p["id"]: p["revision"] for p in s["patterns"]}
r2 = post("/api/reassign", {"event_id": eid, "target": target})
after = {p["id"]: p["revision"] for p in r2["state"]["patterns"]}
changed = [pid for pid in before if pid in after and after[pid] != before[pid]]
print("changed patterns:", r2["changed"], "revision bumped:", changed)
assert set(r2["changed"]) == {pat_move["id"], target}
assert set(changed) <= set(r2["changed"])
untouched = [pid for pid in before if pid not in r2["changed"]]
assert all(after[pid] == before[pid] for pid in untouched), "其余模式必须保持不变"
assert eid in [p for p in r2["state"]["patterns"] if p["id"] == target][0]["event_ids"]

# 新建模式
r3 = post("/api/reassign", {"event_id": eid, "target": "new"})
newp = [p for p in r3["state"]["patterns"] if eid in p["event_ids"]][0]
print("new pattern:", newp["id"], newp["label"])
assert newp["id"] not in before
print("ALL TESTS PASSED")

