"""topk_kernel.py — 可嵌入的流式 Top-K 频繁项检测内核（仅标准库）。

三块能力：

1. 全量 Top-K：经典 Space-Saving 算法，槽位数最多 K，
   每个槽位保存 (key, 估算计数, 误差上界)，表满时淘汰估算计数最小者。
2. 滑动窗口重频检测：窗口长度 ``window_size`` 个逻辑时间单位，
   左闭右开，按 key 精确统计窗口内带权计数。
3. 突增检测：比较"当前窗口"与"紧邻的前一个窗口"的带权计数，
   返回增长率不低于阈值的 key。

另支持：精确模式（``exact=True`` 保存全部 key 的真实计数）、
显式内存上限（``max_memory_bytes``，超限拒绝插入而不是静默丢弃）、
``merge`` 摘要合并、``save``/``load`` JSON 快照与一致性校验。

时间语义（见 README 的完整说明）：
    窗口网格按 ``window_size`` 切分（可由 ``start_ts`` 指定对齐基准），
    key 首次出现时按其 ts 对齐建窗。ts 落在当前窗口左边界之前的记录
    **仍然计入全量 Top-K，但不计入滑动窗口**；ts 跳到更后面的网格时
    窗口整体向前滑动，越过的空窗口 prev 为空。
"""

from __future__ import annotations

import heapq
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

__all__ = [
    "Record",
    "AddResult",
    "TopKEntry",
    "TopKTracker",
    "TopKError",
    "ValidationError",
    "MemoryLimitError",
    "SnapshotError",
    "estimate_record_size",
]

SNAPSHOT_VERSION = 1

# ---------------------------------------------------------------------------
# 内存记账常量（64 位 CPython 的保守近似，宁高勿低）
# ---------------------------------------------------------------------------
_INT_BYTES = 28          # 一个普通 int 对象
_STR_OVERHEAD = 49       # 空 str 对象头
_CHAR_BYTES = 4          # 字符载荷按最宽的 4 字节/字符计
_SLOT_BYTES = 560        # _Slot 实例 + 存活堆条目 + 懒删除堆条目的摊销上限
_WENTRY_BYTES = 44       # 窗口 dict 一个条目的摊销（dict slot + value int）
_EXACT_ENTRY_BYTES = 60  # 精确 dict 一个条目的摊销（dict slot + value int）
_HEAP_COMPACT_FACTOR = 4


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class TopKError(ValueError):
    """内核可预期错误的基类（非法参数 / 内存上限 / 快照损坏）。"""


class ValidationError(TopKError):
    """记录或参数校验失败。"""


class MemoryLimitError(TopKError):
    """插入会突破 ``max_memory_bytes``，本次操作被整体拒绝，状态不变。"""


