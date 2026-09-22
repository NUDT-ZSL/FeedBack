"""Core triage logic: merge, contradiction detection, priority, adjudication.

Pure domain module with no web dependencies so it can be unit-tested.
State is persisted as JSON by the Flask layer via to_dict()/from_dict().
"""
from __future__ import annotations

import itertools
import time
import uuid
from datetime import datetime, timezone

# Antonym groups: if two items of the same demand hit opposite sides of the
# same group, we flag a contradiction (both sides are always preserved).
ANTONYM_GROUPS = [
    (("保留", "恢复", "别删", "不要删", "需要这个"), ("去掉", "删除", "取消这个", "移除", "下线")),
    (("太快", "太频繁", "过于频繁"), ("太慢", "太少", "不够频繁")),
    (("增加", "多一些", "加强"), ("减少", "精简", "砍掉")),
    (("支持", "赞成", "希望上线"), ("反对", "不赞成", "希望不要")),
    (("喜欢", "好用", "很方便"), ("讨厌", "难用", "很不方便")),
    (("开启", "打开", "默认开"), ("关闭", "关掉", "默认关")),
]

SEVERITY_WORDS = {
    3: ["崩溃", "无法使用", "打不开", "数据丢失", "丢数据", "泄露", "安全"],
    2: ["报错", "失败", "卡顿", "闪退", "异常", "白屏"],
    1: ["建议", "希望", "能不能", "可以不可以", "优化"],
}

PRIORITY_LEVELS = ["P0", "P1", "P2", "P3"]
DISPOSITIONS = ["立即修复", "排期优化", "暂不处理", "需要更多信息"]
MERGE_THRESHOLD = 0.30
# Same feature point is a strong merge signal in this product; it boosts the
# text similarity before comparing against the threshold.
FEATURE_MATCH_BOOST = 0.20


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _bigrams(text: str) -> set:
    text = "".join(ch for ch in text.lower() if not ch.isspace())
    if len(text) < 2:
        return {text} if text else set()
    return {text[i:i + 2] for i in range(len(text) - 1)}


