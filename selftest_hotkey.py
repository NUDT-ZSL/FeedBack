"""hot_key_cache 自测脚本。

验证：
  1. 同一 Zipf 访问序列两次运行，淘汰结果逐项一致（确定性）
  2. 突发扫描后真热点命中率显著高于朴素 LRU（频率保护）
  3. 乱序 ts 不倒退窗口，且结果确定
  4. max_tracked 触发淘汰后 top_k 仍正确
  5. 边界与参数校验行为
并打印命中率、淘汰次数与衰减近似最大误差。
"""

import bisect
import itertools
import math
import random
from collections import OrderedDict

from hot_key_cache import HotKeyCache

WINDOW = 200000.0
HALF_LIFE = 20000.0
CAPACITY = 200


def zipf_keys(n, length, s, seed):
    """按 Zipf 分布生成键序列（种子固定，跨运行确定）。"""
    rng = random.Random(seed)
    cdf = list(itertools.accumulate(1.0 / (i + 1) ** s for i in range(n)))
    total = cdf[-1]
    return [f"k{bisect.bisect(cdf, rng.random() * total)}"
            for _ in range(length)]


def build_sequence():
    """Zipf 预热 -> 冷键扫描 -> 真热点回访 -> Zipf 稳定期。"""
    keys = []
    keys += zipf_keys(2000, 50000, 1.2, seed=1)      # A: 0..50000
    keys += [f"scan{i}" for i in range(8000)]        # B: 50000..58000
    keys += [f"k{i}" for i in range(100)]            # C: 58000..58100
    keys += zipf_keys(2000, 20000, 1.2, seed=2)      # D: 58100..78100
    return [(k, float(i)) for i, k in enumerate(keys)]


PHASES = {"A": (0, 50000), "B": (50000, 58000),
          "C": (58000, 58100), "D": (58100, 78100)}


class NaiveLRU:
    def __init__(self, capacity):
        self.capacity = capacity
        self.od = OrderedDict()
        self.evictions = 0

    def access(self, key):
        if self.capacity == 0:
            return False
        if key in self.od:
            self.od.move_to_end(key)
            return True
        if len(self.od) >= self.capacity:
            self.od.popitem(last=False)
            self.evictions += 1
        self.od[key] = None
        return False


def run_hot(events, with_log=False, **kw):
    cache = HotKeyCache(CAPACITY, WINDOW, HALF_LIFE, **kw)
    hits = 0
    log = []
    for key, ts in events:
        cache.track(key, ts=ts)
        hit = key in cache
        if with_log:
            before = cache.cached()
            admitted = cache.admit(key)
            evicted = before - cache.cached()
            log.append((hit, admitted, sorted(evicted)))
        else:
            cache.admit(key)
        hits += hit
    return cache, hits, log


