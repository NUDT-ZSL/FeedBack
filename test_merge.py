# -*- coding: utf-8 -*-
"""合并引擎规则测试: python test_merge.py"""
import json
import os

from merge import MergeEngine

BASE = os.path.dirname(os.path.abspath(__file__))


def sample():
    with open(os.path.join(BASE, "sample", "document.json"), encoding="utf-8") as f:
        doc = json.load(f)
    with open(os.path.join(BASE, "sample", "edits.json"), encoding="utf-8") as f:
        edits = json.load(f)
    return MergeEngine(doc, edits)


PASS = 0


def check(name, cond, detail=""):
    global PASS
    assert cond, "失败: %s %s" % (name, detail)
    PASS += 1
    print("PASS %s" % name)


def st(eng, eid):
    return eng.edits[eid]["status"]


eng = sample()
g1 = eng.group_info("p1")
check("两条替换同段落被识别为冲突", g1["conflict"])
check("冲突说明包含双方来源",
      "张伟" in g1["conflict_desc"] and "李娜" in g1["conflict_desc"])
check("冲突时预览不简单覆盖，保留原文",
      eng._merged_text("p1", eng.paragraph_map()["p1"]["text"], False)
      .startswith("本文档描述协作编辑器后端服务的核心需求，供开发与测试"))
check("可组合编辑(追加+插入)不构成冲突", not eng.group_info("p2")["conflict"])
check("不存在的目标段落使编辑失效", st(eng, "e10") == "invalidated")
check("失效原因已说明", "不存在" in eng.edits["e10"]["reason"])
check("初始未解决清单包含冲突组",
      any(u["target"] == "p1" and u["conflict"] for u in eng.unresolved()))

# 接受其中一条替换 -> 另一条被取代，段落内不残留矛盾
eng.decide("e1", "accept")
check("接受 e1 后 e2 自动被取代", st(eng, "e2") == "superseded")
check("取代原因已说明", "e1" in eng.edits["e2"]["reason"])
check("p1 预览采用已接受内容",
      eng._merged_text("p1", "", False).startswith("本文档描述协作编辑器后端服务的核心需求，覆盖合并"))

# 拒绝被依赖的编辑 -> 依赖链失效，不静默丢弃
eng.decide("e5", "reject")
check("依赖被拒绝后 e6 标记失效", st(eng, "e6") == "invalidated")
check("e6 失效原因指向 e5", "e5" in eng.edits["e6"]["reason"])

# 接受删除 -> 同段落其余编辑失效，最终文档移除该段
eng.decide("e8", "accept")
check("删除被接受后同段追加编辑失效", st(eng, "e9") == "invalidated")
final = eng.build_document(final_only=True)
final_ids = {p["id"] for s in final["sections"] for p in s["paragraphs"]}
check("最终文档不含被删除的 p7", "p7" not in final_ids)

# 手动调整 -> 全组被手动内容覆盖
eng.decide("e7", "adjust", content="历史版本保存周期暂定为一百八十天。")
final2 = eng.build_document(final_only=True)
texts = [p["text"] for s in final2["sections"] for p in s["paragraphs"]]
check("手动调整内容确实进入最终文档", any("一百八十天" in t for t in texts))

# 撤销决定后状态恢复
eng.decide("e5", "reset")
check("撤销拒绝后 e5 恢复待确认", st(eng, "e5") == "pending")
check("撤销后 e6 不再因依赖失效(当前无其他失效原因)", st(eng, "e6") == "pending")

print("\n全部 %d 项检查通过" % PASS)
