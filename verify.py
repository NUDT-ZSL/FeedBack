# -*- coding: utf-8 -*-
"""端到端验证: 导入 -> 自动聚类 -> 人工修订 -> 冲突裁决 -> 需求线索。"""
import json
import urllib.request

BASE = "http://127.0.0.1:5050"


def call(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def check_consistent(s, step):
    ids = sorted(f["id"] for f in s["feedbacks"])
    assigned = sorted(m["id"] for c in s["clusters"] for m in c["members"])
    assert s["consistent"] and assigned == ids, "一致性校验失败 @ " + step
    print("[OK] %-28s 反馈=%d 簇=%d 冲突=%d 一致=%s"
          % (step, len(ids), len(s["clusters"]), len(s["conflicts"]), s["consistent"]))


sample = open("static/sample_feedback.txt", encoding="utf-8").read()

s = call("/api/reset", {})
s = call("/api/import", {"text": sample})
check_consistent(s, "1.导入+自动聚类")
assert all("representative" in c for c in s["clusters"])
assert s["leads"] == sorted(s["leads"], key=lambda l: -l["size"]), "线索未按规模排序"

# 找到"登录"相关大簇, 把其中一条移出为新簇
login = max(s["clusters"], key=lambda c: c["size"])
fid = login["members"][0]["id"]
s = call("/api/move", {"feedback_id": fid, "target_cluster_id": "new"})
check_consistent(s, "2.移出为新簇")

# 再把它移回原簇所在任意其他簇(验证移入)
target = [c["id"] for c in s["clusters"]
          if all(m["id"] != fid for m in c["members"])][0]
s = call("/api/move", {"feedback_id": fid, "target_cluster_id": target})
check_consistent(s, "3.移入其他簇")

# 拆分最大簇: 取前两条拆出
big = max(s["clusters"], key=lambda c: c["size"])
picked = [m["id"] for m in big["members"][:2]]
n_before = len(s["clusters"])
s = call("/api/split", {"cluster_id": big["id"], "feedback_ids": picked})
check_consistent(s, "4.拆分簇")
assert len(s["clusters"]) == n_before + 1, "拆分后簇数量未增加"

# 合并两个最小的簇
sizes = sorted(s["clusters"], key=lambda c: c["size"])
ids2 = [sizes[0]["id"], sizes[1]["id"]]
n_before = len(s["clusters"])
s = call("/api/merge", {"cluster_ids": ids2})
check_consistent(s, "5.合并簇")
assert len(s["clusters"]) == n_before - 1, "合并后簇数量未减少"

# 冲突裁决(若存在)
if s["conflicts"]:
    c = s["conflicts"][0]
    s = call("/api/resolve_conflict", {"a": c["a"], "b": c["b"], "action": "merge"})
    check_consistent(s, "6.冲突裁决-同簇")
    co = {}
    for i, cl in enumerate(s["clusters"]):
        for m in cl["members"]:
            co[m["id"]] = i
    assert co[c["a"]] == co[c["b"]], "冲突裁决(同簇)未生效"
    s = call("/api/resolve_conflict", {"a": c["a"], "b": c["b"], "action": "separate"})
    check_consistent(s, "7.冲突裁决-分开")
    co = {}
    for i, cl in enumerate(s["clusters"]):
        for m in cl["members"]:
            co[m["id"]] = i
    assert co[c["a"]] != co[c["b"]], "冲突裁决(分开)未生效"
else:
    print("[--] 当前数据无冲突, 跳过冲突裁决用例")

# 需求线索关联来源反馈
lead = s["leads"][0]
assert lead["feedback_ids"] and lead["size"] == len(lead["feedback_ids"])
print("[OK] 需求线索: 共 %d 条, 最大簇规模 %d, 决策日志 %d 条"
      % (len(s["leads"]), lead["size"], len(s["decisions"])))
print("全部验证通过")
