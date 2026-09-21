# -*- coding: utf-8 -*-
"""experience link engine"""
import re
import time

RELATION_NAMES = {
    "related": "关联",
    "depends_on": "依赖",
    "supersedes": "取代",
    "contradicts": "矛盾",
}

# 双向同时出现时构成冲突的关系对（无序）
CONFLICT_PAIRS = {
    ("supersedes", "supersedes"),
    ("supersedes", "depends_on"),
    ("contradicts", "depends_on"),
    ("contradicts", "supersedes"),
}

# 正文相似度低于该值视为“实质变化”
SUBSTANTIVE_THRESHOLD = 0.45

_LATIN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_+#.-]{1,}")
_CJK_RE = re.compile(r"[一-鿿]+")

# 常见词不作为“正文线索”
CLUE_STOPWORDS = {
    "我们", "可以", "需要", "进行", "一个", "如果", "因为", "所以",
    "通过", "对于", "以及", "或者", "但是", "这个", "那个", "已经",
    "应该", "时候", "问题", "情况", "方式", "注意", "建议",
    "导致", "数据", "时间", "场景", "方案", "相关", "小时", "执行",
}


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _tokens(text):
    toks = set(w.lower() for w in _LATIN_RE.findall(text or ""))
    for seg in _CJK_RE.findall(text or ""):
        for i in range(len(seg) - 1):
            toks.add(seg[i:i + 2])
    return toks


def similarity(a, b):
    """两段正文的 Jaccard 相似度（拉丁词 + 中文二元组）。"""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def shared_clues(a, b, limit=6):
    """提取两段正文共同出现的可读线索词（共同英文词 + 极大公共中文片段）。"""
    lower_b = (b or "").lower()
    clues = set()
    for w in _LATIN_RE.findall(a or ""):
        if len(w) > 2 and w.lower() in lower_b:
            clues.add(w)
    found = set()
    for sa in _CJK_RE.findall(a or ""):
        for sb in _CJK_RE.findall(b or ""):
            for i in range(len(sa)):
                for j in range(i + 2, min(len(sa), i + 8) + 1):
                    sub = sa[i:j]
                    if sub in sb and sub not in CLUE_STOPWORDS:
                        found.add(sub)
    maximal = [s for s in found if not any(s != t and s in t for t in found)]
    maximal.sort(key=len, reverse=True)
    clues.update(maximal)
    return sorted(clues, key=len, reverse=True)[:limit]


def build_reason(shared_tags, clues):
    parts = []
    if shared_tags:
        parts.append("共同标签：" + "、".join(shared_tags))
    if clues:
        parts.append("正文共同线索：" + "、".join(clues))
    return "；".join(parts) if parts else "无明确依据"


# ---------------------------------------------------------------- 数据模型

def find_entry(state, entry_id):
    for e in state["entries"]:
        if e["id"] == entry_id:
            return e
    return None


def find_link(entry, target_id):
    for lk in entry["links"]:
        if lk["target"] == target_id:
            return lk
    return None


def normalize_link(raw):
    return {
        "target": raw["target"],
        "relation": raw.get("relation", "related"),
        "origin": raw.get("origin", "declared"),   # declared=人工声明 inferred=系统推断
        "decision": raw.get("decision", "none"),   # none/confirmed/rejected
        "state": raw.get("state", "active"),       # active/needs_reconfirm/invalidated/conflict
        "reason": raw.get("reason", "人工声明的关联"),
    }


def new_entry(entry_id, title, body, tags, links=None, note="初始版本"):
    return {
        "id": entry_id,
        "title": title,
        "body": body,
        "tags": list(tags),
        "status": "active",                        # active/deprecated/merged
        "merged_into": None,
        "revisions": [{"rev": 1, "time": _now(), "note": note,
                       "body": body, "tags": list(tags)}],
        "links": [normalize_link(l) for l in (links or [])],
    }


def log_event(state, text):
    state.setdefault("events", []).append(
        {"time": _now(), "text": text})


# ---------------------------------------------------------------- 关联推断

def infer_between(a, b):
    """判断两条目是否应建立潜在关联，返回 (是否匹配, 可读理由)。"""
    shared_tags = sorted(set(a["tags"]) & set(b["tags"]))
    clues = shared_clues(a["body"], b["body"])
    matched = ((len(shared_tags) >= 1 and len(clues) >= 1)
               or len(shared_tags) >= 2
               or len(clues) >= 3)
    return matched, build_reason(shared_tags, clues)


