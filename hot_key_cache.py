"""流式热点探测与缓存淘汰内核（仅 Python 标准库）。

设计要点：
  - 带衰减的热点计数：权重按 exp(-(now - last_ts) / half_life) 衰减，
    用时间桶查表近似，避免每次调用 math.exp。
  - 分段 LRU：probation / protected 两段，二次命中晋升；
    protected 满时把最冷的一个降级回 probation，不直接逐出。
  - 准入决策（TinyLFU 风格）：缓存满时，候选键与 probation 最冷键
    比较当前衰减权重，权重不输才准入，防止长尾键挤掉真热点。
  - 确定性：不依赖 wall clock 与随机数；同一访问序列在相同 ts 下
    得到完全相同的判定与淘汰结果。显式传入的乱序 ts 不会倒退窗口。
"""

from __future__ import annotations

import math
import time
from collections import OrderedDict

__all__ = ["HotKeyCache"]

_LN2 = math.log(2.0)
# 每个半衰期划分的时间桶数（近似误差约 2^(1/(2*64)) - 1 ≈ 0.55%）
_BUCKETS_PER_HALF_LIFE = 64
# 衰减表覆盖的半衰期个数，超出视为 0（2**-64 ≈ 5e-20，可忽略）
_TABLE_HALF_LIVES = 64
_DECAY_TABLE = [
    math.exp(-(i / _BUCKETS_PER_HALF_LIFE) * _LN2)
    for i in range(_BUCKETS_PER_HALF_LIFE * _TABLE_HALF_LIVES + 1)
]


class HotKeyCache:
    """热点追踪 + 分段 LRU 准入/淘汰。

    内部只保存每个键的衰减权重、最近访问时间与所在段位，
    不保存原始访问序列。
    """

    def __init__(self, capacity, window_seconds, half_life=60.0,
                 protected_ratio=0.8, max_tracked=100000):
        if capacity < 0:
            raise ValueError(f"capacity={capacity} 不合法，必须 >= 0")
        if window_seconds <= 0:
            raise ValueError(
                f"window_seconds={window_seconds} 不合法，必须大于 0")
        if half_life <= 0:
            raise ValueError(f"half_life={half_life} 不合法，必须大于 0")
        if not (0.0 <= protected_ratio <= 1.0):
            raise ValueError(
                f"protected_ratio={protected_ratio} 越界，合法范围 0..1")
        if max_tracked < 1:
            raise ValueError(f"max_tracked={max_tracked} 不合法，必须 >= 1")

        self.capacity = capacity
        self.window_seconds = float(window_seconds)
        self.half_life = float(half_life)
        self.protected_ratio = float(protected_ratio)
        self.max_tracked = int(max_tracked)
        self.protected_cap = int(capacity * self.protected_ratio)

        # key -> [weight, last_ts]（weight 是 last_ts 时刻的衰减权重）
        self._entries = {}
        self._probation = OrderedDict()   # key -> None，LRU 顺序
        self._protected = OrderedDict()   # key -> None，LRU 顺序
        self._now = 0.0                   # 窗口当前时间，只前进不后退

        # 统计计数
        self.evictions = 0    # 从缓存逐出的键数
        self.promotions = 0   # probation -> protected 晋升次数
        self.demotions = 0    # protected -> probation 降级次数
        self.trims = 0        # max_tracked 触发的追踪记录淘汰次数

        self._decay_scale = _BUCKETS_PER_HALF_LIFE / self.half_life

    # ------------------------------------------------------------------
    # 衰减（时间桶查表近似）
    # ------------------------------------------------------------------

    def _decay(self, dt):
        """返回 exp(-dt/half_life) 的近似值，dt <= 0 时为 1.0。"""
        if dt <= 0:
            return 1.0
        idx = int(dt * self._decay_scale + 0.5)  # 四舍五入到最近时间桶
        if idx >= len(_DECAY_TABLE):
            return 0.0
        return _DECAY_TABLE[idx]

    def _current_weight(self, key):
        e = self._entries.get(key)
        if e is None:
            return 0.0
        return e[0] * self._decay(self._now - e[1])

    # ------------------------------------------------------------------
    # 访问记录
    # ------------------------------------------------------------------

    def track(self, key, weight=1.0, ts=None):
        """记录一次访问。ts 为 None 用单调时钟；乱序 ts 不倒退窗口。"""
        if key is None:
            raise TypeError("key 不能为 None")
        if not (weight > 0):
            raise ValueError(f"weight={weight!r} 不合法，必须为正数")
        if ts is None:
            ts = time.monotonic()
        if ts > self._now:
            self._now = float(ts)
        now = self._now
        e = self._entries.get(key)
        if e is None:
            self._entries[key] = [float(weight), now]
        else:
            e[0] = e[0] * self._decay(now - e[1]) + weight
            e[1] = now
        if len(self._entries) > self.max_tracked:
            self._trim()

    def _trim(self):
        """追踪记录超过 max_tracked：按当前权重淘汰最冷的一半。

        正在缓存中的键不淘汰其追踪记录；淘汰是确定性的
        （按 (权重, 键名) 升序取最冷的一半）。
        """
        now = self._now
        cached = set(self._probation) | set(self._protected)
        candidates = [
            (w * self._decay(now - ts), key)
            for key, (w, ts) in self._entries.items()
            if key not in cached
        ]
        candidates.sort()  # (权重, 键名) 升序，最冷在前
        n_drop = len(self._entries) // 2
        for _, key in candidates[:n_drop]:
            del self._entries[key]
        self.trims += 1

    # ------------------------------------------------------------------
    # 准入与淘汰（分段 LRU）
    # ------------------------------------------------------------------

    def admit(self, key):
        """对 key 做一次缓存访问：命中做段内调整，未命中做准入决策。"""
        if key is None:
            raise TypeError("key 不能为 None")
        if self.capacity == 0:
            return False

        if key in self._protected:
            self._protected.move_to_end(key)
            return True

        if key in self._probation:
            # 二次命中：晋升 protected；protected 满则降级最冷者回 probation
            del self._probation[key]
            self._protected[key] = None
            self.promotions += 1
            if len(self._protected) > self.protected_cap:
                demoted, _ = self._protected.popitem(last=False)
                self._probation[demoted] = None
                self.demotions += 1
            return True

        # 未命中：缓存未满直接进 probation
        if len(self._probation) + len(self._protected) < self.capacity:
            self._probation[key] = None
            return True

        # 缓存已满：与 probation 最冷键比权重，频率保护
        if not self._probation:
            return False  # 无 probation 段可淘汰（如 protected_ratio=1）
        victim = next(iter(self._probation))
        if self._current_weight(key) >= self._current_weight(victim):
            del self._probation[victim]
            self._probation[key] = None
            self.evictions += 1
            return True
        return False

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def top_k(self, k):
        """当前窗口内权重最高的 k 个 (key, weight)，权重降序、同重按键名升序。"""
        if k <= 0:
            return []
        now = self._now
        cutoff = now - self.window_seconds
        items = [
            (key, w * self._decay(now - ts))
            for key, (w, ts) in self._entries.items()
            if ts >= cutoff
        ]
        items.sort(key=lambda t: (-t[1], t[0]))
        return items[:k]

    @property
    def now(self):
        """窗口当前时间（只前进不后退）。"""
        return self._now

    @property
    def tracked(self):
        """当前追踪的键数。"""
        return len(self._entries)

    def __contains__(self, key):
        return key in self._probation or key in self._protected

    def cached(self):
        """当前缓存中的键集合（只读快照）。"""
        return set(self._protected) | set(self._probation)

    def __len__(self):
        return len(self._probation) + len(self._protected)
