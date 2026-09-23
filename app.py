# -*- coding: utf-8 -*-
"""错因模式分析应用:导入作答记录,定位错误环节,归纳错因模式并给出练习建议。"""
import json
import re
import time

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="")

STATE = {
    "questions": {},    # qid -> {id, text, steps:[{id, text, skill}]}
    "records": {},      # rid -> 原始作答记录
    "events": {},       # eid -> 错误事件(定位到具体步骤)
    "patterns": {},     # pid -> 错因模式
    "incompletes": [],  # 无法定位错误环节的记录
    "correct": [],      # 全部答对的记录 id
    "seq": 0,           # id 计数器
}


def _next_id(prefix):
    STATE["seq"] += 1
    return "%s-%d" % (prefix, STATE["seq"])


def reset_state():
    STATE["questions"] = {}
    STATE["records"] = {}
    STATE["events"] = {}
    STATE["patterns"] = {}
    STATE["incompletes"] = []
    STATE["correct"] = []
    STATE["seq"] = 0


def analyze_record(rec, question):
    """沿题目步骤定位学生实际走到并出错的环节。"""
    rid = rec.get("id")
    sid = rec.get("student_id")
    steps = question.get("steps") or []
    attempts = rec.get("attempts") or []

    if not steps:
        return ("incomplete", {
            "record_id": rid, "student_id": sid,
            "question_id": question.get("id"),
            "reason": "题目缺少解题步骤,无法定位错误环节",
            "missing_position": "整道题(未定义任何步骤)",
        })
    if not attempts:
        return ("incomplete", {
            "record_id": rid, "student_id": sid,
            "question_id": question.get("id"),
            "reason": "学生未作答任何步骤",
            "missing_position": "第 1 步「%s」起全部缺失" % steps[0].get("text", ""),
        })

    amap = {a.get("step_id"): a for a in attempts if a.get("step_id")}
    known = {s.get("id") for s in steps}
    unknown = [a.get("step_id") for a in attempts
               if a.get("step_id") and a.get("step_id") not in known]
    if unknown:
        return ("incomplete", {
            "record_id": rid, "student_id": sid,
            "question_id": question.get("id"),
            "reason": "作答记录引用了题目中不存在的步骤: %s" % ", ".join(unknown),
            "missing_position": "步骤 id %s 无法与题目步骤对应" % ", ".join(unknown),
        })

    for idx, step in enumerate(steps):
        att = amap.get(step.get("id"))
        if att is None:
            return ("incomplete", {
                "record_id": rid, "student_id": sid,
                "question_id": question.get("id"),
                "reason": "作答在第 %d 步中断,后续步骤缺失" % (idx + 1),
                "missing_position": "第 %d 步「%s」及之后"
                                    % (idx + 1, step.get("text", "")),
            })
        result = att.get("result")
        if result == "wrong":
            return ("event", {
                "id": _next_id("E"),
                "record_id": rid,
                "student_id": sid,
                "question_id": question.get("id"),
                "step_id": step.get("id"),
                "step_index": idx,
                "step_text": step.get("text", ""),
                "skill": step.get("skill") or "未标注技能点",
                "student_answer": att.get("answer", ""),
            })
        if result != "correct":
            return ("incomplete", {
                "record_id": rid, "student_id": sid,
                "question_id": question.get("id"),
                "reason": "第 %d 步作答结果标记为「%s」,无法判定对错"
                          % (idx + 1, result),
                "missing_position": "第 %d 步「%s」"
                                    % (idx + 1, step.get("text", "")),
            })
    return ("correct", None)


SUGGESTION_RULES = [
    (["符号", "负号", "去括号"],
     "集中训练含负号与去括号的变式题:先只做「判断结果符号」的口算练习,"
     "再做完整运算,每题要求学生先写出符号再写数值。"),
    (["移项", "方程"],
     "安排移项专项练习:让学生对每一步移项口头说明「从哪边移到哪边、符号如何变化」,"
     "并用逆向代入检验结果。"),
    (["合并同类项", "同类项"],
     "先做同类项识别练习(只分类不计算),再过渡到合并运算,"
     "强调系数相加、字母部分不变。"),
    (["通分", "约分", "分数"],
     "针对分数运算安排通分/约分专项:先练习找最小公倍数,再做限时口算,最后混合运算。"),
    (["配方", "公式", "代入"],
     "回到公式推导本身,让学生默写并复述公式适用条件,"
     "再做「给条件选公式」的匹配练习。"),
]
DEFAULT_SUGGESTION = (
    "针对该错误环节设计 3-5 道同技能点的变式题,要求学生边做边口述每一步的依据,"
    "完成后用逆运算或代入法自检。")


