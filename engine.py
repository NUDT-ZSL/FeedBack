# -*- coding: utf-8 -*-
"""评分引擎：把多维表现记录按可配置规则折算为综合等级。

设计要点：
- 同一维度多位评价者取值不一致时全部保留并标记冲突；综合等级在
  低/高两种极端情形下分别计算，结论一致即为"稳定"。
- 缺测维度不参与加权（权重重新归一），显式标注为未采证。
- 前置维度未达标（或未采证）时，后继维度不参与综合。
引擎为纯函数：全量重算与增量更新走同一代码路径，结果必然一致。
"""

DEFAULT_RULES = {
    "level_scores": {"A": 95, "B": 85, "C": 75, "D": 60, "E": 40},
    "grade_bands": [
        {"grade": "优秀", "min": 85},
        {"grade": "良好", "min": 70},
        {"grade": "合格", "min": 60},
        {"grade": "不合格", "min": 0},
    ],
    "dimensions": {},
}


def normalize_value(raw, level_scores):
    """把取值（数值或等级）归一到 0-100。返回 (score, kind)。"""
    if isinstance(raw, bool):
        return None, "invalid"
    if isinstance(raw, (int, float)):
        return max(0.0, min(100.0, float(raw))), "score"
    s = str(raw).strip()
    if s.upper() in level_scores:
        return float(level_scores[s.upper()]), "level"
    try:
        return max(0.0, min(100.0, float(s))), "score"
    except ValueError:
        return None, "invalid"


def evaluate_dimension(records, level_scores):
    """评估一个维度的全部采证记录，保留冲突双方。"""
    entries = []
    for r in records:
        score, kind = normalize_value(r.get("value"), level_scores)
        entries.append({
            "evidence_id": r.get("id"),
            "evaluator": r.get("evaluator", ""),
            "recorded_at": r.get("recorded_at", ""),
            "raw": r.get("value"),
            "score": score,
            "kind": kind,
        })
    valid = [e["score"] for e in entries if e["score"] is not None]
    if not valid:
        return {"status": "missing", "entries": entries, "conflict": False,
                "point": None, "low": None, "high": None}
    conflict = len(set(round(v, 6) for v in valid)) > 1
    return {
        "status": "assessed",
        "entries": entries,
        "conflict": conflict,
        "point": sum(valid) / len(valid),
        "low": min(valid),
        "high": max(valid),
    }


def grade_for(score, bands):
    for b in sorted(bands, key=lambda x: -x["min"]):
        if score >= b["min"]:
            return b["grade"]
    return bands[-1]["grade"] if bands else "未分级"


def _participation(dim_evals, dim_rules, passed):
    """按前置关系决定各维度是否参与综合。前置必须自身参与且达标。
    返回 (join, note)：{dim: bool}, {dim: str}"""
    join, note = {}, {}
    pending = set(dim_rules)
    progressed = True
    while pending and progressed:
        progressed = False
        for d in sorted(pending):
            prereqs = dim_rules[d].get("prereqs", [])
            if any(p in pending for p in prereqs):
                continue  # 等前置先判定
            ok, why = True, ""
            for p in prereqs:
                if p not in dim_rules:
                    ok, why = False, "前置维度 %s 未在规则中定义" % p
                    break
                if not join.get(p, False) or not passed.get(p, False):
                    pname = dim_rules[p].get("name", p)
                    ok, why = False, "前置维度「%s」未达标，本维度不参与综合" % pname
                    break
            join[d] = ok
            note[d] = why
            pending.discard(d)
            progressed = True
    for d in pending:  # 前置关系成环
        join[d], note[d] = False, "前置关系存在循环，本维度被排除"
    return join, note


def _scenario_pass(dim_evals, dim_rules, scenario):
    """各维度在给定情形下是否达到达标线（用于前置判定）。"""
    passed = {}
    for d, rule in dim_rules.items():
        ev = dim_evals.get(d)
        if ev is None or ev["status"] != "assessed":
            passed[d] = False
        else:
            passed[d] = ev[scenario] >= rule.get("pass_line", 0)
    return passed


