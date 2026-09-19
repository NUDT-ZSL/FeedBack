# -*- coding: utf-8 -*-
"""处置推演台核心引擎。

沿节点顺序推导预计到达与延误；异常信号落到节点区间；
冲突信号全部保留并标记，裁决前按保守口径参与推导；
裁决/响应动作只失效受影响运输单，从受影响区间起增量重推；
节点不可达或响应超时给出中断结论与依据链。
"""
import json
from datetime import datetime, timedelta

PROBLEM_TYPES = {"congestion", "breakdown", "road_closure", "weather"}
UNREACHABLE_TYPES = {"road_closure", "breakdown"}
DEFAULT_SIGNAL_DELAY = {"congestion": 40, "breakdown": 120, "road_closure": 240,
                        "weather": 60, "delay_update": 30, "recovery": 0}
SEVERITY_SLA_MIN = {5: 30, 4: 30, 3: 60, 2: 120, 1: 120}
CONFLICT_DELAY_SPREAD = 30
ACTION_PRESETS = {
    "wait": {"label": "等待观察", "extra_delay": 0, "resolves": False, "expedite_credit": 0},
    "reroute": {"label": "绕行", "extra_delay": 45, "resolves": True, "expedite_credit": 0},
    "transload": {"label": "换车转运", "extra_delay": 90, "resolves": True, "expedite_credit": 0},
    "expedite": {"label": "赶工提速", "extra_delay": 0, "resolves": False, "expedite_credit": 30},
    "cancel_leg": {"label": "中止区间", "extra_delay": 0, "resolves": False, "expedite_credit": 0,
                   "forces_interrupt": True},
}


def parse(t):
    return datetime.fromisoformat(t)


def iso(dt):
    return dt.isoformat(timespec="minutes")