def suggestion_for(skills):
    text = " ".join(skills)
    for keys, advice in SUGGESTION_RULES:
        if any(k in text for k in keys):
            return advice
    return DEFAULT_SUGGESTION


def refresh_pattern(pid):
    """只重新归纳指定模式:覆盖范围、错因描述与练习建议。"""
    p = STATE["patterns"].get(pid)
    if p is None:
        return
    events = [STATE["events"][eid] for eid in p["event_ids"]
              if eid in STATE["events"]]
    skills = sorted({e["skill"] for e in events})
    qids = sorted({e["question_id"] for e in events})
    p["skills"] = skills
    p["question_ids"] = qids
    p["label"] = "%s · %s类错误" % (
        p["student_id"], "、".join(skills) if skills else "未分类")
    step_desc = "；".join(
        "%s 第%d步「%s」(%s)" % (e["question_id"], e["step_index"] + 1,
                                 e["step_text"], e["skill"])
        for e in events)
    p["summary"] = ("学生 %s 在 %d 道题的相同/相近环节出错,涉及技能点:%s。"
                    "出错环节:%s。" % (p["student_id"], len(qids),
                                       "、".join(skills), step_desc))
    p["suggestion"] = {
        "advice": suggestion_for(skills),
        "basis_steps": ["%s 第%d步「%s」" % (e["question_id"],
                                            e["step_index"] + 1,
                                            e["step_text"]) for e in events],
        "covered_questions": qids,
    }
    p["revision"] = p.get("revision", 0) + 1
    p["updated_at"] = time.strftime("%H:%M:%S")


def build_patterns():
    """初次归纳:按 (学生, 技能点) 聚合错误事件。"""
    groups = {}
    for e in STATE["events"].values():
        groups.setdefault((e["student_id"], e["skill"]), []).append(e["id"])
    for (sid, _skill), eids in sorted(groups.items()):
        pid = _next_id("P")
        STATE["patterns"][pid] = {
            "id": pid, "student_id": sid, "event_ids": list(eids),
            "skills": [], "question_ids": [], "label": "", "summary": "",
            "suggestion": {}, "revision": 0,
        }
        refresh_pattern(pid)


def _bigrams(text):
    chars = re.sub(r"[^\w一-鿿]+", "", text or "")
    if len(chars) < 2:
        return {chars} if chars else set()
    return {chars[i:i + 2] for i in range(len(chars) - 1)}


def candidates_for(event):
    """为一条错误事件计算候选归属模式及各自依据。"""
    out = []
    ev_bg = _bigrams(event["step_text"] + " " + event["skill"])
    for p in STATE["patterns"].values():
        if p["student_id"] != event["student_id"]:
            continue
        score, why = 0, []
        if event["skill"] in p["skills"]:
            score += 3
            why.append("错误步骤技能点「%s」与该模式一致" % event["skill"])
        members = [STATE["events"][e] for e in p["event_ids"]
                   if e in STATE["events"]]
        overlap = set()
        for m in members:
            overlap |= ev_bg & _bigrams(m["step_text"] + " " + m["skill"])
        if overlap:
            score += min(len(overlap), 5)
            sample = "、".join(sorted(overlap)[:4])
            why.append("出错环节文本与该模式覆盖步骤存在共性片段:%s" % sample)
        if event["question_id"] in p["question_ids"]:
            why.append("该模式已覆盖本题 %s 的其他错误" % event["question_id"])
            score += 1
        if score > 0:
            out.append({"pattern_id": p["id"], "label": p["label"],
                        "score": score, "rationale": "；".join(why)})
    out.sort(key=lambda c: -c["score"])
    return out


