"""事件-指标关联强度与候选原因排序，支持用户调整与变更历史。"""
from __future__ import annotations

from datetime import datetime
import math
import pandas as pd


def _daterange_set(row) -> set:
    return set(pd.date_range(row["date"], row["end_date"], freq="D"))


class AttributionEngine:
    """对异常区段计算候选原因；调整仅重算目标区段，其余区段结果缓存不变。"""

    def __init__(self, series: dict, events: pd.DataFrame, segments: list):
        self.series = series
        self.events = events
        self.segments = {s["id"]: dict(s) for s in segments}
        self.adjustments: dict[str, dict] = {sid: {} for sid in self.segments}
        self.history: dict[str, list] = {sid: [] for sid in self.segments}
        self._rank_cache: dict[str, list] = {}
        self.strengths = self._compute_strengths()

    def _compute_strengths(self) -> dict:
        """历史关联强度：事件活跃日的指标偏离均值 vs 非活跃日。"""
        result = {}
        if self.events.empty:
            return result
        for etype, eg in self.events.groupby("event_type"):
            active = set()
            for _, row in eg.iterrows():
                active |= _daterange_set(row)
            for metric, df in self.series.items():
                mask = df.index.isin(active)
                n_days = int(mask.sum())
                if n_days == 0:
                    strength = 0.0
                else:
                    on = df.loc[mask, "pct_dev"].mean()
                    off = df.loc[~mask, "pct_dev"].mean()
                    strength = float(on - off)
                result[f"{etype}|{metric}"] = {
                    "event_type": etype, "metric": metric,
                    "strength": round(strength, 4),
                    "n_events": int(len(eg)), "n_days": n_days,
                }
        return result

    def _segment_events(self, seg: dict) -> pd.DataFrame:
        start = pd.Timestamp(seg["start"]) - pd.Timedelta(days=2)
        end = pd.Timestamp(seg["end"]) + pd.Timedelta(days=2)
        ev = self.events
        return ev[(ev["date"] <= end) & (ev["end_date"] >= start)]

    def rank(self, seg_id: str) -> list:
        if seg_id in self._rank_cache:
            return self._rank_cache[seg_id]
        seg = self.segments[seg_id]
        metric = seg["metric"]
        seg_start, seg_end = pd.Timestamp(seg["start"]), pd.Timestamp(seg["end"])
        seg_days = max((seg_end - seg_start).days + 1, 1)
        adj = self.adjustments[seg_id]
        cands = []
        for _, ev in self._segment_events(seg).iterrows():
            key = str(ev["event_id"])
            st = self.strengths.get(f"{ev['event_type']}|{metric}",
                                    {"strength": 0.0, "n_events": 0})
            strength, n_events = st["strength"], st["n_events"]
            overlap = len(_daterange_set(ev) & set(pd.date_range(seg_start, seg_end)))
            overlap_ratio = overlap / seg_days
            metric_factor = 1.0
            if ev["metric"]:
                metric_factor = 1.3 if ev["metric"] == metric else 0.3
            weight = adj.get(key, {}).get("weight", 1.0)
            raw = abs(strength) * (0.4 + 0.6 * overlap_ratio) * metric_factor * weight
            flags = []
            if n_events < 2:
                flags.append("证据不足：该类型事件历史样本不足 2 次")
            seg_sign = 1 if seg["direction"] == "up" else -1
            if strength * seg_sign < -0.02:
                flags.append("相互矛盾：历史上该事件与该指标反向波动")
            if ev["direction"] in ("up", "down") and ev["direction"] != seg["direction"]:
                flags.append("相互矛盾：事件登记的影响方向与区段方向相反")
            if seg["covers_missing"]:
                flags.append("区段覆盖缺失数据，起止与偏离度为估计值")
            cands.append({
                "event_id": key, "event_type": ev["event_type"],
                "description": ev["description"],
                "date": ev["date"].strftime("%Y-%m-%d"),
                "end_date": ev["end_date"].strftime("%Y-%m-%d"),
                "strength": strength, "n_events": n_events,
                "overlap_days": int(overlap), "weight": weight,
                "raw": raw, "flags": flags,
                "status": adj.get(key, {}).get("action", "pending"),
            })
        active = [c for c in cands if c["status"] != "excluded"]
        total = sum(c["raw"] for c in active) or 1.0
        for c in active:
            c["score"] = round(100 * c["raw"] / total, 1)
        active.sort(key=lambda c: (c["status"] != "confirmed", -c["score"]))
        excluded = [c for c in cands if c["status"] == "excluded"]
        result = {"active": active, "excluded": excluded}
        self._rank_cache[seg_id] = result
        return result

    @staticmethod
    def _snapshot(ranking: dict) -> list:
        return [{"event_id": c["event_id"], "event_type": c["event_type"],
                 "score": c.get("score"), "status": c["status"],
                 "weight": c["weight"]} for c in ranking["active"]]

    def adjust(self, seg_id: str, event_id: str, action: str, weight: float | None = None):
        """确认/排除/调权，仅重算目标区段并记录历史。返回 (新排序, 历史条目)。"""
        if seg_id not in self.segments:
            raise KeyError(f"未知区段: {seg_id}")
        if action not in ("confirm", "exclude", "weight", "reset"):
            raise ValueError(f"不支持的操作: {action}")
        before = self._snapshot(self.rank(seg_id))
        adj = self.adjustments[seg_id]
        if action == "reset":
            adj.pop(event_id, None)
            detail = "恢复默认"
        elif action == "weight":
            weight = max(0.0, min(5.0, float(weight)))
            entry = adj.setdefault(event_id, {})
            entry["weight"] = weight
            detail = f"权重调整为 {weight:.2f}"
        else:
            entry = adj.setdefault(event_id, {})
            entry["action"] = action + "ed" if action == "confirm" else "excluded"
            detail = "确认该原因" if action == "confirm" else "排除该原因"
        self._rank_cache.pop(seg_id, None)
        after_ranking = self.rank(seg_id)
        record = {
            "seq": len(self.history[seg_id]) + 1,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "segment_id": seg_id, "event_id": event_id,
            "action": action, "detail": detail,
            "before": before, "after": self._snapshot(after_ranking),
        }
        self.history[seg_id].append(record)
        return after_ranking, record