def maybe_infer(state, a, b):
    """若 a、b 之间尚无任何方向的链接，且满足推断条件，则在 a 上添加推断链接。"""
    if find_link(a, b["id"]) or find_link(b, a["id"]):
        return False
    matched, reason = infer_between(a, b)
    if not matched:
        return False
    a["links"].append(normalize_link({
        "target": b["id"], "relation": "related", "origin": "inferred",
        "reason": "系统推断：" + reason,
    }))
    log_event(state, "推断出新关联：{} → {}（{}）".format(a["id"], b["id"], reason))
    return True


# ---------------------------------------------------------------- 冲突检测

def relations_conflict(r1, r2):
    return (r1, r2) in CONFLICT_PAIRS or (r2, r1) in CONFLICT_PAIRS


def detect_conflicts(state):
    """扫描双向链接，关系互相矛盾时双方均标记为 conflict（均保留，不丢弃）。"""
    by_id = {e["id"]: e for e in state["entries"]}
    for e in state["entries"]:
        for lk in e["links"]:
            tgt = by_id.get(lk["target"])
            if not tgt:
                continue
            back = find_link(tgt, e["id"])
            if back and relations_conflict(lk["relation"], back["relation"]):
                if lk["state"] != "conflict":
                    lk["state"] = "conflict"
                    log_event(state,
                              "冲突：{} → {}（{}）与 {} → {}（{}）互相矛盾，双方均已保留".format(
                                  e["id"], lk["target"], RELATION_NAMES[lk["relation"]],
                                  tgt["id"], e["id"], RELATION_NAMES[back["relation"]]))
            elif lk["state"] == "conflict":
                lk["state"] = "active"
                log_event(state, "冲突解除：{} → {}".format(e["id"], lk["target"]))


# ---------------------------------------------------------------- 修订同步

def _sync_one_link(state, src, lk, tgt, substantive):
    """根据目标与内容变化同步单条链接的状态。"""
    label = "{} → {}".format(src["id"], lk["target"])
    if tgt["status"] == "deprecated":
        if lk["state"] != "invalidated":
            lk["state"] = "needs_reconfirm"
            lk["reason"] += "（目标条目已废弃，需重新确认）"
            log_event(state, "关联待重新确认：{}，目标已废弃".format(label))
        return
    if tgt["status"] == "merged":
        if lk["state"] != "invalidated":
            lk["state"] = "needs_reconfirm"
            lk["reason"] += "（目标已合并至 {}，需重新确认）".format(tgt["merged_into"])
            log_event(state, "关联待重新确认：{}，目标已合并".format(label))
        return
    if lk["decision"] == "confirmed":
        # 已确认的关联在修订中保持稳定，除非正文发生实质变化
        if substantive and lk["state"] == "active":
            lk["state"] = "needs_reconfirm"
            lk["reason"] += "（相关正文发生实质变化，需重新确认）"
            log_event(state, "已确认关联因实质变化待重新确认：{}".format(label))
        return
    if lk["origin"] == "inferred" and lk["decision"] == "none":
        matched, reason = infer_between(src, tgt)
        if not matched:
            if lk["state"] != "invalidated":
                lk["state"] = "invalidated"
                lk["reason"] = "已失效：内容变化后推断依据消失（原理由：{}）".format(
                    lk["reason"].replace("系统推断：", ""))
                log_event(state, "推断关联失效：{}".format(label))
        else:
            lk["reason"] = "系统推断：" + reason
            if lk["state"] == "invalidated":
                lk["state"] = "active"
                log_event(state, "推断关联恢复：{}".format(label))