class Store:
    def __init__(self):
        self.shipments = {}
        self.signals = {}
        self.actions = {}
        self.adjudications = {}
        self.now = None
        self._seq = 0
        self._cache = {}
        self._dirty = {}

    def load_seed(self, path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.__init__()
        self.now = parse(data["now"])
        for sh in data["shipments"]:
            self.shipments[sh["id"]] = sh
        for s in data.get("signals", []):
            self._put_signal(s)
        self.recompute_all()

    def _next_id(self, prefix):
        self._seq += 1
        return "%s-%d" % (prefix, self._seq)

    # ---- 变更入口：只失效受影响运输单，记录最早受影响区间 ----
    def _put_signal(self, s):
        s = dict(s)
        s.setdefault("id", self._next_id("SIG"))
        s.setdefault("status", "active")
        s.setdefault("unreachable", False)
        s.setdefault("delay_minutes", None)
        if s.get("revises") and s["revises"] in self.signals:
            self.signals[s["revises"]]["status"] = "superseded"
        self.signals[s["id"]] = s
        return s["id"]

    def add_signal(self, s):
        new_id = self._put_signal(s)
        sig = self.signals[new_id]
        self._invalidate(sig["shipment_id"],
                         self._signal_leg(self.shipments[sig["shipment_id"]], sig))
        return new_id

    def retract_signal(self, signal_id):
        sig = self.signals.get(signal_id)
        if sig:
            sig["status"] = "retracted"
            self._invalidate(sig["shipment_id"],
                             self._signal_leg(self.shipments[sig["shipment_id"]], sig))

    def adjudicate(self, conflict_id, shipment_id, leg_index, kept_ids, by="dispatch"):
        covers = sorted(s["id"] for s in self._active_leg_signals(shipment_id, leg_index))
        self.adjudications[conflict_id] = {
            "kept": list(kept_ids), "by": by, "at": iso(self.now), "covers": covers}
        self._invalidate(shipment_id, int(leg_index))

    def add_action(self, a):
        a = dict(a)
        a.setdefault("id", self._next_id("ACT"))
        a.setdefault("decided_at", iso(self.now))
        self.actions[a["id"]] = a
        self._invalidate(a["shipment_id"], int(a.get("leg_index", 0)))
        return a["id"]

    def remove_action(self, action_id):
        a = self.actions.pop(action_id, None)
        if a:
            self._invalidate(a["shipment_id"], int(a.get("leg_index", 0)))

    def set_clock(self, t):
        self.now = parse(t)
        self.recompute_all()

    def _invalidate(self, sid, leg):
        self._dirty[sid] = min(self._dirty.get(sid, leg), leg)

    def recompute_all(self):
        self._cache = {}
        self._dirty = {}
        for sid in self.shipments:
            self._cache[sid] = self.compute_shipment(sid, 0)

    def get_state(self):
        for sid, leg in list(self._dirty.items()):
            self._cache[sid] = self.compute_shipment(sid, leg)
        self._dirty = {}
        conflicts = []
        for res in self._cache.values():
            conflicts.extend(res["conflicts"])
        return {
            "now": iso(self.now),
            "shipments": [self._public_shipment(sid) for sid in self.shipments],
            "signals": sorted(self.signals.values(), key=lambda s: (s["occurred_at"], s["id"])),
            "actions": list(self.actions.values()),
            "conflicts": conflicts,
            "action_presets": {k: v["label"] for k, v in ACTION_PRESETS.items()},
        }

    # ---- 信号落区间 ----
    def _signal_leg(self, sh, s):
        n = len(sh["nodes"])
        if s.get("leg_index") is not None:
            return max(0, min(int(s["leg_index"]), n - 2))
        if s.get("node_id"):
            for i, nd in enumerate(sh["nodes"]):
                if nd["id"] == s["node_id"]:
                    return max(0, i - 1)
        prog = sh.get("progress", {}).get("actual_arrivals", {})
        anchor = max((i for i, nd in enumerate(sh["nodes"]) if nd["id"] in prog), default=-1)
        return min(anchor + 1, n - 2)

    def _active_leg_signals(self, sid, li):
        sh = self.shipments[sid]
        out = [s for s in self.signals.values()
               if s["shipment_id"] == sid and s["status"] == "active"
               and self._signal_leg(sh, s) == li]
        return sorted(out, key=lambda s: (s["occurred_at"], s["id"]))

    def _leg_actions(self, sid, li):
        return [a for a in self.actions.values()
                if a["shipment_id"] == sid and int(a.get("leg_index", -1)) == li]

    def _leg_conflict(self, sid, li, sigs):
        if len(sigs) < 2:
            return None
        reasons = []
        types = {s["type"] for s in sigs}
        if "recovery" in types and types & PROBLEM_TYPES:
            reasons.append("恢复信号与异常信号相互矛盾")
        delays = [s["delay_minutes"] for s in sigs if s.get("delay_minutes") is not None]
        if len(delays) >= 2 and max(delays) - min(delays) >= CONFLICT_DELAY_SPREAD:
            reasons.append("延误估计差异≥%d分钟" % CONFLICT_DELAY_SPREAD)
        if not reasons:
            return None
        cid = "CONFLICT::%s::%d" % (sid, li)
        adj = self.adjudications.get(cid)
        ids = {s["id"] for s in sigs}
        adjudicated = bool(adj) and sorted(ids) == adj.get("covers") \
            and all(k in ids for k in adj["kept"])
        return {"id": cid, "shipment_id": sid, "leg_index": li, "reasons": reasons,
                "signals": [self._public_signal(s) for s in sigs],
                "adjudicated": adjudicated,
                "kept_signal_ids": adj["kept"] if adjudicated else []}

    # ---- 节点顺序推导（支持从 from_leg 起增量重推） ----
    def compute_shipment(self, sid, from_leg=0):
        sh = self.shipments[sid]
        nodes = sh["nodes"]
        n = len(nodes)
        dwell = [int(nd.get("dwell_minutes", 30)) for nd in nodes]
        actual = sh.get("progress", {}).get("actual_arrivals", {})
        anchor = max((i for i, nd in enumerate(nodes) if nd["id"] in actual), default=-1)
        start = max(anchor, 0)
        prev = self._cache.get(sid)
        if prev is None or from_leg <= start:
            from_leg = start
            prev = None
        eta = [None] * n
        status = ["pending"] * n
        leg_res = [None] * (n - 1)
        interruption = None
        if prev:
            eta[:from_leg + 1] = prev["eta"][:from_leg + 1]
            status[:from_leg + 1] = prev["status"][:from_leg + 1]
            leg_res[:from_leg] = prev["legs"][:from_leg]
            if prev.get("interruption") and prev["interruption"]["at_leg"] < from_leg:
                interruption = prev["interruption"]
        else:
            for i, nd in enumerate(nodes):
                if nd["id"] in actual:
                    eta[i] = actual[nd["id"]]
                    status[i] = "actual"
            if anchor < 0:
                eta[0] = nodes[0]["planned_arrival"]
                status[0] = "planned"
            for i in range(start):
                if eta[i] is None:
                    eta[i] = nodes[i]["planned_arrival"]
                    status[i] = "planned"
        for i in range(start, n - 1):
            if i < from_leg:
                continue
            if eta[i] is None:
                for j in range(i, n):
                    eta[j] = None
                    if status[j] != "actual":
                        status[j] = "unreachable"
                break
            sigs = self._active_leg_signals(sid, i)
            conflict = self._leg_conflict(sid, i, sigs)
            eff = sigs
            if conflict and conflict["adjudicated"]:
                kept = set(conflict["kept_signal_ids"])
                eff = [s for s in sigs if s["id"] in kept]
            problem = [s for s in eff if s["type"] != "recovery"]
            if conflict and not conflict["adjudicated"]:
                has_recovery = False  # 冲突未裁决：恢复信号不计入，按保守口径
            else:
                has_recovery = any(s["type"] == "recovery" for s in eff)
            sig_delay = sum(s["delay_minutes"] if s.get("delay_minutes") is not None
                            else DEFAULT_SIGNAL_DELAY.get(s["type"], 30) for s in problem)
            unreachable = any(s.get("unreachable") or
                              (s["type"] in UNREACHABLE_TYPES and int(s["severity"]) >= 4)
                              for s in problem) and not has_recovery
            acts = self._leg_actions(sid, i)
            extra = 0
            forced = False
            for a in acts:
                p = ACTION_PRESETS[a["kind"]]
                extra += p["extra_delay"]
                if p["resolves"]:
                    unreachable = False
                if a["kind"] == "expedite":
                    sig_delay = max(0, sig_delay - p["expedite_credit"])
                if p.get("forces_interrupt"):
                    forced = True
            timeouts = []
            for s in problem:
                sev = int(s["severity"])
                if sev >= 4:
                    deadline = parse(s["occurred_at"]) + timedelta(minutes=SEVERITY_SLA_MIN[sev])
                    acted = any(a.get("signal_id") == s["id"] for a in acts)
                    if not acted and self.now and self.now > deadline:
                        timeouts.append({"signal": s, "deadline": iso(deadline)})
            total = sig_delay + extra
            dep = parse(eta[i]) + timedelta(minutes=dwell[i])
            plan_min = int((parse(nodes[i + 1]["planned_arrival"])
                            - (parse(nodes[i]["planned_arrival"])
                               + timedelta(minutes=dwell[i]))).total_seconds() // 60)
            arr = dep + timedelta(minutes=plan_min + total)
            leg_res[i] = {"index": i, "from_name": nodes[i]["name"],
                          "to_name": nodes[i + 1]["name"],
                          "planned_minutes": plan_min,
                          "signal_delay": sig_delay, "action_delay": extra,
                          "signals": [self._public_signal(s) for s in sigs],
                          "actions": acts, "conflict": conflict}
            reason = None
            if forced:
                reason = "manual_cancel"
            elif unreachable:
                reason = "unreachable"
            elif timeouts:
                reason = "timeout"
            if reason:
                interruption = self._build_interruption(
                    sh, i, reason, problem, timeouts, acts, conflict)
                for j in range(i + 1, n):
                    eta[j] = None
                    status[j] = "unreachable"
                break
            eta[i + 1] = iso(arr)
            planned = parse(nodes[i + 1]["planned_arrival"])
            status[i + 1] = "delayed" if arr > planned else "on_time"
        delays = [int((parse(eta[i]) - parse(nodes[i]["planned_arrival"])).total_seconds() // 60)
                  for i in range(n) if eta[i] and status[i] != "unreachable"]
        conflicts_all = [lr["conflict"] for lr in leg_res if lr and lr.get("conflict")]
        if interruption:
            st = "interrupted"
        elif any(c and not c["adjudicated"] for c in conflicts_all):
            st = "conflict_pending"
        elif delays and max(delays) > 0:
            st = "delayed"
        else:
            st = "normal"
        return {"eta": eta, "status": status, "legs": leg_res, "conflicts": conflicts_all,
                "interruption": interruption, "shipment_status": st,
                "max_delay": max(delays) if delays else 0}

    # ---- 中断结论与依据链 ----
    def _build_interruption(self, sh, i, reason, problem, timeouts, acts, conflict):
        nodes = sh["nodes"]
        chain = []
        for s in problem:
            chain.append({"step": "信号", "at": s["occurred_at"],
                          "detail": "%s 报告 %s（严重度%s）：%s"
                                    % (s["source"], s["type"], s["severity"],
                                       s.get("note") or "无备注")})
        if conflict and not conflict["adjudicated"]:
            chain.append({"step": "冲突", "at": iso(self.now),
                          "detail": "区间存在未裁决冲突（%s），按保守口径参与推导"
                                    % "；".join(conflict["reasons"])})
        if reason == "unreachable":
            chain.append({"step": "规则", "at": iso(self.now),
                          "detail": "道路封闭/故障类信号严重度≥4，无有效恢复信号或处置动作解除 → 节点不可达"})
        elif reason == "timeout":
            for t in timeouts:
                chain.append({"step": "规则", "at": iso(self.now),
                              "detail": "信号 %s 应于 %s 前响应，截至 %s 未响应 → 响应超时"
                                        % (t["signal"]["id"], t["deadline"], iso(self.now))})
        else:
            chain.append({"step": "动作", "at": iso(self.now),
                          "detail": "调度手动中止该区间"})
        for a in acts:
            chain.append({"step": "响应动作", "at": a.get("decided_at"),
                          "detail": "%s 执行 %s"
                                    % (a.get("owner", "?"), ACTION_PRESETS[a["kind"]]["label"])})
        chain.append({"step": "结论", "at": iso(self.now),
                      "detail": "节点 %s 不可达，运输单 %s 中断于区间 %s→%s，下游节点不再沿用旧预计"
                                % (nodes[i + 1]["name"], sh["id"],
                                   nodes[i]["name"], nodes[i + 1]["name"])})
        return {"at_leg": i, "node_id": nodes[i + 1]["id"],
                "node_name": nodes[i + 1]["name"], "reason": reason, "chain": chain}

    def _public_signal(self, s):
        return {k: s.get(k) for k in
                ("id", "shipment_id", "type", "severity", "source", "occurred_at",
                 "delay_minutes", "unreachable", "note", "status", "revises")}

    def _public_shipment(self, sid):
        sh = self.shipments[sid]
        res = self._cache[sid]
        nodes = []
        for i, nd in enumerate(sh["nodes"]):
            eta = res["eta"][i]
            delay = None
            if eta:
                delay = int((parse(eta) - parse(nd["planned_arrival"])).total_seconds() // 60)
            nodes.append({"id": nd["id"], "name": nd["name"],
                          "planned_arrival": nd["planned_arrival"],
                          "eta": eta, "delay_min": delay, "status": res["status"][i]})
        return {"id": sid, "name": sh.get("name", sid), "carrier": sh.get("carrier", ""),
                "status": res["shipment_status"], "max_delay": res["max_delay"],
                "nodes": nodes, "legs": [lr for lr in res["legs"] if lr],
                "interruption": res["interruption"]}