class SnapshotError(TopKError):
    """快照损坏、字段缺失或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Record:
    """上游推来的一条观测记录。

    Attributes:
        key: 非空字符串，被观测的标识。
        weight: 正整数，本次贡献的计数，默认 1。
        ts: 非负整数逻辑时间，由调用方注入，方便测试。
    """

    key: str
    weight: int = 1
    ts: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.key, str):
            raise ValidationError("record.key 必须是字符串")
        if not self.key:
            raise ValidationError("record.key 不能为空字符串")
        # bool 是 int 的子类，显式挡掉
        if not isinstance(self.weight, int) or isinstance(self.weight, bool):
            raise ValidationError("record.weight 必须是 int")
        if self.weight <= 0:
            raise ValidationError(f"record.weight 必须是正整数，收到 {self.weight}")
        if not isinstance(self.ts, int) or isinstance(self.ts, bool):
            raise ValidationError("record.ts 必须是 int")
        if self.ts < 0:
            raise ValidationError(f"record.ts 不能为负，收到 {self.ts}")


@dataclass(frozen=True)
class AddResult:
    """``add`` 的返回值。

    Attributes:
        key: 本次插入的 key。
        estimated_count: 插入后该 key 的 Space-Saving 估算计数。
        error_bound: 估算误差上界，满足 真实计数 >= estimated_count - error_bound。
        is_new_slot: 该 key 插入前不在表中（新占槽位或顶替了被淘汰槽位）。
        total_processed: 内核迄今**成功**处理的记录条数（被内存拒绝的不计入）。
        windowed: 该 key 在当前滑动窗口内的精确带权计数（越界记录为 0）。
        in_window: 本次记录的 ts 是否落在当前滑动窗口内。
    """

    key: str
    estimated_count: int
    error_bound: int
    is_new_slot: bool
    total_processed: int
    windowed: int
    in_window: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "estimated_count": self.estimated_count,
            "error_bound": self.error_bound,
            "is_new_slot": self.is_new_slot,
            "total_processed": self.total_processed,
            "windowed": self.windowed,
            "in_window": self.in_window,
        }


@dataclass(frozen=True)
class TopKEntry:
    """Top-K 列表中的一项。"""

    key: str
    estimated_count: int
    error_bound: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "estimated_count": self.estimated_count,
            "error_bound": self.error_bound,
        }


@dataclass(slots=True)
class _Slot:
    """Space-Saving 槽位（可变，配合懒删除堆原地更新）。"""

    key: Optional[str]
    count: int
    error: int
    seq: int = 0  # 最近一次入堆的全局序号，用于识别堆中的过期条目


def estimate_record_size(record: Record) -> int:
    """估算一条 Record 在 64 位 CPython 下的近似驻留字节数。

    与内核的内存记账同口径（保守值），可用于调用方在插入前预判。
    """

    return (
        73  # frozen dataclass 实例基础大小 + 属性引用槽
        + _STR_OVERHEAD
        + _CHAR_BYTES * len(record.key)
        + 2 * _INT_BYTES  # weight、ts
    )


# ---------------------------------------------------------------------------
# 内核
# ---------------------------------------------------------------------------


class TopKTracker:
    """流式 Top-K / 重频 / 突增检测器。

    Args:
        k: Space-Saving 槽位上限，正整数，默认 100。
        window_size: 滑动窗口长度（逻辑时间单位），正整数。
        exact: True 时保存全部 key 的精确计数且永不淘汰，用于对照。
        max_memory_bytes: 内核状态内存上限（字节）。None（或负数）表示不限；
            0 表示不允许任何 key 驻留。超出上限时**拒绝本次插入**并抛出
            :class:`MemoryLimitError`，内核状态完全不变；已有 key 的计数
            更新不需要新内存，永远不会被拒绝。
        start_ts: 窗口网格对齐基准，必须是 window_size 的非负整数倍。
    """

    def __init__(
        self,
        k: int = 100,
        window_size: int = 10,
        exact: bool = False,
        max_memory_bytes: Optional[int] = None,
        start_ts: int = 0,
    ) -> None:
        if not isinstance(k, int) or isinstance(k, bool) or k <= 0:
            raise ValidationError(f"k 必须是正整数，收到 {k!r}")
        if not isinstance(window_size, int) or isinstance(window_size, bool) or window_size <= 0:
            raise ValidationError(
                f"window_size 必须是正整数，收到 {window_size!r}（窗口长度不能为 0）"
            )
        if not isinstance(exact, bool):
            raise ValidationError("exact 必须是 bool")
        if max_memory_bytes is not None:
            if not isinstance(max_memory_bytes, int) or isinstance(max_memory_bytes, bool):
                raise ValidationError("max_memory_bytes 必须是 int 或 None")
            if max_memory_bytes < 0:
                max_memory_bytes = None
        if not isinstance(start_ts, int) or isinstance(start_ts, bool) or start_ts < 0:
            raise ValidationError(f"start_ts 必须是非负整数，收到 {start_ts!r}")
        if (start_ts % window_size) != 0:
            raise ValidationError(
                f"start_ts({start_ts}) 必须是 window_size({window_size}) 的整数倍"
            )

        self.k: int = k
        self.window_size: int = window_size
        self.exact: bool = exact
        self.max_memory_bytes: Optional[int] = max_memory_bytes
        self.alignment: int = start_ts

        # Space-Saving：key -> 槽位；堆元素为 (count, key, seq)。
        # 平局时按 key 升序淘汰，使淘汰次序与 top() 的排序规则一致；
        # seq 是全局递增版本号，用于识别堆中的懒删除过期条目。
        self._slots: Dict[str, _Slot] = {}
        self._heap: List[Tuple[int, str, int]] = []
        self._heap_seq: int = 0

        # 精确模式的全量计数（exact=True 时维护）
        self._exact_counts: Dict[str, int] = {}

        # 滑动窗口：当前桶 + 紧邻的前一桶；窗口尚未建立时 start 为 None
        self._window_start: Optional[int] = None
        self._cur: Dict[str, int] = {}
        self._prev: Dict[str, int] = {}

        # 统计
        self.total_processed: int = 0
        self.total_weight: int = 0
        self.total_evicted: int = 0
        self.rejected_out_of_window: int = 0
        self.rejected_memory: int = 0
        self._mem: int = 0

    # ------------------------------------------------------------------
    # 属性 / 记账小工具
    # ------------------------------------------------------------------

    @property
    def memory_used(self) -> int:
        """内核状态的估算驻留字节数（与 max_memory_bytes 同一口径）。"""

        return self._mem

    @property
    def slot_count(self) -> int:
        """当前 Space-Saving 槽位数。"""

        return len(self._slots)

    @property
    def window_start(self) -> Optional[int]:
        """当前窗口起点；尚未收到任何记录时为 None。"""

        return self._window_start

    @staticmethod
    def _key_bytes(key: str) -> int:
        return _STR_OVERHEAD + _CHAR_BYTES * len(key)

    def _slot_fee(self, key: str) -> int:
        """一个新槽位（含 key 字符串、槽位对象、摊销堆条目）的费用。"""

        return _SLOT_BYTES + self._key_bytes(key)

    def _window_fee(self, key: str) -> int:
        """窗口桶里一个新条目（key 保守重复计）的费用。"""

        return _WENTRY_BYTES + self._key_bytes(key)

    def _can_fit(self, extra: int) -> bool:
        return (
            self.max_memory_bytes is None
            or self._mem + extra <= self.max_memory_bytes
        )

    def _grid_floor(self, ts: int) -> int:
        """ts 向下取整到窗口网格边界（网格相对 alignment 对齐）。"""

        return self.alignment + ((ts - self.alignment) // self.window_size) * self.window_size

    # ------------------------------------------------------------------
    # 插入
    # ------------------------------------------------------------------

    def add(self, record: Record) -> AddResult:
        """插入一条记录并返回 :class:`AddResult`。

        Raises:
            ValidationError: 参数不是合法 Record。
            MemoryLimitError: 插入新 key 需要的内存超过上限，
                本次插入被整体拒绝（统计计数与窗口状态均不变）。
        """

        if not isinstance(record, Record):
            raise ValidationError("add() 需要 Record 实例")

        # 1) 先算窗口决策（纯函数式，不改状态）
        slide = "none"  # none / step / jump
        in_window = True
        if self._window_start is None:
            slide = "init"
        else:
            start = self._window_start
            end = start + self.window_size
            if start <= record.ts < end:
                slide = "none"
            elif record.ts < start:
                slide = "late"
                in_window = False
            elif self._grid_floor(record.ts) == end:
                slide = "step"
            else:
                slide = "jump"

        # 2) 估算本次插入需要的**新增**内存，超限则在任何状态变更前拒绝
        existing_slot = self._slots.get(record.key)
        extra = 0
        if existing_slot is None:
            if self.exact or len(self._slots) < self.k:
                # 新增槽位（精确模式永不淘汰，还要一份精确计数）
                extra += self._slot_fee(record.key)
                if self.exact:
                    extra += _EXACT_ENTRY_BYTES
            else:
                # 表满将走淘汰：槽位对象被复用，净增量只是新旧 key
                # 字符串费用之差（旧 key 被释放）。
                victim = self._peek_min()
                assert victim.key is not None
                extra += max(0, self._key_bytes(record.key) - self._key_bytes(victim.key))
        if in_window:
            cur_after_slide = {} if slide in ("init", "step", "jump") else self._cur
            if record.key not in cur_after_slide:
                extra += self._window_fee(record.key)
        if not self._can_fit(extra):
            self.rejected_memory += 1
            needed_hint = self._mem + extra
            raise MemoryLimitError(
                f"插入新 key {record.key!r} 后预计占用约 {needed_hint} 字节，"
                f"超过上限 {self.max_memory_bytes} 字节；本次插入被拒绝，"
                f"内核状态不变（已在表中的 key 只更新计数，不会被拒绝）"
            )
        # 通过检查后一次性收取本次新增占用（失败时上面已整体拒绝，状态未动）
        self._mem += extra

        # 3) 提交窗口滑动
        if slide == "init":
            self._window_start = self._grid_floor(record.ts)
        elif slide == "step":
            # 旧 prev 桶失效（释放其记账）；cur 整桶变 prev，条目复用、账目不变
            self._mem -= self._window_bytes(self._prev)
            self._prev = self._cur
            self._cur = {}
            self._window_start += self.window_size
        elif slide == "jump":
            # 跨过了一个以上的网格：旧两桶全部失效，退还其内存
            self._mem -= self._window_bytes(self._cur) + self._window_bytes(self._prev)
            self._prev = {}
            self._cur = {}
            self._window_start = self._grid_floor(record.ts)
        elif slide == "late":
            self.rejected_out_of_window += 1

        # 4) Space-Saving 更新
        is_new_slot = existing_slot is None
        if existing_slot is not None:
            existing_slot.count += record.weight
            self._push_slot(existing_slot)
        elif self.exact or len(self._slots) < self.k:
            slot = _Slot(record.key, record.weight, 0)
            self._slots[record.key] = slot
            self._push_slot(slot)
            if self.exact:
                self._exact_counts[record.key] = record.weight
        else:
            victim = self._evict_min()
            assert victim.key is not None
            old_key = victim.key
            old_count = victim.count
            # extra 在预检阶段已按“新旧 key 字符串费用之差的净额”收取，
            # 槽位对象本身被复用，这里不再改动内存账。
            self._slots.pop(old_key, None)
            victim.key = record.key
            victim.count = old_count + record.weight
            victim.error = old_count
            self._slots[record.key] = victim
            self._push_slot(victim)
            self.total_evicted += 1

        # 5) 窗口计数（新条目费用已包含在 extra 中）
        if in_window:
            self._cur[record.key] = self._cur.get(record.key, 0) + record.weight

        # 6) 精确模式下槽位计数与精确计数同步
        if self.exact and existing_slot is not None:
            self._exact_counts[record.key] += record.weight

        # 7) 统计
        self.total_processed += 1
        self.total_weight += record.weight

        # 8) 懒删除堆过大时压缩，保证真实堆内存有界（O(K) 而非 O(记录数)）
        if len(self._heap) > max(_HEAP_COMPACT_FACTOR * max(len(self._slots), 1), 64):
            self._rebuild_heap()

        slot = self._slots[record.key]
        return AddResult(
            key=record.key,
            estimated_count=slot.count,
            error_bound=slot.error,
            is_new_slot=is_new_slot,
            total_processed=self.total_processed,
            windowed=self._cur.get(record.key, 0),
            in_window=in_window,
        )

    def _push_slot(self, slot: _Slot) -> None:
        self._heap_seq += 1
        slot.seq = self._heap_seq
        heapq.heappush(self._heap, (slot.count, slot.key, slot.seq))  # type: ignore[arg-type]

    def _rebuild_heap(self) -> None:
        self._heap = [
            (s.count, s.key, s.seq) for s in self._slots.values()  # type: ignore[arg-type]
        ]
        heapq.heapify(self._heap)

    def _evict_min(self) -> _Slot:
        """弹出堆顶存活槽位（顺带丢弃懒删除的过期条目）。"""

        while self._heap:
            count, key, seq = heapq.heappop(self._heap)
            slot = self._slots.get(key)  # type: ignore[arg-type]
            if slot is not None and count == slot.count and seq == slot.seq:
                return slot
        raise RuntimeError("Space-Saving 堆状态损坏：表中无存活槽位可淘汰")

    def _peek_min(self) -> _Slot:
        """返回（不弹出）堆顶存活槽位，用于插入前的内存预判。

        会顺带清理堆顶的懒删除过期条目；调用点与随后的 :meth:`_evict_min`
        之间没有其他状态变更，两者看到的最小槽位一致。
        """

        while self._heap:
            count, key, seq = self._heap[0]
            slot = self._slots.get(key)  # type: ignore[arg-type]
            if slot is not None and count == slot.count and seq == slot.seq:
                return slot
            heapq.heappop(self._heap)
        raise RuntimeError("Space-Saving 堆状态损坏：表满但找不到最小槽位")

    def _window_bytes(self, bucket: Dict[str, int]) -> int:
        return sum(self._window_fee(key) for key in bucket)

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def top(self, k: Optional[int] = None) -> List[TopKEntry]:
        """返回估算计数最高的前 k 项。

        排序：估算计数降序，相同计数按 key 字典序升序。
        k 缺省使用构造时的 K；槽位不足时返回全部。
        """

        if k is None:
            k = self.k
        if not isinstance(k, int) or isinstance(k, bool) or k <= 0:
            raise ValidationError(f"top(k) 的 k 必须是正整数，收到 {k!r}")
        ordered = sorted(self._slots.values(), key=lambda s: (-s.count, s.key))
        return [TopKEntry(s.key, s.count, s.error) for s in ordered[:k]]  # type: ignore[arg-type]

    def estimate(self, key: str) -> Tuple[int, int]:
        """返回 ``(估算计数, 误差上界)``；key 不在表中时返回 ``(0, 0)``。

        精确模式下表中 key 的估算计数即真实计数、误差上界为 0。
        """

        if not isinstance(key, str) or not key:
            raise ValidationError("estimate(key) 需要非空字符串")
        slot = self._slots.get(key)
        return (slot.count, slot.error) if slot is not None else (0, 0)

    def exact_count(self, key: str) -> int:
        """精确模式下返回 key 的真实总计数；其余情况返回 0。"""

        return self._exact_counts.get(key, 0)

    def heavy_hitters(self, threshold: int) -> List[Tuple[str, int]]:
        """当前滑动窗口内带权计数 >= threshold 的 ``(key, count)`` 列表。

        按计数降序、同计数按 key 升序。threshold 必须是正整数。
        """

        if not isinstance(threshold, int) or isinstance(threshold, bool) or threshold <= 0:
            raise ValidationError(f"threshold 必须是正整数，收到 {threshold!r}")
        items = [(key, cnt) for key, cnt in self._cur.items() if cnt >= threshold]
        items.sort(key=lambda kv: (-kv[1], kv[0]))
        return items

    def burst_detect(self, ratio: float) -> List[Tuple[str, float, int, int]]:
        """突增检测：当前窗口相对前一窗口增长率 >= ratio 的 key。

        返回 ``(key, growth, current_count, previous_count)``，按增长率
        降序、同增长率按 key 升序；从 0 增长（prev 为 0、cur > 0）增长率
        视为 ``float('inf')`` 并排最前。只考察当前窗口计数为正的 key
        （计数下降或消失不算突增）。

        ratio 必须是有限正数；0、负数、NaN、+inf 一律拒绝。
        """

        if isinstance(ratio, bool) or not isinstance(ratio, (int, float)):
            raise ValidationError(f"ratio 必须是数值，收到 {ratio!r}")
        ratio = float(ratio)
        if ratio != ratio or ratio <= 0.0 or ratio == float("inf"):
            raise ValidationError(f"ratio 必须在 (0, +inf) 内（有限正数），收到 {ratio!r}")

        results: List[Tuple[str, float, int, int]] = []
        for key in set(self._cur) | set(self._prev):
            cur_c = self._cur.get(key, 0)
            if cur_c <= 0:
                continue
            prev_c = self._prev.get(key, 0)
            growth = float("inf") if prev_c == 0 else (cur_c - prev_c) / prev_c
            if growth >= ratio:
                results.append((key, growth, cur_c, prev_c))

        # inf 一组排最前；组内及有限组均按增长率降序、key 升序
        results.sort(key=lambda t: (
            0 if t[1] == float("inf") else 1,
            0.0 if t[1] == float("inf") else -t[1],
            t[0],
        ))
        return results

    def stats(self) -> Dict[str, Any]:
        """返回内核配置与运行统计。"""

        return {
            "k": self.k,
            "window_size": self.window_size,
            "exact": self.exact,
            "max_memory_bytes": self.max_memory_bytes,
            "alignment": self.alignment,
            "window_start": self._window_start,
            "total_processed": self.total_processed,
            "total_weight": self.total_weight,
            "total_evicted": self.total_evicted,
            "rejected_out_of_window": self.rejected_out_of_window,
            "rejected_memory": self.rejected_memory,
            "memory_used": self._mem,
            "slot_count": len(self._slots),
            "current_window_keys": len(self._cur),
            "previous_window_keys": len(self._prev),
            "heap_entries": len(self._heap),
        }

    # ------------------------------------------------------------------
    # 合并
    # ------------------------------------------------------------------

    def merge(self, other: "TopKTracker") -> "TopKTracker":
        """把另一个 tracker 的状态合并进 self（原地修改，返回 self）。

        前提：两个 tracker 观察的是**不相交**的记录分区（标准摘要合并
        语义）。特别地，``t.merge(t)``（同一对象）是空操作，避免把同一
        批数据重复计入导致估算翻倍。

        语义：

        * **槽位按 key 对齐**：同 key 的估算计数、误差上界分别相加；
          只在一方出现的 key 原样保留。
        * 合并后槽位数若超过 K，按与 :meth:`top` 相同的次序
          （计数降序、key 升序）保留前 K 个，其余槽位直接丢弃；
          保留槽的计数与误差保持相加结果不变——相加得到的
          ``est-err <= 真实计数`` 保证不失效，且最小保留槽的计数不
          低于任一被丢弃槽的计数，Space-Saving 的最小槽上界不变式成立。
        * 窗口要求 ``window_size``、对齐基准与当前窗口起点一致，
          两桶计数按 key 相加；一个为空内核时直接采纳另一方窗口。
        * 统计计数相加；``max_memory_bytes`` 取两者较宽松者。
          若合并后状态仍超过该上限，抛出 :class:`MemoryLimitError`
          且 **self 不发生任何修改**（合并是原子的）。
        * exact 模式只能与 exact 模式合并，精确计数按 key 相加。
        """

        if not isinstance(other, TopKTracker):
            raise ValidationError("merge 需要另一个 TopKTracker 实例")
        if other is self:
            return self  # 同一对象合并无意义，避免估算翻倍
        if self.k != other.k:
            raise ValidationError(f"K 不一致：{self.k} vs {other.k}")
        if self.window_size != other.window_size:
            raise ValidationError(
                f"window_size 不一致：{self.window_size} vs {other.window_size}"
            )
        if self.alignment != other.alignment:
            raise ValidationError(
                f"窗口对齐基准不一致：{self.alignment} vs {other.alignment}"
            )
        if self.exact != other.exact:
            raise ValidationError("不能跨 exact / 近似模式合并")
        if (
            self._window_start is not None
            and other._window_start is not None
            and self._window_start != other._window_start
        ):
            raise ValidationError(
                f"当前窗口起点不一致：{self._window_start} vs {other._window_start}，"
                f"窗口计数无法对齐（请先让双方处于同一时间网格窗口）"
            )

        # ---- 在临时结构上预演合并，任何拒绝都不影响 self ----
        merged_slots: Dict[str, _Slot] = {}
        for src in (self, other):
            for key, slot in src._slots.items():
                dst = merged_slots.get(key)
                if dst is None:
                    merged_slots[key] = _Slot(key, slot.count, slot.error)
                else:
                    dst.count += slot.count
                    dst.error += slot.error

        if len(merged_slots) > self.k and not self.exact:
            ordered = sorted(merged_slots.values(), key=lambda s: (-s.count, s.key))
            keep = ordered[: self.k]
            pruned = len(ordered) - self.k
            merged_slots = {s.key: s for s in keep}  # type: ignore[arg-type]
            # 裁剪只删除槽位，不修改保留槽的计数与误差：相加得到的
            # est/err 保证（est-err <= 真实计数）不因删除而失效；
            # 同时最小保留计数 >= 任一被删槽计数，Space-Saving 的
            # "最小槽计数是未监控 key 真实计数的上界"不变式继续成立。

        merged_exact: Dict[str, int] = {}
        if self.exact:
            for src in (self, other):
                for key, cnt in src._exact_counts.items():
                    merged_exact[key] = merged_exact.get(key, 0) + cnt

        merged_cur: Dict[str, int] = dict(self._cur)
        merged_prev: Dict[str, int] = dict(self._prev)
        for key, cnt in other._cur.items():
            merged_cur[key] = merged_cur.get(key, 0) + cnt
        for key, cnt in other._prev.items():
            merged_prev[key] = merged_prev.get(key, 0) + cnt
        merged_start = self._window_start or other._window_start

        merged_limit = (
            None
            if self.max_memory_bytes is None or other.max_memory_bytes is None
            else max(self.max_memory_bytes, other.max_memory_bytes)
        )
        projected_mem = (
            sum(self._slot_fee(key) for key in merged_slots)
            + sum(self._window_fee(key) for key in merged_cur)
            + sum(self._window_fee(key) for key in merged_prev)
            + _EXACT_ENTRY_BYTES * len(merged_exact)
        )
        if merged_limit is not None and projected_mem > merged_limit:
            raise MemoryLimitError(
                f"合并后预计占用约 {projected_mem} 字节，超过合并上限 "
                f"{merged_limit} 字节；合并被拒绝，双方状态均未修改"
            )

        # ---- 提交 ----
        self.max_memory_bytes = merged_limit
        self._slots = merged_slots
        self._heap_seq += 1
        self._rebuild_heap()
        if self.exact:
            self._exact_counts = merged_exact
        self._cur = merged_cur
        self._prev = merged_prev
        self._window_start = merged_start
        self.total_processed += other.total_processed
        self.total_weight += other.total_weight
        self.total_evicted += other.total_evicted
        self.rejected_out_of_window += other.rejected_out_of_window
        self.rejected_memory += other.rejected_memory
        self._mem = projected_mem
        return self

    # ------------------------------------------------------------------
    # 快照
    # ------------------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """导出可 JSON 序列化的完整状态字典。"""

        slots = sorted(self._slots.values(), key=lambda s: (-s.count, s.key))
        return {
            "version": SNAPSHOT_VERSION,
            "config": {
                "k": self.k,
                "window_size": self.window_size,
                "exact": self.exact,
                "max_memory_bytes": self.max_memory_bytes,
                "alignment": self.alignment,
            },
            "slots": [
                {"key": s.key, "count": s.count, "error": s.error} for s in slots
            ],
            "exact_counts": dict(sorted(self._exact_counts.items())) if self.exact else {},
            "window": {
                "start": self._window_start,
                "current": dict(sorted(self._cur.items())),
                "previous": dict(sorted(self._prev.items())),
            },
            "stats": {
                "total_processed": self.total_processed,
                "total_weight": self.total_weight,
                "total_evicted": self.total_evicted,
                "rejected_out_of_window": self.rejected_out_of_window,
                "rejected_memory": self.rejected_memory,
            },
        }

    def save_json(self) -> str:
        """导出状态为 JSON 字符串。"""

        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2, allow_nan=False)

    def save(self, path: str) -> None:
        """原子写入 JSON 快照（先写临时文件再 os.replace）。"""

        directory = os.path.dirname(os.path.abspath(path)) or "."
        tmp_path = os.path.join(directory, f".{os.path.basename(path)}.tmp")
        with open(tmp_path, "w", encoding="utf-8") as fh:
            fh.write(self.save_json())
        os.replace(tmp_path, path)

    @classmethod
    def from_dict(cls, data: Any) -> "TopKTracker":
        """从快照字典重建状态并做严格一致性校验。

        Raises:
            SnapshotError: 结构损坏、字段缺失或任何一致性检查失败。
        """

        def req(container: Any, key: str, where: str) -> Any:
            if not isinstance(container, dict) or key not in container:
                raise SnapshotError(f"快照损坏：{where} 缺少字段 {key!r}")
            return container[key]

        def is_pos_int(v: Any) -> bool:
            return isinstance(v, int) and not isinstance(v, bool) and v > 0

        def is_nonneg_int(v: Any) -> bool:
            return isinstance(v, int) and not isinstance(v, bool) and v >= 0

        if not isinstance(data, dict):
            raise SnapshotError("快照顶层必须是 JSON 对象")
        if req(data, "version", "根") != SNAPSHOT_VERSION:
            raise SnapshotError(
                f"不支持的快照版本 {data.get('version')!r}，"
                f"当前仅支持版本 {SNAPSHOT_VERSION}"
            )

        cfg = req(data, "config", "根")
        k = req(cfg, "k", "config")
        window_size = req(cfg, "window_size", "config")
        exact = req(cfg, "exact", "config")
        alignment = req(cfg, "alignment", "config")
        max_memory_bytes = cfg.get("max_memory_bytes", None)
        if not is_pos_int(k):
            raise SnapshotError(f"config.k 必须是正整数，收到 {k!r}")
        if not is_pos_int(window_size):
            raise SnapshotError(f"config.window_size 必须是正整数，收到 {window_size!r}")
        if not isinstance(exact, bool):
            raise SnapshotError("config.exact 必须是 bool")
        if not is_nonneg_int(alignment):
            raise SnapshotError(f"config.alignment 必须是非负整数，收到 {alignment!r}")
        if max_memory_bytes is not None and not is_nonneg_int(max_memory_bytes):
            raise SnapshotError(
                f"config.max_memory_bytes 必须是非负整数或 null，收到 {max_memory_bytes!r}"
            )

        tracker = cls(
            k=k,
            window_size=window_size,
            exact=exact,
            max_memory_bytes=max_memory_bytes,
            start_ts=alignment,
        )

        # ---- 槽位 ----
        raw_slots = req(data, "slots", "根")
        if not isinstance(raw_slots, list):
            raise SnapshotError("slots 必须是列表")
        # 近似模式槽位上限为 K；精确模式永不淘汰，槽位数可以超过 K
        if not exact and len(raw_slots) > k:
            raise SnapshotError(f"槽位数 {len(raw_slots)} 超过 K={k}")
        seen: set = set()
        for i, item in enumerate(raw_slots):
            if not isinstance(item, dict):
                raise SnapshotError(f"slots[{i}] 必须是对象")
            key = item.get("key")
            count = item.get("count")
            error = item.get("error")
            if not isinstance(key, str) or not key:
                raise SnapshotError(f"slots[{i}].key 必须是非空字符串")
            if key in seen:
                raise SnapshotError(f"slots 中 key {key!r} 重复")
            seen.add(key)
            if not is_pos_int(count):
                raise SnapshotError(
                    f"slots[{i}](key={key!r}).count 必须是正整数，收到 {count!r}"
                )
            if not is_nonneg_int(error):
                raise SnapshotError(
                    f"slots[{i}](key={key!r}).error 必须是非负整数，收到 {error!r}"
                )
            if error > count:
                raise SnapshotError(
                    f"slots[{i}](key={key!r}).error={error} 超过估算计数 {count}"
                )
            if exact and error != 0:
                raise SnapshotError(f"exact 模式下 slots[{i}].error 必须为 0")
            slot = _Slot(key, count, error)
            tracker._slots[key] = slot
            tracker._push_slot(slot)

        # ---- 精确计数 ----
        raw_exact = req(data, "exact_counts", "根")
        if not isinstance(raw_exact, dict):
            raise SnapshotError("exact_counts 必须是对象")
        if exact:
            for key, cnt in raw_exact.items():
                if not isinstance(key, str) or not key:
                    raise SnapshotError(f"exact_counts 存在非法 key：{key!r}")
                if not is_pos_int(cnt):
                    raise SnapshotError(f"exact_counts[{key!r}] 必须是正整数，收到 {cnt!r}")
                tracker._exact_counts[key] = cnt
            for key, slot in tracker._slots.items():
                if tracker._exact_counts.get(key) != slot.count:
                    raise SnapshotError(
                        f"exact 模式一致性失败：key={key!r} 槽位计数 {slot.count} "
                        f"与精确计数 {tracker._exact_counts.get(key)} 不一致"
                    )
        elif raw_exact:
            raise SnapshotError("非 exact 快照的 exact_counts 必须为空")

        # ---- 窗口 ----
        win = req(data, "window", "根")
        start = req(win, "start", "window")
        current = req(win, "current", "window")
        previous = req(win, "previous", "window")
        if start is None:
            if current or previous:
                raise SnapshotError("window.start 为 null 时两个窗口桶必须为空")
        else:
            if not is_nonneg_int(start):
                raise SnapshotError(f"window.start 必须是非负整数或 null，收到 {start!r}")
            if start < alignment or (start - alignment) % window_size != 0:
                raise SnapshotError(
                    f"窗口起点 {start} 必须是 window_size={window_size} 相对 "
                    f"alignment={alignment} 的整数倍"
                )
            for name, bucket in (("current", current), ("previous", previous)):
                if not isinstance(bucket, dict):
                    raise SnapshotError(f"window.{name} 必须是对象")
                for wkey, cnt in bucket.items():
                    if not isinstance(wkey, str) or not wkey:
                        raise SnapshotError(f"window.{name} 存在非法 key：{wkey!r}")
                    if not is_nonneg_int(cnt):
                        raise SnapshotError(
                            f"window.{name}[{wkey!r}] 必须是非负整数，收到 {cnt!r}"
                        )
            tracker._window_start = start
            tracker._cur = dict(current)
            tracker._prev = dict(previous)

        # ---- 统计 ----
        st = req(data, "stats", "根")
        for name in (
            "total_processed",
            "total_weight",
            "total_evicted",
            "rejected_out_of_window",
            "rejected_memory",
        ):
            val = req(st, name, "stats")
            if not is_nonneg_int(val):
                raise SnapshotError(f"stats.{name} 必须是非负整数，收到 {val!r}")
        tracker.total_processed = st["total_processed"]
        tracker.total_weight = st["total_weight"]
        tracker.total_evicted = st["total_evicted"]
        tracker.rejected_out_of_window = st["rejected_out_of_window"]
        tracker.rejected_memory = st["rejected_memory"]

        # ---- 交叉一致性 ----
        slot_sum = sum(s.count for s in tracker._slots.values())
        if slot_sum > tracker.total_weight:
            raise SnapshotError(
                f"一致性失败：槽位估算总和 {slot_sum} 超过累计权重 {tracker.total_weight}"
            )
        if tracker.exact:
            exact_weight = sum(tracker._exact_counts.values())
            if exact_weight != tracker.total_weight:
                raise SnapshotError(
                    f"一致性失败：精确计数总和 {exact_weight} 不等于累计权重 "
                    f"{tracker.total_weight}"
                )

        tracker._mem = (
            sum(tracker._slot_fee(key) for key in tracker._slots)
            + sum(tracker._window_fee(key) for key in tracker._cur)
            + sum(tracker._window_fee(key) for key in tracker._prev)
            + _EXACT_ENTRY_BYTES * len(tracker._exact_counts)
        )
        return tracker

    @classmethod
    def load(cls, path: str) -> "TopKTracker":
        """读取 JSON 快照并校验、重建状态。

        Raises:
            SnapshotError: 文件无法读取、JSON 非法或一致性校验失败。
        """

        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"快照文件不是合法 JSON：{exc}") from exc
        except OSError as exc:
            raise SnapshotError(f"快照文件无法读取：{exc}") from exc
        return cls.from_dict(data)