def import_payload(payload):
    """导入一批记录并执行定位与归纳。返回统计信息。"""
    reset_state()
    for q in payload.get("questions", []):
        STATE["questions"][q["id"]] = q
    stats = {"events": 0, "correct": 0, "incomplete": 0}
    for rec in payload.get("records", []):
        STATE["records"][rec["id"]] = rec
        q = STATE["questions"].get(rec.get("question_id"))
        if q is None:
            STATE["incompletes"].append({
                "record_id": rec.get("id"), "student_id": rec.get("student_id"),
                "question_id": rec.get("question_id"),
                "reason": "作答记录引用了不存在的题目",
                "missing_position": "题目 %s 未在题库中定义" % rec.get("question_id"),
            })
            stats["incomplete"] += 1
            continue
        kind, data = analyze_record(rec, q)
        if kind == "event":
            STATE["events"][data["id"]] = data
            stats["events"] += 1
        elif kind == "correct":
            STATE["correct"].append(rec["id"])
            stats["correct"] += 1
        else:
            STATE["incompletes"].append(data)
            stats["incomplete"] += 1
    build_patterns()
    stats["patterns"] = len(STATE["patterns"])
    return stats


def trajectory(rec):
    """组装一条记录的逐步作答轨迹,标出学生实际走到的环节。"""
    q = STATE["questions"].get(rec.get("question_id"), {})
    amap = {a.get("step_id"): a for a in rec.get("attempts", [])}
    event = next((e for e in STATE["events"].values()
                  if e["record_id"] == rec.get("id")), None)
    steps = []
    for idx, s in enumerate(q.get("steps", [])):
        att = amap.get(s.get("id"))
        steps.append({
            "step_id": s.get("id"), "index": idx, "text": s.get("text", ""),
            "skill": s.get("skill", ""),
            "reached": att is not None,
            "result": (att or {}).get("result"),
            "student_answer": (att or {}).get("answer", ""),
            "is_error": bool(event and event["step_id"] == s.get("id")),
        })
    return {"record_id": rec.get("id"), "student_id": rec.get("student_id"),
            "question_id": rec.get("question_id"),
            "question_text": q.get("text", ""), "steps": steps,
            "event_id": event["id"] if event else None}


def full_state():
    return {
        "patterns": list(STATE["patterns"].values()),
        "events": list(STATE["events"].values()),
        "incompletes": STATE["incompletes"],
        "correct": STATE["correct"],
        "trajectories": [trajectory(r) for r in STATE["records"].values()],
    }


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/import", methods=["POST"])
def api_import():
    payload = request.get_json(force=True)
    if not isinstance(payload, dict) or "records" not in payload:
        return jsonify({"error": "数据格式需包含 questions 与 records"}), 400
    stats = import_payload(payload)
    return jsonify({"stats": stats, "state": full_state()})


@app.route("/api/sample", methods=["POST"])
def api_sample():
    with open("sample_data.json", encoding="utf-8") as f:
        stats = import_payload(json.load(f))
    return jsonify({"stats": stats, "state": full_state()})


@app.route("/api/state")
def api_state():
    return jsonify(full_state())


@app.route("/api/events/<eid>/candidates")
def api_candidates(eid):
    ev = STATE["events"].get(eid)
    if ev is None:
        return jsonify({"error": "事件不存在"}), 404
    return jsonify({"event": ev, "candidates": candidates_for(ev)})


@app.route("/api/reassign", methods=["POST"])
def api_reassign():
    """手动调整一条错误事件的归属,只重新归纳受影响的模式。"""
    body = request.get_json(force=True)
    eid, target = body.get("event_id"), body.get("target")
    ev = STATE["events"].get(eid)
    if ev is None:
        return jsonify({"error": "事件不存在"}), 404
    old_pid = next((p["id"] for p in STATE["patterns"].values()
                    if eid in p["event_ids"]), None)
    if target == "new":
        new_pid = _next_id("P")
        STATE["patterns"][new_pid] = {
            "id": new_pid, "student_id": ev["student_id"],
            "event_ids": [], "skills": [], "question_ids": [],
            "label": "", "summary": "", "suggestion": {}, "revision": 0,
        }
        target = new_pid
    if target not in STATE["patterns"]:
        return jsonify({"error": "目标模式不存在"}), 404
    if target == old_pid:
        return jsonify({"changed": [], "state": full_state()})

    STATE["patterns"][old_pid]["event_ids"].remove(eid)
    STATE["patterns"][target]["event_ids"].append(eid)
    changed = [old_pid, target]
    if not STATE["patterns"][old_pid]["event_ids"]:
        del STATE["patterns"][old_pid]      # 模式被腾空,移除
    else:
        refresh_pattern(old_pid)            # 仅重新归纳受影响模式
    refresh_pattern(target)
    return jsonify({"changed": changed, "state": full_state()})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
