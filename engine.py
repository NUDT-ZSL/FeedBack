# -*- coding: utf-8 -*-
"""实验比较核心引擎：数据模型、冲突检测、增量更新与全量重算一致性。"""
import copy

from stats import two_proportion_ztest, sample_adequacy

MIN_ENTRANTS = 100   # 单侧最小进入人数
SIGNIFICANCE = 0.05  # 显著性水平


def new_store():
    return {
        "groups": {},        # id -> 分组（含观测数据）
        "variants": {},      # id -> 变体
        "memberships": [],   # {variant_id, group_id, status: active|excluded}
        "resolutions": {},   # conflict_key -> 裁决记录
        "baseline_group": None,
        "seq": 0,
    }


def _next_id(store, prefix):
    store["seq"] = store.get("seq", 0) + 1
    return "%s%d" % (prefix, store["seq"])


def _periods_overlap(a_start, a_end, b_start, b_end):
    return a_start <= b_end and b_start <= a_end


class Engine(object):
    def __init__(self, store=None):
        self.store = store if store is not None else new_store()
        self.conflicts = {}    # key -> 冲突
        self.conclusions = {}  # variant_id -> 结论
        self.aggregates = {}   # variant_id -> 聚合指标
        self.baseline_variant = None
        self.recompute_full()

    # ---------- 基础查询 ----------
    def active_memberships(self):
        return [m for m in self.store["memberships"] if m.get("status", "active") == "active"]

    def variant_group_ids(self, variant_id):
        return [m["group_id"] for m in self.active_memberships()
                if m["variant_id"] == variant_id and m["group_id"] in self.store["groups"]]

    def group_variant_ids(self, group_id):
        return [m["variant_id"] for m in self.active_memberships()
                if m["group_id"] == group_id and m["variant_id"] in self.store["variants"]]

    # ---------- 聚合 ----------
    def aggregate(self, variant_id):
        groups = [self.store["groups"][gid] for gid in self.variant_group_ids(variant_id)]
        entrants = sum(int(g.get("entrants", 0)) for g in groups)
        conversions = sum(int(g.get("conversions", 0)) for g in groups)
        starts = [g["period_start"] for g in groups if g.get("period_start")]
        ends = [g["period_end"] for g in groups if g.get("period_end")]
        return {
            "variant_id": variant_id,
            "group_ids": [g["id"] for g in groups],
            "entrants": entrants,
            "conversions": conversions,
            "rate": (conversions / float(entrants)) if entrants else None,
            "period": [min(starts), max(ends)] if starts and ends else None,
            "audience_keys": sorted({g.get("audience_key", "") for g in groups}),
        }
    # ---------- 冲突检测 ----------
    def detect_conflicts(self, scope_groups=None, scope_variants=None):
        """检测冲突；给定 scope 时只检测涉及这些分组/变体的冲突（用于增量更新）。"""
        found = {}
        groups = self.store["groups"]
        variants = self.store["variants"]
        # 类型一：同一分组被多个变体覆盖
        for gid, g in groups.items():
            vids = sorted(self.group_variant_ids(gid))
            if (scope_groups is not None and gid not in scope_groups
                    and not (set(vids) & (scope_variants or set()))):
                continue
            if len(vids) > 1:
                key = "multi:%s" % gid
                names = "、".join(variants[v]["name"] for v in vids if v in variants)
                found[key] = {
                    "key": key, "type": "multi_variant",
                    "title": "分组被多个变体覆盖",
                    "detail": "分组「%s」同时计入变体 %s，转化可能被重复归因，需要裁决归属。"
                              % (g.get("name", gid), names),
                    "group_ids": [gid], "variant_ids": vids,
                }
        # 类型二/三：同一变体内，同口径标识下版本冲突 / 观测时段重叠
        for vid in variants:
            if scope_variants is not None and vid not in scope_variants:
                continue
            by_key = {}
            for gid in self.variant_group_ids(vid):
                g = groups[gid]
                by_key.setdefault(g.get("audience_key", ""), []).append(g)
            for akey, gs in by_key.items():
                if len(gs) < 2:
                    continue
                versions = sorted({g.get("version", "") for g in gs})
                if len(versions) > 1:
                    key = "caliber:%s:%s" % (vid, akey or "(空)")
                    found[key] = {
                        "key": key, "type": "caliber",
                        "title": "同变体内口径版本冲突",
                        "detail": "变体「%s」下口径「%s」存在多个版本（%s），直接合并会混淆口径。"
                                  % (variants[vid]["name"], akey or "(空)", "、".join(versions)),
                        "group_ids": [g["id"] for g in gs], "variant_ids": [vid],
                    }
                ordered = sorted(gs, key=lambda g: g.get("period_start", ""))
                for i in range(len(ordered) - 1):
                    a, b = ordered[i], ordered[i + 1]
                    if (a.get("period_start") and a.get("period_end")
                            and b.get("period_start") and b.get("period_end")
                            and _periods_overlap(a["period_start"], a["period_end"],
                                                 b["period_start"], b["period_end"])):
                        key = "overlap:%s:%s" % (vid, akey or "(空)")
                        found[key] = {
                            "key": key, "type": "overlap",
                            "title": "同口径分组时段重叠",
                            "detail": "变体「%s」下口径「%s」的分组「%s」与「%s」观测时段重叠，可能重复计数。"
                                      % (variants[vid]["name"], akey or "(空)",
                                         a.get("name", a["id"]), b.get("name", b["id"])),
                            "group_ids": [a["id"], b["id"]], "variant_ids": [vid],
                        }
                        break
        for key, c in found.items():
            res = self.store["resolutions"].get(key)
            c["resolved"] = bool(res)
            c["resolution"] = res
        return found

    def _update_conflicts(self, scope_groups, scope_variants):
        for key in list(self.conflicts):
            c = self.conflicts[key]
            if c["type"] == "multi_variant":
                hit = (set(c["group_ids"]) & scope_groups) or (set(c["variant_ids"]) & scope_variants)
            else:
                hit = bool(set(c["variant_ids"]) & scope_variants)
            if hit:
                del self.conflicts[key]
        self.conflicts.update(self.detect_conflicts(scope_groups, scope_variants))
    # ---------- 基准 ----------
    def _pick_baseline_variant(self):
        locked = self.store.get("baseline_group")
        if locked and locked in self.store["groups"]:
            vids = sorted(self.group_variant_ids(locked))
            if vids:
                return vids[0]
        best = None
        for vid in sorted(self.store["variants"]):
            agg = self.aggregates.get(vid) or self.aggregate(vid)
            if best is None or agg["entrants"] > self.aggregates[best]["entrants"]:
                best = vid
        return best

    # ---------- 结论 ----------
    def _compute_conclusion(self, variant_id):
        agg = self.aggregates.get(variant_id)
        if agg is None:
            return
        base_id = self.baseline_variant
        if base_id is None or variant_id == base_id:
            self.conclusions[variant_id] = {
                "variant_id": variant_id,
                "role": "baseline" if variant_id == base_id else "idle",
                "verdict": "基准" if variant_id == base_id else "无对比对象",
                "confidence": None, "reasons": [], "warnings": [],
                "rate": agg["rate"], "entrants": agg["entrants"],
                "conversions": agg["conversions"],
            }
            return
        base = self.aggregates[base_id]
        reasons, warnings = [], []
        adequate, sample_notes = sample_adequacy(
            agg["conversions"], agg["entrants"],
            base["conversions"], base["entrants"], MIN_ENTRANTS)
        reasons.extend(sample_notes)
        if agg["period"] and base["period"]:
            if _periods_overlap(agg["period"][0], agg["period"][1],
                                base["period"][0], base["period"][1]):
                reasons.append("观测时段存在交集（%s~%s 与 %s~%s）。"
                               % (agg["period"][0], agg["period"][1],
                                  base["period"][0], base["period"][1]))
            else:
                warnings.append("时段不重叠：实验侧 %s~%s 与基准侧 %s~%s 无交集，季节/活动因素不可比。"
                                % (agg["period"][0], agg["period"][1],
                                   base["period"][0], base["period"][1]))
        else:
            warnings.append("时段缺失：存在未填写观测时段的分组，无法校验时段可比性。")
        if set(agg["audience_keys"]) != set(base["audience_keys"]):
            warnings.append("分组口径不一致：实验侧口径「%s」，基准侧口径「%s」。"
                            % ("、".join(agg["audience_keys"]) or "(空)",
                               "、".join(base["audience_keys"]) or "(空)"))
        else:
            reasons.append("两侧分组口径一致（%s）。" % "、".join(agg["audience_keys"]))
        caliber_shift = None
        locked = self.store.get("baseline_group")
        if locked and locked in self.store["groups"]:
            lkey = self.store["groups"][locked].get("audience_key", "")
            extra = [k for k in agg["audience_keys"] if k != lkey]
            if extra:
                caliber_shift = ("相对锁定基准口径「%s」，该变体额外覆盖口径：%s。"
                                 % (lkey, "、".join(extra)))
                warnings.append("口径偏移（基准锁定）：" + caliber_shift)
        z, p = two_proportion_ztest(agg["conversions"], agg["entrants"],
                                    base["conversions"], base["entrants"])
        lift = rel = None
        if agg["rate"] is not None and base["rate"] is not None:
            lift = agg["rate"] - base["rate"]
            rel = (lift / base["rate"]) if base["rate"] else None
        if not adequate:
            verdict, confidence = "样本量不足", "低"
            reasons.append("样本量不足时检验功效过低，差异方向不可信。")
        elif p is None:
            verdict, confidence = "无法判定", "低"
            reasons.append("任一侧样本为 0，无法构造检验统计量。")
        else:
            reasons.append("双比例 z 检验：z=%.3f，p=%.4f（显著性水平 %.2f）。"
                           % (z, p, SIGNIFICANCE))
            if p < SIGNIFICANCE:
                verdict = "显著优于基准" if (lift or 0) > 0 else "显著劣于基准"
            else:
                verdict = "无显著差异"
            confidence = "高" if not warnings else ("中" if len(warnings) == 1 else "低")
        self.conclusions[variant_id] = {
            "variant_id": variant_id, "role": "treatment",
            "baseline_variant": base_id,
            "verdict": verdict, "confidence": confidence,
            "rate": agg["rate"], "base_rate": base["rate"],
            "lift": lift, "rel_lift": rel, "p_value": p, "z": z,
            "entrants": agg["entrants"], "conversions": agg["conversions"],
            "base_entrants": base["entrants"], "base_conversions": base["conversions"],
            "reasons": reasons, "warnings": warnings,
            "caliber_shift": caliber_shift,
            "baseline_locked": bool(locked),
        }
    # ---------- 重算 ----------
    def recompute_full(self):
        self.aggregates = {vid: self.aggregate(vid) for vid in self.store["variants"]}
        self.conflicts = self.detect_conflicts()
        self.baseline_variant = self._pick_baseline_variant()
        self.conclusions = {}
        for vid in self.store["variants"]:
            self._compute_conclusion(vid)

    def apply_change(self, group_ids=(), variant_ids=()):
        """增量更新：只重算受影响对象；若基准受影响则连带重算全部结论。"""
        group_ids = set(group_ids)
        variant_ids = set(variant_ids)
        for m in self.store["memberships"]:
            if m["group_id"] in group_ids:
                variant_ids.add(m["variant_id"])
            if m["variant_id"] in variant_ids:
                group_ids.add(m["group_id"])
        self._update_conflicts(group_ids, variant_ids)
        for vid in variant_ids:
            if vid in self.store["variants"]:
                self.aggregates[vid] = self.aggregate(vid)
            else:
                self.aggregates.pop(vid, None)
                self.conclusions.pop(vid, None)
        new_base = self._pick_baseline_variant()
        base_changed = new_base != self.baseline_variant
        self.baseline_variant = new_base
        if base_changed or self.baseline_variant in variant_ids:
            for vid in self.store["variants"]:
                self._compute_conclusion(vid)
        else:
            for vid in variant_ids:
                if vid in self.store["variants"]:
                    self._compute_conclusion(vid)

    # ---------- 状态与一致性 ----------
    def state(self):
        locked = self.store.get("baseline_group")
        return {
            "groups": [self.store["groups"][k] for k in sorted(self.store["groups"])],
            "variants": [self.store["variants"][k] for k in sorted(self.store["variants"])],
            "memberships": list(self.store["memberships"]),
            "conflicts": [self.conflicts[k] for k in sorted(self.conflicts)],
            "conclusions": [self.conclusions[k] for k in sorted(self.conclusions)],
            "aggregates": {k: self.aggregates[k] for k in sorted(self.aggregates)},
            "baseline": {
                "variant_id": self.baseline_variant,
                "locked_group": locked,
                "locked": bool(locked),
                "lock_effective": bool(locked) and bool(self.group_variant_ids(locked)),
            },
        }

    def _normalized(self):
        import json
        return json.dumps({
            "conflicts": self.conflicts,
            "conclusions": self.conclusions,
            "aggregates": self.aggregates,
            "baseline": self.baseline_variant,
        }, sort_keys=True, ensure_ascii=False)

    def verify_consistency(self):
        """增量状态必须与基于同一存储的从头全量重算完全一致。"""
        fresh = Engine(copy.deepcopy(self.store))
        return self._normalized() == fresh._normalized()
    # ---------- 变更操作（增量入口） ----------
    def _check_counts(self, entrants, conversions):
        if entrants < 0 or conversions < 0:
            raise ValueError("人数不能为负")
        if conversions > entrants:
            raise ValueError("转化人数不能大于进入人数")

    def add_group(self, d):
        entrants = int(d.get("entrants", 0))
        conversions = int(d.get("conversions", 0))
        self._check_counts(entrants, conversions)
        gid = _next_id(self.store, "g")
        self.store["groups"][gid] = {
            "id": gid,
            "name": d.get("name") or gid,
            "audience_key": d.get("audience_key", ""),
            "definition": d.get("definition", ""),
            "version": d.get("version", "v1"),
            "entrants": entrants,
            "conversions": conversions,
            "period_start": d.get("period_start", ""),
            "period_end": d.get("period_end", ""),
            "source": d.get("source", "手工录入"),
        }
        self.apply_change(group_ids={gid})
        return gid

    def update_group(self, gid, d):
        g = self.store["groups"].get(gid)
        if not g:
            raise ValueError("分组不存在")
        for k in ("name", "audience_key", "definition", "version",
                  "period_start", "period_end", "source"):
            if k in d:
                g[k] = d[k]
        if "entrants" in d:
            g["entrants"] = int(d["entrants"])
        if "conversions" in d:
            g["conversions"] = int(d["conversions"])
        self._check_counts(g["entrants"], g["conversions"])
        self.apply_change(group_ids={gid})

    def delete_group(self, gid):
        if gid not in self.store["groups"]:
            raise ValueError("分组不存在")
        vids = {m["variant_id"] for m in self.store["memberships"] if m["group_id"] == gid}
        self.store["memberships"] = [m for m in self.store["memberships"]
                                     if m["group_id"] != gid]
        del self.store["groups"][gid]
        if self.store.get("baseline_group") == gid:
            self.store["baseline_group"] = None
        self.apply_change(group_ids={gid}, variant_ids=vids)

    def add_variant(self, d):
        vid = _next_id(self.store, "v")
        self.store["variants"][vid] = {
            "id": vid,
            "name": d.get("name") or vid,
            "description": d.get("description", ""),
        }
        self.apply_change(variant_ids={vid})
        return vid

    def update_variant(self, vid, d):
        v = self.store["variants"].get(vid)
        if not v:
            raise ValueError("变体不存在")
        for k in ("name", "description"):
            if k in d:
                v[k] = d[k]
        self.apply_change(variant_ids={vid})

    def delete_variant(self, vid):
        if vid not in self.store["variants"]:
            raise ValueError("变体不存在")
        gids = {m["group_id"] for m in self.store["memberships"] if m["variant_id"] == vid}
        self.store["memberships"] = [m for m in self.store["memberships"]
                                     if m["variant_id"] != vid]
        del self.store["variants"][vid]
        self.apply_change(group_ids=gids, variant_ids={vid})

    def add_membership(self, vid, gid):
        if vid not in self.store["variants"]:
            raise ValueError("变体不存在")
        if gid not in self.store["groups"]:
            raise ValueError("分组不存在")
        for m in self.store["memberships"]:
            if m["variant_id"] == vid and m["group_id"] == gid:
                m["status"] = "active"
                self.apply_change(group_ids={gid}, variant_ids={vid})
                return
        self.store["memberships"].append(
            {"variant_id": vid, "group_id": gid, "status": "active"})
        self.apply_change(group_ids={gid}, variant_ids={vid})

    def remove_membership(self, vid, gid):
        before = len(self.store["memberships"])
        self.store["memberships"] = [
            m for m in self.store["memberships"]
            if not (m["variant_id"] == vid and m["group_id"] == gid)]
        if len(self.store["memberships"]) == before:
            raise ValueError("归属关系不存在")
        self.apply_change(group_ids={gid}, variant_ids={vid})
    def resolve_conflict(self, key, action, variant_id=None, group_id=None):
        c = self.conflicts.get(key)
        if not c:
            raise ValueError("冲突不存在或已消解")
        if action == "keep_variant":
            if variant_id not in c["variant_ids"]:
                raise ValueError("所选变体不在冲突中")
            gid = c["group_ids"][0]
            for m in self.store["memberships"]:
                if m["group_id"] == gid and m["variant_id"] != variant_id:
                    m["status"] = "excluded"
            note = "裁决：该分组仅计入变体「%s」，其余归属保留但标记为排除。" % (
                self.store["variants"][variant_id]["name"])
        elif action == "exclude_membership":
            found = False
            for m in self.store["memberships"]:
                if m["variant_id"] == variant_id and m["group_id"] == group_id:
                    m["status"] = "excluded"
                    found = True
            if not found:
                raise ValueError("归属关系不存在")
            note = "裁决：排除归属（变体 %s × 分组 %s），记录保留。" % (variant_id, group_id)
        elif action == "ack":
            note = "标记为已知风险，保留全部来源不做排除。"
        else:
            raise ValueError("未知裁决动作")
        self.store["resolutions"][key] = {
            "action": action, "variant_id": variant_id,
            "group_id": group_id, "note": note,
        }
        self.apply_change(group_ids=set(c["group_ids"]), variant_ids=set(c["variant_ids"]))

    def set_baseline(self, group_id):
        if group_id and group_id not in self.store["groups"]:
            raise ValueError("分组不存在")
        self.store["baseline_group"] = group_id or None
        self.apply_change(variant_ids=set(self.store["variants"]))