def main():
    events = build_sequence()

    # ---- 1. 确定性：同一序列两遍，淘汰结果逐项一致 ----
    det_events = events[:30000]
    c1, _, log1 = run_hot(det_events, with_log=True)
    c2, _, log2 = run_hot(det_events, with_log=True)
    assert log1 == log2, "同一序列两次运行的淘汰/准入结果不一致"
    assert c1.top_k(50) == c2.top_k(50), "两次运行 top_k 不一致"
    n_evicted = sum(1 for _, _, ev in log1 if ev)
    print(f"1) 确定性: 两遍运行 {len(log1)} 步准入/淘汰逐项一致: OK "
          f"(淘汰 {n_evicted} 次)")

    # ---- 2. 真热点命中率 vs 朴素 LRU ----
    lru = NaiveLRU(CAPACITY)
    hc = HotKeyCache(CAPACITY, WINDOW, HALF_LIFE)
    hot_hits = {name: 0 for name in PHASES}
    lru_hits = {name: 0 for name in PHASES}
    for i, (key, ts) in enumerate(events):
        hc.track(key, ts=ts)
        h1 = key in hc
        hc.admit(key)
        h2 = lru.access(key)
        for name, (lo, hi) in PHASES.items():
            if lo <= i < hi:
                hot_hits[name] += h1
                lru_hits[name] += h2
                break

    print("2) 命中率对比 (本内核 vs 朴素 LRU):")
    for name, (lo, hi) in PHASES.items():
        n = hi - lo
        print(f"   阶段 {name}: {hot_hits[name]/n:.3f} vs {lru_hits[name]/n:.3f}"
              f"  (n={n})")
    rate_c_hot = hot_hits["C"] / 100
    rate_c_lru = lru_hits["C"] / 100
    assert rate_c_hot > rate_c_lru, "扫描后真热点命中率未超过 LRU"
    assert hot_hits["D"] > lru_hits["D"], "稳定期命中率未超过 LRU"
    print(f"   扫描后真热点命中率: {rate_c_hot:.3f} vs LRU {rate_c_lru:.3f}: OK")
    print(f"   淘汰次数: 本内核 {hc.evictions}, LRU {lru.evictions}; "
          f"晋升 {hc.promotions}, 降级 {hc.demotions}")

    # ---- 3. 乱序 ts 不倒退窗口，结果确定 ----
    rng = random.Random(3)
    shuffled = [(f"k{i % 500}", float(i)) for i in range(20000)]
    for i in range(0, len(shuffled) - 10, 10):
        j = rng.randrange(i, i + 10)
        shuffled[i], shuffled[j] = shuffled[j], shuffled[i]

    def run_shuffled():
        c = HotKeyCache(100, WINDOW, HALF_LIFE)
        prev = 0.0
        for key, ts in shuffled:
            c.track(key, ts=ts)
            assert c.now >= prev, "窗口时间倒退"
            prev = c.now
            c.admit(key)
        return c

    s1, s2 = run_shuffled(), run_shuffled()
    assert s1.now == 19999.0, f"窗口应推进到最大 ts, 实际 {s1.now}"
    assert s1.top_k(30) == s2.top_k(30), "乱序序列两次运行结果不一致"
    print(f"3) 乱序 ts: 窗口单调推进到 {s1.now}, 两次运行 top_k 一致: OK")

    # ---- 4. max_tracked 触发后 top_k 仍正确 ----
    mixed = []
    for i in range(20000):
        mixed.append((f"cold{i}", float(2 * i)))
        mixed.append((f"hot{i % 50}", float(2 * i + 1)))
    trimmed = HotKeyCache(50, WINDOW, HALF_LIFE, max_tracked=2000)
    untrimmed = HotKeyCache(50, WINDOW, HALF_LIFE, max_tracked=10 ** 9)
    for key, ts in mixed:
        trimmed.track(key, ts=ts)
        untrimmed.track(key, ts=ts)
    assert trimmed.trims > 0, "max_tracked 未触发淘汰"
    assert trimmed.tracked <= 2000, f"追踪记录超限: {trimmed.tracked}"
    assert trimmed.top_k(10) == untrimmed.top_k(10), \
        "max_tracked 淘汰后 top_k 不正确"
    print(f"4) max_tracked=2000: 触发 {trimmed.trims} 次淘汰, "
          f"tracked={trimmed.tracked}, top_k(10) 与无限制一致: OK")

    # ---- 5. 衰减近似误差 ----
    probe = HotKeyCache(10, WINDOW, half_life=1000.0)
    max_err = 0.0
    for step in range(16001):
        dt = step * 0.5  # 0 .. 8000 = 8 个半衰期
        exact = math.exp(-dt / 1000.0 * math.log(2.0))
        approx = probe._decay(dt)
        if exact > 0:
            max_err = max(max_err, abs(approx - exact) / exact)
    assert max_err < 0.015, f"衰减近似误差过大: {max_err}"
    print(f"5) 衰减时间桶近似最大相对误差: {max_err:.4%} (8 个半衰期内)")

    # ---- 6. 边界与参数校验 ----
    z = HotKeyCache(0, WINDOW, HALF_LIFE)
    z.track("a", ts=1.0)
    assert z.admit("a") is False and z.admit("b") is False
    assert z.top_k(5) == [("a", 1.0)]
    print("6) capacity=0: admit 全部返回 False 且不抛异常: OK")

    e = HotKeyCache(10, WINDOW, HALF_LIFE)
    assert e.top_k(5) == [], "空窗口 top_k 应为空列表"
    e.track("x", 2.0, ts=100.0)
    e.track("x", 3.0, ts=100.0)  # 同 ts 累加
    e.track("y", 1.0, ts=100.0)
    top = e.top_k(10)
    assert abs(top[0][1] - 5.0) < 1e-9 and top[0][0] == "x"
    assert len(e.top_k(99)) == 2, "k 大于键总数应返回全部"
    print("   同 ts 重复 track 累加权重、k 超总数返回全部、空窗口空列表: OK")

    # 窗口裁剪：窗口外的键不出现在 top_k
    w = HotKeyCache(10, window_seconds=100.0, half_life=HALF_LIFE)
    w.track("old", ts=0.0)
    w.track("new", ts=1000.0)
    assert [k for k, _ in w.top_k(10)] == ["new"]
    print("   窗口外旧键被 top_k 排除: OK")

    for kwargs, exc in [
        ({"half_life": 0}, ValueError),
        ({"half_life": -3}, ValueError),
        ({"protected_ratio": -0.1}, ValueError),
        ({"protected_ratio": 1.5}, ValueError),
    ]:
        try:
            HotKeyCache(10, WINDOW, **kwargs)
            raise AssertionError(f"应抛出 {exc.__name__}: {kwargs}")
        except exc as err:
            print(f"   参数 {kwargs} -> {exc.__name__}: OK ({err})")

    try:
        e.track("bad", weight=0)
        raise AssertionError("weight=0 应抛 ValueError")
    except ValueError as err:
        print(f"   weight=0 -> ValueError: OK ({err})")
    try:
        e.track("bad", weight=-1.5)
        raise AssertionError("weight<0 应抛 ValueError")
    except ValueError:
        print("   weight<0 -> ValueError: OK")
    try:
        e.track(None)
        raise AssertionError("key=None 应抛 TypeError")
    except TypeError:
        print("   key=None -> TypeError: OK")

    print("\n全部自测通过。")


if __name__ == "__main__":
    main()