def revise_entry(state, entry_id, body=None, tags=None, note=""):
    """改写条目正文/标签，追加修订记录，并同步所有受影响的关联。"""
    e = find_entry(state, entry_id)
    if not e:
        raise KeyError("条目不存在：" + entry_id)
    old_body = e["body"]
    if body is not None:
        e["body"] = body
    if tags is not None:
        e["tags"] = list(tags)
    e["revisions"].append({
        "rev": len(e["revisions"]) + 1, "time": _now(),
        "note": note or "修订", "body": e["body"], "tags": list(e["tags"]),
    })
    substantive = similarity(old_body, e["body"]) < SUBSTANTIVE_THRESHOLD
    log_event(state, "条目 {} 修订为 rev{}（{}）{}".format(
        entry_id, len(e["revisions"]), note or "修订",
        "，正文实质变化" if substantive else ""))
    # 1) 本条目发出的链接
    by_id = {x["id"]: x for x in state["entries"]}
    for lk in e["links"]:
        tgt = by_id.get(lk["target"])
        if tgt:
            _sync_one_link(state, e, lk, tgt, substantive)
    # 2) 其他条目指向本条目的链接
    for other in state["entries"]:
        if other["id"] == entry_id:
            continue
        for lk in other["links"]:
            if lk["target"] == entry_id:
                _sync_one_link(state, other, lk, e, substantive)
    # 3) 基于新内容重新推断潜在关联
    if e["status"] == "active":
        for other in state["entries"]:
            if other["id"] != entry_id and other["status"] == "active":
                maybe_infer(state, e, other)
    detect_conflicts(state)
    return e


# ---------------------------------------------------------------- 合并 / 废弃 / 裁决

def merge_entries(state, source_id, target_id):
    """将 source 合并进 target：source 标记为 merged，相关关联全部待重新确认。"""
    src = find_entry(state, source_id)
    tgt = find_entry(state, target_id)
    if not src or not tgt:
        raise KeyError("合并目标不存在")
    src["status"] = "merged"
    src["merged_into"] = target_id
    src["revisions"].append({
        "rev": len(src["revisions"]) + 1, "time": _now(),
        "note": "合并至 " + target_id, "body": src["body"], "tags": list(src["tags"]),
    })
    log_event(state, "条目 {} 已合并至 {}".format(source_id, target_id))
    for other in state["entries"]:
        for lk in other["links"]:
            if lk["target"] == source_id and lk["state"] != "invalidated":
                lk["state"] = "needs_reconfirm"
                lk["reason"] += "（目标已合并至 {}，需重新确认）".format(target_id)
                log_event(state, "关联待重新确认：{} → {}，目标已合并".format(
                    other["id"], source_id))
    for lk in src["links"]:
        if lk["state"] == "active":
            lk["state"] = "needs_reconfirm"
            lk["reason"] += "（本条目已合并至 {}，需重新确认）".format(target_id)
    detect_conflicts(state)
    return src


def deprecate_entry(state, entry_id, note=""):
    """废弃条目：其全部关联与指向它的关联均标记为待重新确认。"""
    e = find_entry(state, entry_id)
    if not e:
        raise KeyError("条目不存在：" + entry_id)
    e["status"] = "deprecated"
    e["revisions"].append({
        "rev": len(e["revisions"]) + 1, "time": _now(),
        "note": note or "废弃", "body": e["body"], "tags": list(e["tags"]),
    })
    log_event(state, "条目 {} 已废弃".format(entry_id))
    for other in state["entries"]:
        for lk in other["links"]:
            if lk["target"] == entry_id and lk["state"] != "invalidated":
                lk["state"] = "needs_reconfirm"
                lk["reason"] += "（目标条目已废弃，需重新确认）"
                log_event(state, "关联待重新确认：{} → {}，目标已废弃".format(
                    other["id"], entry_id))
    for lk in e["links"]:
        if lk["state"] == "active":
            lk["state"] = "needs_reconfirm"
    detect_conflicts(state)
    return e


def decide_link(state, source_id, target_id, decision):
    """用户对关联的裁决：confirmed / rejected / none（撤销裁决）。"""
    src = find_entry(state, source_id)
    if not src:
        raise KeyError("条目不存在：" + source_id)
    lk = find_link(src, target_id)
    if not lk:
        raise KeyError("关联不存在：{} → {}".format(source_id, target_id))
    lk["decision"] = decision
    if decision == "confirmed":
        lk["state"] = "active"
        log_event(state, "关联已人工确认：{} → {}".format(source_id, target_id))
    elif decision == "rejected":
        lk["state"] = "invalidated"
        lk["reason"] += "（已被用户否决）"
        log_event(state, "关联已被否决：{} → {}".format(source_id, target_id))
    else:
        lk["state"] = "active"
    detect_conflicts(state)
    return lk


# ---------------------------------------------------------------- 初始化

def bootstrap(state):
    """载入条目后：全量推断潜在关联并检测冲突。"""
    entries = [e for e in state["entries"] if e["status"] == "active"]
    for i, a in enumerate(entries):
        for b in entries[i + 1:]:
            maybe_infer(state, a, b)
    detect_conflicts(state)
    return state