def _composite(dim_evals, dim_rules, scenario, passed):
    join, note = _participation(dim_evals, dim_rules, passed)
    wsum, acc = 0.0, 0.0
    for d, rule in dim_rules.items():
        ev = dim_evals.get(d)
        if not join.get(d) or ev is None or ev["status"] != "assessed":
            continue
        w = float(rule.get("weight", 1))
        wsum += w
        acc += w * ev[scenario]
    return (acc / wsum if wsum > 0 else None), join, note


def evaluate_student(evidence_by_dim, rules):
    """评估一名学员。evidence_by_dim: {dim: [记录...]}。
    返回维度明细、冲突标记、缺测影响与冲突下的稳定性结论。"""
    dim_rules = rules.get("dimensions", {})
    level_scores = rules.get("level_scores", DEFAULT_RULES["level_scores"])
    bands = rules.get("grade_bands", DEFAULT_RULES["grade_bands"])

    dim_evals = {}
    for d in dim_rules:
        recs = evidence_by_dim.get(d, [])
        dim_evals[d] = evaluate_dimension(recs, level_scores) if recs else {
            "status": "missing", "entries": [], "conflict": False,
            "point": None, "low": None, "high": None}

    scenarios = {}
    for sc in ("point", "low", "high"):
        passed = _scenario_pass(dim_evals, dim_rules, sc)
        score, join, note = _composite(dim_evals, dim_rules, sc, passed)
        scenarios[sc] = {"score": score, "join": join, "note": note,
                         "grade": grade_for(score, bands)
                         if score is not None else "无法评定"}

    point = scenarios["point"]
    low_g, high_g = scenarios["low"]["grade"], scenarios["high"]["grade"]
    stable = low_g == high_g

    passed_point = _scenario_pass(dim_evals, dim_rules, "point")
    dims, total_w, missing_w = {}, 0.0, 0.0
    for d, rule in dim_rules.items():
        ev = dim_evals[d]
        w = float(rule.get("weight", 1))
        total_w += w
        participates = point["join"].get(d, False) and ev["status"] == "assessed"
        if ev["status"] != "assessed":
            missing_w += w
        dims[d] = {
            "name": rule.get("name", d), "weight": w,
            "pass_line": rule.get("pass_line", 0),
            "prereqs": rule.get("prereqs", []),
            "status": ev["status"], "conflict": ev["conflict"],
            "point": ev["point"], "low": ev["low"], "high": ev["high"],
            "passed": passed_point[d], "participates": participates,
            "exclude_note": "" if participates else point["note"].get(d, ""),
            "entries": ev["entries"],
        }

    notes = []
    missing = [dims[d]["name"] for d in dims if dims[d]["status"] != "assessed"]
    if missing:
        pct = (missing_w / total_w * 100) if total_w else 0
        notes.append("缺测维度（%s）未按零分处理，已从加权中剔除，被剔除"
                     "权重占 %.0f%%；综合等级仅基于已采证维度。"
                     % ("、".join(missing), pct))
    excluded = [dims[d]["name"] for d in dims
                if dims[d]["status"] == "assessed" and not dims[d]["participates"]]
    if excluded:
        notes.append("维度（%s）因前置未达标不参与本次综合。" % "、".join(excluded))
    conflicts = [dims[d]["name"] for d in dims if dims[d]["conflict"]]
    if conflicts:
        notes.append("维度（%s）存在评价者取值冲突，双方记录均已保留。"
                     % "、".join(conflicts))
    if not stable:
        notes.append("综合等级在冲突取值下不稳定：介于「%s」与「%s」之间，"
                     "建议教研组复核冲突采证。" % (low_g, high_g))

    return {
        "dims": dims,
        "composite": {
            "score": point["score"], "grade": point["grade"],
            "stable": stable, "low_grade": low_g, "high_grade": high_g,
            "low_score": scenarios["low"]["score"],
            "high_score": scenarios["high"]["score"],
            "assessed": sum(1 for d in dims.values() if d["status"] == "assessed"),
            "total": len(dims),
            "coverage": (1 - missing_w / total_w) if total_w else 0,
            "notes": notes,
        },
    }
