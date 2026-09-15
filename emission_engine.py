# -*- coding: utf-8 -*-
"""多园区减排目标校准引擎（纯标准库，可离线运行）。

核心口径约定
------------
* 季度用字符串 "2026Q1" / "2026-Q1" 表示，内部换算为绝对季度序号（year*4 + q - 1）。
* 累计目标：已结束阶段计全部额度；当前阶段按已流逝季度数线性折算；未来阶段不计。
* 累计实绩：仅汇总"已上报且无未决冲突"的季度；缺失季度与冲突季度不计入，
  但在结果中明确标注，绝不按零排放处理。
* 偏差率 = (累计实绩 - 累计目标) / 累计目标，基于累计口径而非单季口径。
* 状态：on_track / deviated（偏差率超过容忍带）/ data_missing（尾部连续未上报
  季度数达到阈值，此时即使账面达标也不判 on_track，避免缺失被误当零排放虚增达标）。
* 目标调整：已结束阶段按实绩结算（追认），当前阶段额度保持不变，结算出的
  超出量由当前阶段之后的剩余阶段按策略（均摊/权重，零权重不参与）核减，
  全部阶段额度之和在调整前后严格守恒。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

__all__ = [
    "EngineError",
    "ValidationError",
    "StateError",
    "parse_quarter",
    "format_quarter",
    "CalibrationEngine",
]

SCHEMA_VERSION = 1
_EPS = 1e-9


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------

class EngineError(Exception):
    """引擎所有错误的基类。"""


class ValidationError(EngineError):
    """配置或数据非法（阶段不连续、季度非法、导入损坏等）。"""


class StateError(EngineError):
    """当前状态不允许该操作（如未偏离却要求调整目标）。"""


# ---------------------------------------------------------------------------
# 季度工具
# ---------------------------------------------------------------------------

_QUARTER_RE = re.compile(r"^(\d{4})-?[Qq]([1-4])$")


def parse_quarter(text):
    """把 "2026Q1" / "2026-Q1" 解析为绝对季度序号；非法输入抛 ValidationError。"""
    if isinstance(text, int) and not isinstance(text, bool):
        return text
    if not isinstance(text, str):
        raise ValidationError("季度必须是形如 '2026Q1' 的字符串，收到: %r" % (text,))
    m = _QUARTER_RE.match(text.strip())
    if not m:
        raise ValidationError(
            "季度格式非法: %r，应为 'YYYYQn'（n 为 1-4），如 '2026Q1'" % (text,))
    year, q = int(m.group(1)), int(m.group(2))
    return year * 4 + (q - 1)


def format_quarter(index):
    """把绝对季度序号格式化为 'YYYYQn'。"""
    if not isinstance(index, int) or index < 0:
        raise ValidationError("季度序号非法: %r" % (index,))
    return "%dQ%d" % (index // 4, index % 4 + 1)


def _quarter_range(start, end):
    """[start, end] 闭区间的季度序号列表。"""
    return list(range(start, end + 1))


# ---------------------------------------------------------------------------
# 内部数据模型
# ---------------------------------------------------------------------------

@dataclass
class Stage:
    """一个阶段目标：起止季度（闭区间）+ 该阶段累计允许排放量。"""

    stage_id: str
    start: int           # 绝对季度序号
    end: int             # 绝对季度序号（含）
    allowance: float     # 当前额度（可能被调整过）
    original_allowance: float  # 初始额度（调整历史可追溯）

    @property
    def n_quarters(self):
        return self.end - self.start + 1

    def target_up_to(self, q):
        """截至季度 q 该阶段应累计的目标量（线性折算）。"""
        if q < self.start:
            return 0.0
        if q >= self.end:
            return self.allowance
        return self.allowance * (q - self.start + 1) / self.n_quarters

    def to_dict(self):
        return {
            "stage_id": self.stage_id,
            "start": format_quarter(self.start),
            "end": format_quarter(self.end),
            "allowance": self.allowance,
            "original_allowance": self.original_allowance,
        }


@dataclass
class Park:
    park_id: str
    baseline: float                       # 基准年排放量
    stages: list = field(default_factory=list)          # List[Stage]，按 start 升序、连续
    reports: dict = field(default_factory=dict)         # {季度序号: {来源: 数值}}
    adjustments: list = field(default_factory=list)     # 调整历史
    conflicts: list = field(default_factory=list)       # 冲突记录（含已解决）

    @property
    def horizon_start(self):
        return self.stages[0].start

    @property
    def horizon_end(self):
        return self.stages[-1].end

    def stage_at(self, q):
        for st in self.stages:
            if st.start <= q <= st.end:
                return st
        return None


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------

class CalibrationEngine:
    """减排目标校准引擎。"""

    def __init__(self, tolerance_rate=0.05, missing_threshold=2):
        if tolerance_rate < 0:
            raise ValidationError("容忍带 tolerance_rate 不能为负: %r" % tolerance_rate)
        if not isinstance(missing_threshold, int) or missing_threshold < 1:
            raise ValidationError("missing_threshold 必须是 >= 1 的整数")
        self.tolerance_rate = float(tolerance_rate)
        self.missing_threshold = missing_threshold
        self._parks = {}          # park_id -> Park，保持注册顺序
        self._clock = 0           # 逻辑时钟：每次有效变更 +1

    # ------------------------------------------------------------------
    # 1. 园区与阶段目标维护
    # ------------------------------------------------------------------

    def register_park(self, park_id, baseline, stages):
        """注册园区。stages 为 dict 列表：
        [{"stage_id": "S1", "start": "2026Q1", "end": "2026Q2", "allowance": 200.0}, ...]
        阶段区间必须连续且不重叠，非法配置抛出带位置信息的 ValidationError。
        """
        if not isinstance(park_id, str) or not park_id.strip():
            raise ValidationError("园区标识必须是非空字符串: %r" % (park_id,))
        if park_id in self._parks:
            raise ValidationError("园区标识重复: %r" % park_id)
        if not isinstance(baseline, (int, float)) or isinstance(baseline, bool) or baseline < 0:
            raise ValidationError("园区 %r 基准年排放量必须是非负数值: %r" % (park_id, baseline))
        stage_objs = self._validate_stages(park_id, stages)
        self._parks[park_id] = Park(
            park_id=park_id, baseline=float(baseline), stages=stage_objs)
        self._clock += 1
        return park_id

    @staticmethod
    def _validate_stages(park_id, stages):
        if not isinstance(stages, (list, tuple)) or not stages:
            raise ValidationError("园区 %r 至少需要一个阶段目标" % park_id)
        objs = []
        seen_ids = set()
        for i, raw in enumerate(stages):
            where = "园区 %r 第 %d 个阶段" % (park_id, i + 1)
            if not isinstance(raw, dict):
                raise ValidationError("%s 不是对象: %r" % (where, raw))
            for key in ("stage_id", "start", "end", "allowance"):
                if key not in raw:
                    raise ValidationError("%s 缺少字段 %r" % (where, key))
            sid = raw["stage_id"]
            if not isinstance(sid, str) or not sid.strip():
                raise ValidationError("%s 的 stage_id 必须是非空字符串: %r" % (where, sid))
            if sid in seen_ids:
                raise ValidationError("%s 的 stage_id 重复: %r" % (where, sid))
            seen_ids.add(sid)
            start = parse_quarter(raw["start"])
            end = parse_quarter(raw["end"])
            if start > end:
                raise ValidationError(
                    "%s（%s）起始季度 %s 晚于结束季度 %s"
                    % (where, sid, format_quarter(start), format_quarter(end)))
            allowance = raw["allowance"]
            if not isinstance(allowance, (int, float)) or isinstance(allowance, bool) \
                    or allowance <= 0:
                raise ValidationError(
                    "%s（%s）的允许排放量必须是正数: %r" % (where, sid, allowance))
            objs.append(Stage(sid, start, end, float(allowance), float(allowance)))

        objs.sort(key=lambda s: s.start)
        for prev, cur in zip(objs, objs[1:]):
            if cur.start <= prev.end:
                raise ValidationError(
                    "园区 %r 阶段区间重叠：阶段 %r 起始 %s 早于或等于前一阶段 %r 的结束 %s"
                    % (park_id, cur.stage_id, format_quarter(cur.start),
                       prev.stage_id, format_quarter(prev.end)))
            if cur.start != prev.end + 1:
                raise ValidationError(
                    "园区 %r 阶段区间不连续：阶段 %r 结束于 %s，阶段 %r 起始于 %s，"
                    "中间缺失 %s"
                    % (park_id, prev.stage_id, format_quarter(prev.end),
                       cur.stage_id, format_quarter(cur.start),
                       format_quarter(prev.end + 1)))
        return objs

    # ------------------------------------------------------------------
    # 2. 实绩上报（幂等）与冲突检测
    # ------------------------------------------------------------------

    def report(self, park_id, quarter, value, source="default"):
        """上报某园区某季度实际排放。

        * 同一来源对同一季度重复上报相同数值 → 幂等，返回 "duplicate"，状态不变。
        * 同一来源上报不同数值 → 视为更正，返回 "correction"。
        * 不同来源数值不一致 → 双方保留并生成冲突记录，该季度不计入累计实绩。
        """
        park = self._get_park(park_id)
        q = parse_quarter(quarter)
        if q < park.horizon_start or q > park.horizon_end:
            raise ValidationError(
                "园区 %r 实绩季度 %s 超出目标区间 [%s, %s]"
                % (park_id, format_quarter(q),
                   format_quarter(park.horizon_start), format_quarter(park.horizon_end)))
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            raise ValidationError(
                "园区 %r 季度 %s 的实绩必须是非负数值: %r"
                % (park_id, format_quarter(q), value))
        if not isinstance(source, str) or not source.strip():
            raise ValidationError("上报来源必须是非空字符串: %r" % (source,))
        source = source.strip()
        value = float(value)

        slot = park.reports.setdefault(q, {})
        if source in slot:
            if slot[source] == value:
                return {"result": "duplicate", "park_id": park_id,
                        "quarter": format_quarter(q), "source": source}
            slot[source] = value
            result = "correction"
        else:
            slot[source] = value
            result = "accepted"
        self._clock += 1
        conflict = self._sync_conflict(park, q)
        out = {"result": result, "park_id": park_id,
               "quarter": format_quarter(q), "source": source}
        if conflict is not None:
            out["conflict"] = conflict
        return out

    def _sync_conflict(self, park, q):
        """根据该季度当前各来源数值刷新冲突记录；返回当前活跃冲突（若有）。"""
        values = park.reports.get(q, {})
        distinct = set(values.values())
        record = None
        for rec in park.conflicts:
            if rec["quarter_index"] == q and rec["active"]:
                record = rec
                break
        if len(distinct) > 1:
            if record is None:
                record = {
                    "park_id": park.park_id,
                    "quarter_index": q,
                    "quarter": format_quarter(q),
                    "values": {},
                    "active": True,
                    "detected_clock": self._clock,
                    "resolved_clock": None,
                }
                park.conflicts.append(record)
            record["values"] = dict(sorted(values.items()))
            return self._public_conflict(record)
        if record is not None:
            # 解除冲突：保留冲突时双方来源与各自数值的快照，仅标记状态与时刻
            record["active"] = False
            record["resolved_clock"] = self._clock
        return None

    @staticmethod
    def _public_conflict(rec):
        return {
            "park_id": rec["park_id"],
            "quarter": rec["quarter"],
            "values": dict(rec["values"]),
            "active": rec["active"],
            "detected_clock": rec["detected_clock"],
            "resolved_clock": rec["resolved_clock"],
        }

    # ------------------------------------------------------------------
    # 3. 偏差计算与归因
    # ------------------------------------------------------------------

    def _effective_value(self, park, q):
        """该季度用于累计的有效值：无冲突时返回数值，未决冲突返回 None。"""
        values = park.reports.get(q)
        if not values:
            return None
        if len(set(values.values())) > 1:
            return None
        return next(iter(values.values()))

    def _cum_target(self, park, q):
        return sum(st.target_up_to(q) for st in park.stages)

    def status(self, park_id, as_of=None):
        """查询园区截至 as_of 季度的完整状态（默认取最近有上报的季度）。"""
        park = self._get_park(park_id)
        if as_of is None:
            as_of = max(park.reports) if park.reports else park.horizon_start
        q = parse_quarter(as_of)
        if q < park.horizon_start:
            raise ValidationError(
                "查询季度 %s 早于园区 %r 目标起点 %s"
                % (format_quarter(q), park_id, format_quarter(park.horizon_start)))

        quarters = _quarter_range(park.horizon_start, min(q, park.horizon_end))
        missing, conflicted, actuals = [], [], {}
        for t in quarters:
            if t not in park.reports:
                missing.append(t)
                continue
            val = self._effective_value(park, t)
            if val is None:
                conflicted.append(t)
            else:
                actuals[t] = val

        cum_actual = sum(actuals.values())
        cum_target = self._cum_target(park, q)
        deviation = cum_actual - cum_target
        if cum_target > 0:
            deviation_rate = deviation / cum_target
        else:
            deviation_rate = None

        # 尾部连续未上报（未上报才算缺失；冲突季度有上报，不算缺失）
        tail_missing = 0
        t = min(q, park.horizon_end)
        while t >= park.horizon_start and t not in park.reports:
            tail_missing += 1
            t -= 1

        if tail_missing >= self.missing_threshold:
            state = "data_missing"
        elif deviation_rate is not None and deviation_rate > self.tolerance_rate:
            state = "deviated"
        else:
            state = "on_track"

        return {
            "park_id": park_id,
            "as_of": format_quarter(q),
            "baseline": park.baseline,
            "state": state,
            "cum_actual": cum_actual,
            "cum_target": cum_target,
            "deviation": deviation,
            "deviation_rate": deviation_rate,
            "tolerance_rate": self.tolerance_rate,
            "data_complete": not missing and not conflicted,
            "missing_quarters": [format_quarter(t) for t in missing],
            "conflict_quarters": [format_quarter(t) for t in conflicted],
            "tail_missing_count": tail_missing,
            "stages": [st.to_dict() for st in park.stages],
            "attribution": self._attribute(park, q, actuals),
        }

    def _attribute(self, park, q, actuals):
        """把偏差归因到具体阶段与季度：指出是哪一段累计超出导致。"""
        entries = []
        for st in park.stages:
            if st.start > q:
                continue
            seg_end = min(st.end, q)
            seg_target = st.target_up_to(q)
            seg_quarters = _quarter_range(st.start, seg_end)
            per_quarter = []
            seg_actual = 0.0
            share = st.allowance / st.n_quarters
            for t in seg_quarters:
                val = actuals.get(t)
                if val is None:
                    per_quarter.append({
                        "quarter": format_quarter(t),
                        "actual": None,
                        "target_share": share,
                        "excess": None,
                        "note": "missing" if t not in park.reports else "conflict",
                    })
                else:
                    seg_actual += val
                    per_quarter.append({
                        "quarter": format_quarter(t),
                        "actual": val,
                        "target_share": share,
                        "excess": val - share,
                        "note": None,
                    })
            excess = seg_actual - seg_target
            entries.append({
                "stage_id": st.stage_id,
                "start": format_quarter(st.start),
                "end": format_quarter(st.end),
                "target_to_date": seg_target,
                "actual_to_date": seg_actual,
                "excess": excess,
                "is_contributor": excess > _EPS,
                "quarters": per_quarter,
            })
        return entries

    # ------------------------------------------------------------------
    # 4. 目标调整（总量守恒）
    # ------------------------------------------------------------------

    def adjust(self, park_id, strategy="even", weights=None, as_of=None):
        """园区处于偏离状态时，把已结束阶段结算出的超出量摊回给更靠后的阶段。

        口径：
        * 已结束阶段（end <= as_of）按实绩结算：额度追认为该阶段实际排放量；
        * 当前阶段（as_of 之后第一个尚未结束的阶段）额度保持不变；
        * 结算出的超出量由当前阶段之后的剩余阶段共同承担：
          - "even"：按剩余阶段数均摊；
          - "weighted"：按 weights={stage_id: 权重} 分配（权重为零的阶段不参与），
            缺省按各阶段额度比例；
        * 调整后所有阶段额度之和与原总目标严格相等（追认与核减相互抵消）。
        """
        park = self._get_park(park_id)
        st = self.status(park_id, as_of=as_of)
        if st["state"] != "deviated":
            raise StateError(
                "园区 %r 当前状态为 %s，未处于偏离状态，不能调整目标"
                % (park_id, st["state"]))
        if not st["data_complete"]:
            raise StateError(
                "园区 %r 存在缺失或未决冲突季度（缺失: %s，冲突: %s），"
                "数据不完整，不能调整目标"
                % (park_id, st["missing_quarters"], st["conflict_quarters"]))
        q = parse_quarter(st["as_of"])

        settled = [s for s in park.stages if s.end <= q]
        current = next((s for s in park.stages if s.end > q), None)
        remaining = ([s for s in park.stages if s.start > current.start]
                     if current is not None else [])
        if current is None or not remaining:
            raise StateError(
                "园区 %r 当前阶段之后没有剩余阶段可摊回" % park_id)

        # 已结束阶段按实绩结算，得出待摊回的超出量
        actual_by_stage = {}
        for s in settled:
            total = 0.0
            for t in range(s.start, s.end + 1):
                val = self._effective_value(park, t)
                if val is not None:
                    total += val
            actual_by_stage[s.stage_id] = total
        excess = sum(actual_by_stage[s.stage_id] - s.allowance for s in settled)
        if excess <= _EPS:
            raise StateError(
                "园区 %r 已结束阶段累计未超出（超出发生在当前未结束阶段 %r），"
                "待该阶段结束后才能摊回"
                % (park_id, current.stage_id))

        if strategy == "even":
            shares = {s.stage_id: 1.0 for s in remaining}
        elif strategy == "weighted":
            if weights is None:
                shares = {s.stage_id: s.allowance for s in remaining}
            else:
                if not isinstance(weights, dict):
                    raise ValidationError("weights 必须是 {stage_id: 权重} 的字典")
                remaining_ids = {s.stage_id for s in remaining}
                unknown = set(weights) - remaining_ids
                if unknown:
                    raise ValidationError(
                        "权重包含不属于后续阶段的阶段: %s" % sorted(unknown))
                shares = {}
                for s in remaining:
                    if s.stage_id not in weights:
                        raise ValidationError(
                            "后续阶段 %r 缺少权重" % s.stage_id)
                    w = weights[s.stage_id]
                    if not isinstance(w, (int, float)) or isinstance(w, bool) or w < 0:
                        raise ValidationError(
                            "后续阶段 %r 的权重必须是非负数值: %r" % (s.stage_id, w))
                    shares[s.stage_id] = float(w)
                if sum(shares.values()) <= 0:
                    raise ValidationError("后续阶段权重之和必须为正")
        else:
            raise ValidationError(
                "未知的调整策略 %r，支持 'even' 或 'weighted'" % (strategy,))

        deductions = self._allocate_deduction(
            {s.stage_id: s.allowance for s in remaining}, shares, excess)

        before = {s.stage_id: s.allowance for s in park.stages}
        for s in settled:
            s.allowance = actual_by_stage[s.stage_id]
        for s in remaining:
            s.allowance -= deductions[s.stage_id]

        # 浮点守恒修正：把残差补到额度最大的剩余阶段，保证总量严格不变
        total_original = sum(s.original_allowance for s in park.stages)
        drift = total_original - sum(s.allowance for s in park.stages)
        if abs(drift) > 0:
            anchor = max(remaining, key=lambda s: s.allowance)
            anchor.allowance += drift

        self._clock += 1
        record = {
            "seq": len(park.adjustments) + 1,
            "clock": self._clock,
            "park_id": park_id,
            "strategy": strategy,
            "as_of": format_quarter(q),
            "excess": excess,
            "settled_stages": [s.stage_id for s in settled],
            "current_stage": current.stage_id,
            "changes": {
                s.stage_id: {"before": before[s.stage_id], "after": s.allowance}
                for s in park.stages
                if abs(before[s.stage_id] - s.allowance) > 0
            },
            "total_allowance": sum(s.allowance for s in park.stages),
        }
        park.adjustments.append(record)
        return record

    @staticmethod
    def _allocate_deduction(allowances, shares, amount):
        """把 amount 按 shares 比例从各阶段额度中扣除，不允许出现负额度；
        权重为零的阶段不参与分配；某阶段扣到 0 后，剩余部分在其余参与
        阶段间继续按比例分摊。"""
        active = {sid for sid in allowances if shares.get(sid, 0.0) > 0}
        absorbable = sum(allowances[sid] for sid in active)
        if absorbable < amount - 1e-6:
            raise StateError(
                "参与分配的后续阶段额度之和 %.6f 不足以吸收超出量 %.6f"
                % (absorbable, amount))
        ded = {sid: 0.0 for sid in allowances}
        leftover = amount
        while leftover > 1e-9 and active:
            tot_share = sum(shares[s] for s in active)
            batch = leftover  # 本趟按份额一次性分配，趟内不再递减
            progressed = False
            for sid in sorted(active):
                want = batch * shares[sid] / tot_share
                room = allowances[sid] - ded[sid]
                take = min(want, room)
                if take > 0:
                    ded[sid] += take
                    leftover -= take
                    progressed = True
                if allowances[sid] - ded[sid] <= 1e-9:
                    active.discard(sid)
            if not progressed:
                break
        if leftover > 1e-6:
            raise StateError(
                "后续阶段额度不足以吸收超出量，仍有 %.6f 无法分摊" % leftover)
        return ded

    # ------------------------------------------------------------------
    # 7. 查询
    # ------------------------------------------------------------------

    def targets(self, park_id):
        """园区各阶段目标（含调整后额度与原始额度）。"""
        return [st.to_dict() for st in self._get_park(park_id).stages]

    def adjustment_history(self, park_id):
        return [dict(rec, changes={k: dict(v) for k, v in rec["changes"].items()})
                for rec in self._get_park(park_id).adjustments]

    def conflicts(self, park_id, active_only=False):
        recs = [self._public_conflict(r) for r in self._get_park(park_id).conflicts]
        if active_only:
            recs = [r for r in recs if r["active"]]
        return recs

    def parks(self):
        return list(self._parks)

    @property
    def clock(self):
        return self._clock

    def _get_park(self, park_id):
        try:
            return self._parks[park_id]
        except KeyError:
            raise ValidationError("园区不存在: %r" % (park_id,)) from None

    # ------------------------------------------------------------------
    # 7. 持久化：导出 / 导入（校验失败则报错且状态不变）
    # ------------------------------------------------------------------

    def export_json(self, path):
        """把园区、目标、实绩、调整记录和逻辑时钟写成 JSON 文件。"""
        data = {
            "version": SCHEMA_VERSION,
            "clock": self._clock,
            "config": {
                "tolerance_rate": self.tolerance_rate,
                "missing_threshold": self.missing_threshold,
            },
            "parks": [self._park_to_dict(p) for p in self._parks.values()],
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
        return path

    @staticmethod
    def _park_to_dict(park):
        reports = []
        for q in sorted(park.reports):
            for source in sorted(park.reports[q]):
                reports.append({
                    "quarter": format_quarter(q),
                    "source": source,
                    "value": park.reports[q][source],
                })
        return {
            "park_id": park.park_id,
            "baseline": park.baseline,
            "stages": [st.to_dict() for st in park.stages],
            "reports": reports,
            "adjustments": [
                dict(rec, changes={k: dict(v) for k, v in rec["changes"].items()})
                for rec in park.adjustments
            ],
            "conflicts": [
                {k: (dict(v) if k == "values" else v) for k, v in rec.items()}
                for rec in park.conflicts
            ],
        }

    @classmethod
    def import_json(cls, path):
        """从 JSON 文件载入并全面校验；任何损坏都抛出带位置信息的 ValidationError。"""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise ValidationError("导入文件不存在: %s" % path) from None
        except json.JSONDecodeError as exc:
            raise ValidationError(
                "导入文件不是合法 JSON（第 %d 行第 %d 列: %s）"
                % (exc.lineno, exc.colno, exc.msg)) from None
        except UnicodeDecodeError as exc:
            raise ValidationError("导入文件编码不是 UTF-8: %s" % exc) from None

        if not isinstance(data, dict):
            raise ValidationError("导入文件顶层必须是 JSON 对象")
        for key in ("version", "clock", "config", "parks"):
            if key not in data:
                raise ValidationError("导入文件缺少顶层字段 %r" % key)
        if data["version"] != SCHEMA_VERSION:
            raise ValidationError(
                "不支持的数据版本 %r（当前支持 %r）" % (data["version"], SCHEMA_VERSION))
        if not isinstance(data["clock"], int) or data["clock"] < 0:
            raise ValidationError("逻辑时钟 clock 必须是非负整数: %r" % (data["clock"],))
        cfg = data["config"]
        if not isinstance(cfg, dict):
            raise ValidationError("config 必须是对象")
        engine = cls(
            tolerance_rate=cfg.get("tolerance_rate", 0.05),
            missing_threshold=cfg.get("missing_threshold", 2),
        )
        if not isinstance(data["parks"], list):
            raise ValidationError("parks 必须是数组")
        for i, raw_park in enumerate(data["parks"]):
            engine._load_park(raw_park, i)
        engine._clock = data["clock"]
        return engine

    def load_json(self, path):
        """载入并替换当前引擎状态；校验失败时抛错且当前状态保持不变。"""
        other = self.import_json(path)  # 先在临时实例上完成全部校验
        self.tolerance_rate = other.tolerance_rate
        self.missing_threshold = other.missing_threshold
        self._parks = other._parks
        self._clock = other._clock
        return self

    def _load_park(self, raw, index):
        where = "parks[%d]" % index
        if not isinstance(raw, dict):
            raise ValidationError("%s 必须是对象" % where)
        for key in ("park_id", "baseline", "stages", "reports", "adjustments",
                    "conflicts"):
            if key not in raw:
                raise ValidationError("%s 缺少字段 %r" % (where, key))
        park_id = raw["park_id"]
        if not isinstance(park_id, str) or not park_id.strip():
            raise ValidationError("%s 的 park_id 非法: %r" % (where, park_id))
        if park_id in self._parks:
            raise ValidationError("导入数据中园区标识重复: %r" % park_id)

        stages_raw = raw["stages"]
        if not isinstance(stages_raw, list):
            raise ValidationError("园区 %r 的 stages 必须是数组" % park_id)
        # 先用原始额度做完整阶段校验（连续性、不重叠、合法季度）
        originals = []
        for j, s in enumerate(stages_raw):
            swhere = "园区 %r 第 %d 个阶段" % (park_id, j + 1)
            if not isinstance(s, dict):
                raise ValidationError("%s 不是对象: %r" % (swhere, s))
            for key in ("stage_id", "start", "end", "allowance", "original_allowance"):
                if key not in s:
                    raise ValidationError("%s 缺少字段 %r" % (swhere, key))
            originals.append({
                "stage_id": s["stage_id"],
                "start": s["start"],
                "end": s["end"],
                "allowance": s["original_allowance"],
            })
        stage_objs = self._validate_stages(park_id, originals)

        # 再校验当前额度：非负、总量守恒（按 stage_id 对应，与文件内顺序无关）
        raw_by_id = {s["stage_id"]: s for s in stages_raw}
        total_original = sum(s.original_allowance for s in stage_objs)
        total_current = 0.0
        for obj in stage_objs:
            cur = raw_by_id[obj.stage_id]["allowance"]
            if not isinstance(cur, (int, float)) or isinstance(cur, bool) or cur < 0:
                raise ValidationError(
                    "园区 %r 阶段 %r 的当前额度必须是非负数值: %r"
                    % (park_id, obj.stage_id, cur))
            obj.allowance = float(cur)
            total_current += cur
        if abs(total_current - total_original) > 1e-6 * max(1.0, total_original):
            raise ValidationError(
                "园区 %r 调整后总量不守恒：当前阶段额度之和 %.6f，"
                "原总目标 %.6f" % (park_id, total_current, total_original))

        park = Park(park_id=park_id, baseline=self._load_baseline(raw, park_id),
                    stages=stage_objs)

        reports = raw["reports"]
        if not isinstance(reports, list):
            raise ValidationError("园区 %r 的 reports 必须是数组" % park_id)
        for k, rep in enumerate(reports):
            rwhere = "园区 %r 第 %d 条实绩" % (park_id, k + 1)
            if not isinstance(rep, dict):
                raise ValidationError("%s 不是对象: %r" % (rwhere, rep))
            for key in ("quarter", "source", "value"):
                if key not in rep:
                    raise ValidationError("%s 缺少字段 %r" % (rwhere, key))
            q = parse_quarter(rep["quarter"])
            if q < park.horizon_start or q > park.horizon_end:
                raise ValidationError(
                    "%s 的季度 %s 超出目标区间 [%s, %s]"
                    % (rwhere, format_quarter(q),
                       format_quarter(park.horizon_start),
                       format_quarter(park.horizon_end)))
            source = rep["source"]
            if not isinstance(source, str) or not source.strip():
                raise ValidationError("%s 的来源非法: %r" % (rwhere, source))
            value = rep["value"]
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise ValidationError("%s 的数值必须是非负数值: %r" % (rwhere, value))
            slot = park.reports.setdefault(q, {})
            if source in slot:
                raise ValidationError(
                    "%s 与之前条目重复（季度 %s 来源 %r）"
                    % (rwhere, format_quarter(q), source))
            slot[source] = float(value)
        # 冲突记录：按文件原样恢复（双方来源、各自数值、逻辑时钟逐项保留），
        # 并与实绩数据交叉校验，不一致即拒绝
        conflicts_raw = raw["conflicts"]
        if not isinstance(conflicts_raw, list):
            raise ValidationError("园区 %r 的 conflicts 必须是数组" % park_id)
        active_quarters = set()
        for k, rec in enumerate(conflicts_raw):
            cwhere = "园区 %r 第 %d 条冲突记录" % (park_id, k + 1)
            if not isinstance(rec, dict):
                raise ValidationError("%s 不是对象: %r" % (cwhere, rec))
            for key in ("quarter_index", "quarter", "values", "active",
                        "detected_clock", "resolved_clock"):
                if key not in rec:
                    raise ValidationError("%s 缺少字段 %r" % (cwhere, key))
            qi = rec["quarter_index"]
            if not isinstance(qi, int) or isinstance(qi, bool) or qi < 0:
                raise ValidationError("%s 的 quarter_index 非法: %r" % (cwhere, qi))
            if rec["quarter"] != format_quarter(qi):
                raise ValidationError(
                    "%s 的季度标注 %r 与 quarter_index 不一致"
                    % (cwhere, rec["quarter"]))
            values = rec["values"]
            if not isinstance(values, dict) or len(values) < 2:
                raise ValidationError("%s 的 values 必须包含至少两个来源" % cwhere)
            for src, v in values.items():
                if not isinstance(src, str) or not src.strip() \
                        or not isinstance(v, (int, float)) or isinstance(v, bool):
                    raise ValidationError("%s 的来源或数值非法" % cwhere)
            if len(set(values.values())) < 2:
                raise ValidationError("%s 的各来源数值一致，不构成冲突" % cwhere)
            if not isinstance(rec["detected_clock"], int) \
                    or isinstance(rec["detected_clock"], bool) \
                    or rec["detected_clock"] < 0:
                raise ValidationError("%s 的 detected_clock 非法" % cwhere)
            if rec["resolved_clock"] is not None and (
                    not isinstance(rec["resolved_clock"], int)
                    or isinstance(rec["resolved_clock"], bool)):
                raise ValidationError("%s 的 resolved_clock 非法" % cwhere)
            active = bool(rec["active"])
            if active != (rec["resolved_clock"] is None):
                raise ValidationError(
                    "%s 的 active 标记与 resolved_clock 矛盾" % cwhere)
            slot = park.reports.get(qi)
            if slot is None:
                raise ValidationError(
                    "%s 指向的季度 %s 没有对应实绩" % (cwhere, format_quarter(qi)))
            if not set(values).issubset(set(slot)):
                raise ValidationError("%s 的来源与实绩数据不一致" % cwhere)
            if active:
                if qi in active_quarters:
                    raise ValidationError(
                        "园区 %r 季度 %s 存在多条活跃冲突记录"
                        % (park_id, format_quarter(qi)))
                active_quarters.add(qi)
                if any(abs(slot[s] - values[s]) > 1e-9 for s in values) \
                        or len(set(slot.values())) < 2:
                    raise ValidationError("%s 与当前实绩数据不一致" % cwhere)
            park.conflicts.append({
                "park_id": park_id,
                "quarter_index": qi,
                "quarter": format_quarter(qi),
                "values": {s: float(v) for s, v in sorted(values.items())},
                "active": active,
                "detected_clock": rec["detected_clock"],
                "resolved_clock": rec["resolved_clock"],
            })
        # 每个实绩矛盾的季度必须恰好有一条活跃冲突记录
        for t, slot in park.reports.items():
            if len(set(slot.values())) > 1 and t not in active_quarters:
                raise ValidationError(
                    "园区 %r 季度 %s 实绩存在矛盾但缺少活跃冲突记录"
                    % (park_id, format_quarter(t)))

        adjustments = raw["adjustments"]
        if not isinstance(adjustments, list):
            raise ValidationError("园区 %r 的 adjustments 必须是数组" % park_id)
        for k, adj in enumerate(adjustments):
            awhere = "园区 %r 第 %d 条调整记录" % (park_id, k + 1)
            if not isinstance(adj, dict):
                raise ValidationError("%s 不是对象: %r" % (awhere, adj))
            for key in ("seq", "clock", "strategy", "as_of", "excess",
                        "settled_stages", "current_stage", "changes"):
                if key not in adj:
                    raise ValidationError("%s 缺少字段 %r" % (awhere, key))
            parse_quarter(adj["as_of"])
            park.adjustments.append(dict(
                adj, changes={kk: dict(vv) for kk, vv in adj["changes"].items()}))

        self._parks[park_id] = park

    @staticmethod
    def _load_baseline(raw, park_id):
        baseline = raw["baseline"]
        if not isinstance(baseline, (int, float)) or isinstance(baseline, bool) \
                or baseline < 0:
            raise ValidationError(
                "园区 %r 基准年排放量必须是非负数值: %r" % (park_id, baseline))
        return float(baseline)
