# -*- coding: utf-8 -*-
import os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import VersionStore

TMP = "data/_test_versions.json"
shutil.copyfile("data/seed_versions.json", TMP)
s = VersionStore(TMP)

# 1. 载入 + 问题检测
assert len(s.versions) == 10
assert any(p["kind"] == "missing_parent" for p in s.problems.get("x1", [])), "x1 应标记缺失父版本"
assert any(p["kind"] == "cycle" for p in s.problems.get("c1", [])), "c1 应标记闭环"
assert any(p["kind"] == "cycle" for p in s.problems.get("c2", [])), "c2 应标记闭环"
print("1. 载入与问题标记 OK:", {k: [p["kind"] for p in v] for k, v in s.problems.items()})

# 2. 分叉点与差异依据
r = s.compare("v5", "f2")
assert r["fork"] == "v2", r["fork"]
assert set(r["basis"]) == {"v2", "v3", "v4", "v5", "f1", "f2"}
r2 = s.compare("v5", "f2")
assert r2["from_cache"] is True
print("2. 分叉点/差异/缓存 OK, fork =", r["fork"])

# 3. 精准失效
s.compare("v3", "v4"); s.compare("f1", "f2"); s.compare("v1", "v2")
inv = s.update_version("v5", {"summary": "补写第三章竞品分析(修订版)"})
assert "v5|f2" in inv["invalidated"], inv
assert "v3|v4" in inv["kept"] and "f1|f2" in inv["kept"] and "v1|v2" in inv["kept"], inv
print("3. 精准失效 OK, invalidated =", inv["invalidated"], "kept =", inv["kept"])

# 4. 撤销 -> 后代待处理 + 候选父版本
inv = s.revoke("v3")
assert s.versions["v3"]["revoked"] is True
assert s.versions["v4"]["pending"] is True
cands = [c["id"] for c in s.parent_candidates("v4")]
assert "v2" in cands and "v3" not in cands and "v4" not in cands and "v5" not in cands
print("4. 撤销/待处理/候选父版本 OK, candidates =", cands)

# 5. 重新指定父版本
s.reparent("v4", "v2")
assert s.versions["v4"]["pending"] is False
assert s.fork_point("v5", "f2") == "v2"
print("5. 重接父版本 OK")

# 6. 补录缺失父版本后问题消除
assert "x1" in s.problems
s.add_version({"id": "ghost9", "parent": "", "author": "外部顾问", "summary": "补录的外部底稿"})
assert "x1" not in s.problems
print("6. 补录后问题消除 OK")

os.remove(TMP)
print("ALL TESTS PASSED")