def demo_store():
    """演示数据：刻意包含三类冲突与样本不足场景。"""
    e = Engine(new_store())
    g1 = e.add_group({"name": "新客-AppPush", "audience_key": "新客", "version": "v1",
                      "definition": "近30天新注册且未下单", "entrants": 1200,
                      "conversions": 96, "period_start": "2026-08-01",
                      "period_end": "2026-08-31", "source": "投放平台A"})
    g2 = e.add_group({"name": "老客-短信", "audience_key": "老客", "version": "v1",
                      "definition": "历史有单且90天未复购", "entrants": 800,
                      "conversions": 88, "period_start": "2026-08-01",
                      "period_end": "2026-08-31", "source": "CRM"})
    g3 = e.add_group({"name": "新客-AppPush(宽口径)", "audience_key": "新客", "version": "v2",
                      "definition": "近60天新注册（含已下单）", "entrants": 500,
                      "conversions": 60, "period_start": "2026-08-15",
                      "period_end": "2026-09-15", "source": "投放平台A"})
    g4 = e.add_group({"name": "对照-新客", "audience_key": "新客", "version": "v1",
                      "definition": "近30天新注册且未下单", "entrants": 1500,
                      "conversions": 105, "period_start": "2026-08-01",
                      "period_end": "2026-08-31", "source": "投放平台A"})
    g5 = e.add_group({"name": "小众兴趣包", "audience_key": "兴趣包", "version": "v1",
                      "definition": "小众兴趣标签人群", "entrants": 40,
                      "conversions": 6, "period_start": "2026-08-01",
                      "period_end": "2026-08-31", "source": "投放平台B"})
    va = e.add_variant({"name": "变体A-优惠券", "description": "满100减20券"})
    vb = e.add_variant({"name": "变体B-满减", "description": "满200减50"})
    vc = e.add_variant({"name": "对照组", "description": "不干预"})
    e.add_membership(va, g1)
    e.add_membership(va, g2)
    e.add_membership(va, g3)   # 与 g1 口径版本冲突 + 时段重叠
    e.add_membership(vb, g3)   # g3 被两个变体覆盖
    e.add_membership(vb, g5)   # 样本不足
    e.add_membership(vc, g4)
    e.set_baseline(g4)         # 演示基准锁定：对照-新客
    return e.store
