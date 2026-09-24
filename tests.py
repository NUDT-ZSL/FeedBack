# -*- coding: utf-8 -*-
"""引擎行为测试：冲突保留、判定依据、歧义标记、增量与整体重推一致。"""
import json
import os

from engine import Engine


def load_engine():
    eng = Engine()
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_data.json"),
              encoding="utf-8") as f:
        data = json.load(f)
    eng.import_data(data["objects"], data["queries"], mode="replace")
    return eng


def bucket_of(result, oid):
    for group, name in ((result["hits"], "hit"), (result["excluded"], "excluded"),
                        (result["undecidable"], "undecidable")):
        for e in group:
            if e["object_id"] == oid:
                return name, e
    return None, None


def check(cond, msg):
    assert cond, msg
    print("  ok -", msg)


def main():
    eng = load_engine()
    r1, r2, r3 = eng.results["Q1"], eng.results["Q2"], eng.results["Q3"]

    print("[1] 冲突与不可信项")
    b, e = bucket_of(r1, "OBJ-002")
    check(b == "undecidable" and any("坐标缺失" in r for r in e["reasons"]), "OBJ-002 坐标缺失 -> 不可判定")
    b, e = bucket_of(r1, "OBJ-003")
    check(b == "undecidable" and "coords_untrusted" in e["flags"], "OBJ-003 坐标矛盾 -> 不参与排序")
    b, e = bucket_of(r1, "OBJ-004")
    check(b == "undecidable" and any("越界" in r for r in e["reasons"]), "OBJ-004 坐标越界 -> 不可判定")
    b, e = bucket_of(r1, "OBJ-005")
    check(b == "undecidable" and "validity_conflict" in e["flags"], "OBJ-005 有效期矛盾 -> Q1 不可判定")
    b, _ = bucket_of(r2, "OBJ-005")
    check(b == "hit", "OBJ-005 在无时间过滤的 Q2 中命中")
    b, e = bucket_of(r3, "OBJ-007")
    check(b == "undecidable" and "category_conflict" in e["flags"], "OBJ-007 类别矛盾 vs 类别过滤 -> 不可判定")
    b, _ = bucket_of(r1, "OBJ-007")
    check(b == "hit", "OBJ-007 在无类别过滤的 Q1 中命中")
    obj3 = next(o for o in eng.state()["objects"] if o["object_id"] == "OBJ-003")
    check(len(obj3["claims"]) == 2 and all(not c["retracted"] for c in obj3["claims"]),
          "OBJ-003 两条矛盾来源全部保留")

    print("[2] 命中、排序与依据")
    check([h["object_id"] for h in r1["hits"]] == ["OBJ-001", "OBJ-009", "OBJ-007", "OBJ-006"],
          "Q1 命中按距离排序: " + ",".join(h["object_id"] for h in r1["hits"]))
    check(all(h["reasons"] for h in r1["hits"]), "每个命中都带判定依据")
    b, e = bucket_of(r1, "OBJ-008")
    check(b == "excluded" and any("范围外" in r for r in e["reasons"]), "OBJ-008 范围外被排除且有依据")
    b, e = bucket_of(r1, "OBJ-010")
    check(b == "excluded" and any("有效期" in r for r in e["reasons"]), "OBJ-010 过期被排除")
    b, _ = bucket_of(r2, "OBJ-010")
    check(b == "hit", "OBJ-010 在无时间过滤的 Q2 中命中")
    b, e = bucket_of(r3, "OBJ-001")
    check(b == "excluded" and any("类别" in r for r in e["reasons"]), "OBJ-001 类别不符被 Q3 排除")

    print("[3] 歧义标记")
    b, e = bucket_of(r1, "OBJ-006")
    check(b == "hit" and "on_boundary" in e["flags"], "OBJ-006 恰好落在 Q1 边界上")
    check(any(a["kind"] == "on_boundary" for a in r1["ambiguities"]), "Q1 歧义列表包含边界命中")
    overlaps = eng.overlap_report()
    check(any(set(o["queries"]) == {"Q1", "Q2"} and "OBJ-009" in o["shared_hits"] for o in overlaps),
          "Q1/Q2 范围重叠且 OBJ-009 为共同命中")

    print("[4] 裁决、撤回、修正与增量一致性")
    check(eng.consistency_check()["consistent"], "初始状态一致")
    affected = eng.adjudicate("OBJ-003", "lon", value=116.41, rationale="巡检上报为最新现场数据")
    check(affected == [], "仅裁决经度时纬度仍矛盾，无查找受影响: %s" % affected)
    affected = eng.adjudicate("OBJ-003", "lat", value=39.90, rationale="巡检上报为最新现场数据")
    check(eng.consistency_check()["consistent"], "裁决后增量结果与整体重推一致")
    b, _ = bucket_of(eng.results["Q1"], "OBJ-003")
    check(b == "hit", "OBJ-003 裁决后进入 Q1 命中")
    check("Q1" in affected, "坐标裁决影响了 Q1: %s" % affected)
    affected = eng.adjudicate("OBJ-007", "category", value="仓库", rationale="资产系统为准")
    check(affected == ["Q3"], "OBJ-007 类别裁决只影响 Q3: %s" % affected)
    b, _ = bucket_of(eng.results["Q3"], "OBJ-007")
    check(b == "hit", "OBJ-007 裁决为仓库后命中 Q3")
    check(eng.consistency_check()["consistent"], "类别裁决后一致")
    claim, _ = eng.add_claim("OBJ-002", source="补录GPS", lat=39.901, lon=116.401,
                             category="仓库", valid_from="2026-01-01T00:00:00",
                             valid_to="2026-12-31T23:59:59")
    b, _ = bucket_of(eng.results["Q1"], "OBJ-002")
    check(b == "hit", "OBJ-002 补录坐标后命中 Q1")
    check(eng.consistency_check()["consistent"], "补录后一致")
    eng.retract_claim(claim["claim_id"])
    b, _ = bucket_of(eng.results["Q1"], "OBJ-002")
    check(b == "undecidable", "补录来源撤回后 OBJ-002 回到不可判定")
    check(eng.consistency_check()["consistent"], "撤回后一致")
    obj9 = next(o for o in eng.state()["objects"] if o["object_id"] == "OBJ-009")
    eng.retract_claim(obj9["claims"][0]["claim_id"])
    b, e = bucket_of(eng.results["Q1"], "OBJ-009")
    check(b == "excluded" and "retracted" in e["flags"], "OBJ-009 全部来源撤回后被排除")
    check(eng.consistency_check()["consistent"], "全部撤回后一致")

    print("[5] 查找增删改")
    qid = eng.upsert_query({"name": "临时圈", "shape": {"type": "circle", "cx": 116.40,
                            "cy": 39.90, "radius": 0.01},
                            "filters": {"categories": [], "active_at": ""}})
    check(qid in eng.results, "新查找立即出结果")
    eng.upsert_query({"query_id": qid, "name": "临时圈", "shape": {"type": "circle",
                      "cx": 116.40, "cy": 39.90, "radius": 0.2}, "filters": {}})
    check(len(eng.results[qid]["hits"]) >= 4, "调整范围后结果更新")
    eng.delete_query(qid)
    check(qid not in eng.results, "删除查找后结果移除")
    check(eng.consistency_check()["consistent"], "查找增删改后一致")

    print("\n全部测试通过。")


if __name__ == "__main__":
    main()