def similarity(a: str, b: str) -> float:
    sa, sb = _bigrams(a), _bigrams(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def shared_terms(a: str, b: str, top: int = 6) -> list:
    common = sorted(_bigrams(a) & _bigrams(b), key=len, reverse=True)
    return common[:top]


def _hits(text: str, words) -> list:
    return [w for w in words if w in text]


def detect_contradictions(items: list) -> list:
    """Flag opposing claims between item pairs. Both sides are preserved."""
    by_pair = {}
    for a, b in itertools.combinations(items, 2):
        for pos_words, neg_words in ANTONYM_GROUPS:
            a_pos, a_neg = _hits(a["text"], pos_words), _hits(a["text"], neg_words)
            b_pos, b_neg = _hits(b["text"], pos_words), _hits(b["text"], neg_words)
            pairs = []
            if a_pos and b_neg:
                pairs.append((a, a_pos, b, b_neg))
            if a_neg and b_pos:
                pairs.append((a, a_neg, b, b_pos))
            for ia, ca, ib, cb in pairs:
                key = (ia["id"], ib["id"])
                rec = by_pair.setdefault(key, {
                    "item_a": ia["id"], "text_a": ia["text"],
                    "item_b": ib["id"], "text_b": ib["text"],
                    "_ca": [], "_cb": [],
                })
                rec["_ca"].extend(ca)
                rec["_cb"].extend(cb)
    found = []
    for rec in by_pair.values():
        rec["claim_a"] = "、".join(dict.fromkeys(rec.pop("_ca")))
        rec["claim_b"] = "、".join(dict.fromkeys(rec.pop("_cb")))
        found.append(rec)
    return found


def _urgency(items: list) -> int:
    score = 0
    for it in items:
        for weight in (3, 2, 1):
            if _hits(it["text"], SEVERITY_WORDS[weight]):
                score = max(score, weight)
                break
    now = time.time()
    for it in items:
        try:
            ts = datetime.fromisoformat(it["reported_at"]).timestamp()
        except (ValueError, KeyError):
            continue
        if now - ts < 3 * 86400:
            score += 1
            break
    return score


def compute_priority(items: list) -> dict:
    """Score a demand from its feedback item dicts."""
    sources = {it.get("source", "未知") for it in items}
    impact = len(sources) * 2 + len(items)
    urgency = _urgency(items)
    score = impact * 10 + urgency * 5
    if score >= 60:
        level = "P0"
    elif score >= 40:
        level = "P1"
    elif score >= 22:
        level = "P2"
    else:
        level = "P3"
    return {"impact": impact, "urgency": urgency, "score": score,
            "suggested": level, "source_count": len(sources),
            "item_count": len(items)}


def final_priority(demand: dict, items: list) -> str:
    adj = demand.get("adjudication")
    if adj and demand.get("status") == "adjudicated":
        return adj["priority"]
    return compute_priority(items)["suggested"]


class TriageStore:
    def __init__(self):
        self.items = {}      # item_id -> feedback item
        self.demands = {}    # demand_id -> demand
        self.audit_log = []  # every decision, for the adjudication record view

    def to_dict(self):
        return {"items": self.items, "demands": self.demands,
                "audit_log": self.audit_log}

    @classmethod
    def from_dict(cls, data):
        store = cls()
        store.items = data.get("items", {})
        store.demands = data.get("demands", {})
        store.audit_log = data.get("audit_log", [])
        return store

    def _log(self, action, demand_id, detail, operator="system"):
        self.audit_log.append({
            "id": _uid("log"), "time": _now(), "action": action,
            "demand_id": demand_id, "detail": detail, "operator": operator,
        })

    def import_feedback(self, entries: list) -> dict:
        """Import raw entries; merge into an existing demand or spawn one."""
        created, merged = [], []
        for entry in entries:
            item = {
                "id": _uid("fb"),
                "source": entry.get("source", "未知来源"),
                "text": entry["text"],
                "feature": entry.get("feature", "未标注"),
                "reported_at": entry.get("reported_at", _now()),
                "imported_at": _now(),
            }
            self.items[item["id"]] = item
            target, sim, terms = self._best_demand(item)
            if target is not None:
                self._attach(target, item, sim, terms)
                merged.append({"item": item, "demand_id": target["id"]})
            else:
                demand = self._new_demand(item)
                created.append({"item": item, "demand_id": demand["id"]})
        return {"created": created, "merged": merged}

    def _best_demand(self, item):
        best, best_sim, best_terms = None, 0.0, []
        probe = item["feature"] + " " + item["text"]
        for demand in self.demands.values():
            for other in demand["items"]:
                base = self.items[other]["feature"] + " " + self.items[other]["text"] \
                    if isinstance(other, str) else other["feature"] + " " + other["text"]
                sim = similarity(probe, base)
                other_feature = (self.items[other]["feature"] if isinstance(other, str)
                                 else other["feature"])
                if (other_feature == item["feature"]
                        and item["feature"] != "未标注"):
                    sim = min(1.0, sim + FEATURE_MATCH_BOOST)
                if sim > best_sim:
                    best, best_sim = demand, sim
                    best_terms = shared_terms(probe, base)
        if best is not None and best_sim >= MERGE_THRESHOLD:
            return best, best_sim, best_terms
        return None, 0.0, []

    def _new_demand(self, item):
        demand = {
            "id": _uid("dm"),
            "title": item["text"][:40],
            "feature": item["feature"],
            "status": "pending",          # pending | adjudicated | needs_reconfirm
            "items": [item["id"]],
            "merge_rationales": [],
            "contradictions": [],
            "adjudication": None,
            "adjudication_history": [],
            "created_at": _now(),
        }
        self.demands[demand["id"]] = demand
        self._log("创建诉求", demand["id"],
                  f"首条反馈 {item['id']}（{item['source']}）")
        return demand

    def _attach(self, demand, item, sim, terms):
        demand["items"].append(item["id"])
        demand["merge_rationales"].append({
            "item_id": item["id"],
            "similarity": round(sim, 3),
            "shared_terms": terms,
            "matched_feature": demand["feature"],
            "confirmed": None,            # None=待确认 True/False=已确认/已拒绝
            "time": _now(),
        })
        self._refresh_contradictions(demand)
        # Requirement 5: new evidence invalidates a previous adjudication.
        if demand["status"] == "adjudicated":
            old = demand["adjudication"]
            old["invalidated_at"] = _now()
            old["invalidated_by_item"] = item["id"]
            demand["adjudication_history"].append(old)
            demand["adjudication"] = None
            demand["status"] = "needs_reconfirm"
            self._log("判定依据变化", demand["id"],
                      f"新反馈 {item['id']}（{item['source']}）并入，原裁定"
                      f"「{old['disposition']}/{old['priority']}」已失效，需重新确认")
        else:
            self._log("归并反馈", demand["id"],
                      f"反馈 {item['id']} 以相似度 {round(sim, 3)} 并入")
    def _refresh_contradictions(self, demand):
        resolved = {
            (c["item_a"], c["item_b"], c["claim_a"], c["claim_b"]): c
            for c in demand["contradictions"] if c["status"] == "resolved"
        }
        items = [self.items[i] for i in demand["items"]]
        fresh = []
        for cand in detect_contradictions(items):
            key = (cand["item_a"], cand["item_b"], cand["claim_a"], cand["claim_b"])
            if key in resolved:
                fresh.append(resolved[key])
            else:
                cand.update({"id": _uid("ct"), "status": "pending",
                             "resolution": None, "detected_at": _now()})
                fresh.append(cand)
                self._log("发现矛盾", demand["id"],
                          f"「{cand['claim_a']}」 vs 「{cand['claim_b']}」，"
                          f"双方均已保留，待裁定")
        demand["contradictions"] = fresh

    def resolve_contradiction(self, demand_id, contradiction_id, note, operator):
        demand = self.demands[demand_id]
        for c in demand["contradictions"]:
            if c["id"] == contradiction_id:
                if c["status"] == "resolved":
                    raise ValueError("该矛盾已裁定")
                c["status"] = "resolved"
                c["resolution"] = {"note": note, "operator": operator,
                                   "time": _now()}
                self._log("裁定矛盾", demand_id,
                          f"矛盾「{c['claim_a']}」vs「{c['claim_b']}」：{note}"
                          f"（双方表述均保留）", operator)
                return c
        raise KeyError("矛盾记录不存在")

    def confirm_merge(self, demand_id, item_id, accept, operator):
        demand = self.demands[demand_id]
        for r in demand["merge_rationales"]:
            if r["item_id"] == item_id and r["confirmed"] is None:
                r["confirmed"] = bool(accept)
                if accept:
                    self._log("确认归并", demand_id,
                              f"确认反馈 {item_id} 属于本诉求", operator)
                    return demand
                demand["items"].remove(item_id)
                item = self.items[item_id]
                new_d = self._new_demand(item)
                self._refresh_contradictions(demand)
                self._log("拒绝归并", demand_id,
                          f"反馈 {item_id} 拆分为新诉求 {new_d['id']}", operator)
                return demand
        raise KeyError("未找到待确认的归并记录")

    def merge_demands(self, source_id, target_id, operator):
        """Manual merge of two demands; keeps every item and rationale."""
        src, tgt = self.demands[source_id], self.demands[target_id]
        for iid in src["items"]:
            tgt["items"].append(iid)
            tgt["merge_rationales"].append({
                "item_id": iid, "similarity": None, "shared_terms": [],
                "matched_feature": tgt["feature"], "confirmed": True,
                "time": _now(), "note": f"运营手动合并自诉求 {source_id}",
            })
        if src["adjudication"]:
            tgt["adjudication_history"].append(src["adjudication"])
        del self.demands[source_id]
        self._refresh_contradictions(tgt)
        if tgt["status"] == "adjudicated":
            tgt["adjudication_history"].append(tgt["adjudication"])
            tgt["adjudication"] = None
            tgt["status"] = "needs_reconfirm"
        self._log("手动合并诉求", target_id,
                  f"诉求 {source_id} 整体并入，共 {len(tgt['items'])} 条反馈",
                  operator)
        return tgt

    def adjudicate(self, demand_id, disposition, priority, note, operator):
        if disposition not in DISPOSITIONS:
            raise ValueError(f"去向必须是：{'/'.join(DISPOSITIONS)}")
        if priority not in PRIORITY_LEVELS:
            raise ValueError(f"优先级必须是：{'/'.join(PRIORITY_LEVELS)}")
        demand = self.demands[demand_id]
        if demand["adjudication"]:
            demand["adjudication_history"].append(demand["adjudication"])
        demand["adjudication"] = {
            "disposition": disposition, "priority": priority, "note": note,
            "operator": operator, "time": _now(),
            "basis_item_ids": list(demand["items"]),
        }
        demand["status"] = "adjudicated"
        self._log("裁定诉求", demand_id,
                  f"去向「{disposition}」优先级「{priority}」：{note}", operator)
        return demand

    def board(self):
        """Demands enriched with computed fields, sorted by final priority."""
        rank = {p: i for i, p in enumerate(PRIORITY_LEVELS)}
        out = []
        for d in self.demands.values():
            items = [self.items[i] for i in d["items"]]
            prio = compute_priority(items)
            d2 = dict(d)
            d2["items"] = items
            d2["computed"] = prio
            d2["final_priority"] = final_priority(d, items)
            d2["pending_merges"] = sum(1 for r in d["merge_rationales"]
                                       if r["confirmed"] is None)
            d2["pending_contradictions"] = sum(
                1 for c in d["contradictions"] if c["status"] == "pending")
            out.append(d2)
        out.sort(key=lambda d: (rank[d["final_priority"]],
                                -d["computed"]["score"]))
        return {"demands": out,
                "audit_log": list(reversed(self.audit_log[-200:])),
                "pending_items": sum(1 for d in out if d["status"] == "pending")}
