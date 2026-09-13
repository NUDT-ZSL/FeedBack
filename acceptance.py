"""端到端验收脚本（不依赖测试框架，直接 python acceptance.py 运行）。

用可注入的假时钟逐条覆盖需求中的验收点：

 1. 滑动窗口边界不出现两倍突发
 2. 熔断打开与半开探测成功 / 失败
 3. 冷却期指数退避与上限
 4. 限流熔断组合互不污染
 5. save/load 快照往返一致
 6. 坏文件 / 缺字段报错清晰
 7. 边界参数：空 key、cost<=0、非法配置、窗口为 0、阈值恰好命中、
    时钟不推进重复调用
 8. main.py 命令行 JSON 协议（子进程）
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

import kernel
from kernel import (
    STATE_CLOSED,
    STATE_HALF_OPEN,
    STATE_OPEN,
    CircuitBreaker,
    FakeClock,
    Guard,
    SnapshotError,
    SlidingWindowRateLimiter,
)

PASS = 0
FAIL = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    """断言并打印一条验收结果。"""
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def section(title: str) -> None:
    print(f"\n=== {title} ===")


# ---------------------------------------------------------------------------
# 1. 滑动窗口：边界突发
# ---------------------------------------------------------------------------


def acceptance_sliding_window() -> None:
    section("1. 滑动窗口限流：边界处无两倍突发")
    clock = FakeClock()
    rl = SlidingWindowRateLimiter(window_length=10, rate_limit=3, clock=clock)

    # t=0、2、4 各放一个。
    for t in (0, 2, 4):
        clock.set_now(t)
        check(f"t={t} 放行", rl.allow("svc")["allowed"])

    # t=9：窗口 (-1,9] 里已有 3 个，必须拒绝，且 retry_after=1（t=0 事件 t=10 过期）。
    clock.set_now(9)
    d = rl.allow("svc")
    check("t=9 不允许跨窗突发", not d["allowed"])
    check("给出剩余等待时间", abs(d["retry_after"] - 1.0) < 1e-9,
          f"retry_after={d['retry_after']}")

    # t=10：t=0 的事件恰好过期，恢复 1 个容量，而不是一次性恢复 3 个。
    clock.set_now(10)
    check("t=10 恢复 1 个容量", rl.allow("svc")["allowed"])
    check("t=10 第二个仍被拒", not rl.allow("svc")["allowed"])

    # 经典固定窗口攻击：t=9.5 用满，t=10.5 不能再得到整窗容量。
    clock2 = FakeClock(9.5)
    rl2 = SlidingWindowRateLimiter(10, 3, clock2)
    for _ in range(3):
        rl2.allow("x")
    clock2.set_now(10.5)
    burst = sum(1 for _ in range(3) if rl2.allow("x")["allowed"])
    check("t=10.5 处不出现第二个整窗突发（0 个放行）", burst == 0, f"实际放行 {burst}")

    # 时钟不推进时重复调用：不会泄露容量。
    clock3 = FakeClock()
    rl3 = SlidingWindowRateLimiter(10, 2, clock3)
    rl3.allow("y")
    rl3.allow("y")
    repeats = [rl3.allow("y")["allowed"] for _ in range(5)]
    check("时钟不推进重复调用全部拒绝", not any(repeats))


# ---------------------------------------------------------------------------
# 2. 熔断打开与半开探测
# ---------------------------------------------------------------------------


def acceptance_circuit_breaker() -> None:
    section("2. 熔断：连续失败打开、冷却后半开、探测成功/失败")
    clock = FakeClock()
    cb = CircuitBreaker(
        clock, window_length=20, failure_rate_threshold=0.5, min_samples=4,
        consecutive_failure_threshold=3, cooldown_duration=5,
        half_open_max_calls=1,
    )

    cb.record_failure("api")
    cb.record_failure("api")
    check("连续失败未达阈值时仍 closed",
          cb.get_state("api")["state"] == STATE_CLOSED)
    r = cb.record_failure("api")  # 恰好达到连续失败阈值
    check("连续失败恰好达到阈值 -> open",
          r["tripped"] and cb.get_state("api")["state"] == STATE_OPEN)

    # open 期间 allow 直接拒绝，不执行；上报结果被忽略。
    d = cb.allow("api")
    check("open 期间调用直接拒绝", not d["allowed"] and
          d["rejected_by"] == "circuit_breaker")
    check("open 期间失败结果不计入统计",
          cb.record_failure("api")["recorded"] is False)

    # 冷却期内不迁移，到点才 half_open。
    clock.tick(4)
    check("冷却未结束仍 open", cb.get_state("api")["state"] == STATE_OPEN)
    clock.tick(1)
    check("冷却结束进入 half_open", cb.get_state("api")["state"] == STATE_HALF_OPEN)
    probe = cb.allow("api")
    check("半开放行 1 个探测", probe["allowed"] and probe["probe"])
    check("半开第 2 个请求拒绝", not cb.allow("api")["allowed"])

    # 探测成功 -> closed，统计清零，进入观察期。
    rec = cb.record_success("api")
    check("探测成功关闭熔断", rec["state"] == STATE_CLOSED)
    st = cb.get_state("api")
    check("关闭后统计清零", st["successes"] == 0 and st["failures"] == 0)
    check("关闭后存在观察期", st["observation_until"] is not None)

    # 失败率路径 + 恰好等于阈值：2 成功 2 失败 = 0.5。
    cb2 = CircuitBreaker(FakeClock(), failure_rate_threshold=0.5,
                         min_samples=4, consecutive_failure_threshold=99)
    cb2.record_success("q")
    cb2.record_success("q")
    cb2.record_failure("q")
    check("样本不足时失败率不触发",
          cb2.get_state("q")["state"] == STATE_CLOSED)
    cb2.record_failure("q")
    check("失败率恰好等于阈值 -> open",
          cb2.get_state("q")["state"] == STATE_OPEN)


# ---------------------------------------------------------------------------
# 3. 指数退避与上限
# ---------------------------------------------------------------------------


def acceptance_backoff() -> None:
    section("3. 半开探测失败：指数退避延长冷却期，且有上限")
    clock = FakeClock()
    cb = CircuitBreaker(
        clock, consecutive_failure_threshold=1, cooldown_duration=5,
        backoff_strategy="exponential", backoff_multiplier=2, max_cooldown=30,
    )
    cb.record_failure("db")  # open 5
    expected = [10.0, 20.0, 30.0, 30.0]
    actual = []
    for _ in range(4):
        cd = cb.get_state("db")["cooldown_end"] - clock.now()
        clock.tick(cd)
        cb.allow("db")  # 半开探测
        r = cb.record_failure("db")  # 探测失败 -> 退避重开
        actual.append(r["cooldown"])
    check("冷却期 5 -> 10 -> 20 -> 30(封顶) -> 30",
          actual == expected, f"实际 {actual}")

    # 固定策略不增长。
    clock2 = FakeClock()
    fixed = CircuitBreaker(clock2, consecutive_failure_threshold=1,
                           cooldown_duration=5, backoff_strategy="fixed",
                           max_cooldown=100)
    fixed.record_failure("z")
    clock2.tick(5)
    fixed.allow("z")
    check("fixed 策略冷却期保持 5",
          fixed.record_failure("z")["cooldown"] == 5.0)

    # 假时钟可注入：恢复瞬间的 cooldown_end = now + cooldown。
    clock3 = FakeClock()
    cb3 = CircuitBreaker(clock3, consecutive_failure_threshold=1,
                         cooldown_duration=5, max_cooldown=100)
    cb3.record_failure("w")
    clock3.tick(5)
    cb3.allow("w")
    r3 = cb3.record_failure("w")
    check("退避后的到期时间 = 当前时钟 + 新冷却期",
          abs(r3["cooldown_end"] - (clock3.now() + 10.0)) < 1e-9)


# ---------------------------------------------------------------------------
# 4. 自适应恢复：观察期快速重开
# ---------------------------------------------------------------------------


def acceptance_adaptive() -> None:
    section("4. 自适应恢复：观察期内再次超标更快打开，冷却不超上限")
    clock = FakeClock()
    cb = CircuitBreaker(
        clock, consecutive_failure_threshold=1, cooldown_duration=10,
        observation_window=20, fast_open_multiplier=0.5, max_cooldown=30,
    )
    cb.record_failure("s")
    clock.tick(10)
    cb.allow("s")
    cb.record_success("s")  # 恢复，观察期到 t=30
    r = cb.record_failure("s")  # 观察期内立即再失败
    check("观察期内重开冷却缩短为一半(5)",
          r["tripped"] and r["cooldown"] == 5.0 and r["fast_open"])

    clock.tick(5)
    cb.allow("s")
    cb.record_success("s")
    clock.tick(21)  # 出观察期
    r2 = cb.record_failure("s")
    check("观察期外按正常冷却(10)重开",
          r2["tripped"] and r2["cooldown"] == 10.0 and not r2.get("fast_open"))


# ---------------------------------------------------------------------------
# 5. 组合互不污染
# ---------------------------------------------------------------------------


def acceptance_guard() -> None:
    section("5. 限流 + 熔断组合：先限流后熔断，统计互不污染")
    clock = FakeClock()
    rl = SlidingWindowRateLimiter(10, 3, clock)
    cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                        cooldown_duration=5, max_cooldown=100)
    guard = Guard(clock, rl, cb)

    # 限流拒绝不碰熔断器。
    for _ in range(3):
        rl.allow("a")
    d = guard.allow("a")
    check("组合层限流拒绝", not d["allowed"] and
          d["rejected_by"] == "rate_limiter")
    check("限流拒绝不在熔断器创建状态", "a" not in cb._states)

    # 熔断打开后：Guard 拒绝不消耗限流配额。
    cb.record_failure("b")  # open
    for _ in range(5):
        d = guard.allow("b")
        check_piece = (not d["allowed"] and
                       d["rejected_by"] == "circuit_breaker")
    check("open 期间 5 次申请全部被熔断拒绝", check_piece)
    check("熔断拒绝不消耗限流配额（用量为 0）",
          rl.get_stats("b")["current"] == 0)

    # 成功/失败只写给熔断器。
    guard.allow("c")
    guard.record_failure("c")
    check("record_failure 不触碰限流窗口",
          rl.get_stats("c")["current"] == 1 and
          cb.get_state("c")["state"] == STATE_OPEN)

    # 两 key 状态独立。
    check("a 与 b 的熔断状态互不污染",
          cb.get_state("a")["state"] == STATE_CLOSED and
          cb.get_state("b")["state"] == STATE_OPEN)


# ---------------------------------------------------------------------------
# 6/7. 快照往返 + 坏文件
# ---------------------------------------------------------------------------


def acceptance_persistence() -> None:
    section("6. save/load 快照往返一致")
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "snap.json")
    clock = FakeClock()
    rl = SlidingWindowRateLimiter(10, 5, clock)
    cb = CircuitBreaker(
        clock, failure_rate_threshold=0.6, min_samples=4,
        consecutive_failure_threshold=2, cooldown_duration=5,
        half_open_max_calls=2, backoff_multiplier=2, max_cooldown=40,
        observation_window=15,
    )
    guard = Guard(clock, rl, cb)
    guard.allow("a")
    guard.record_failure("a")
    guard.record_failure("a")  # open
    guard.tick(2)
    guard.allow("z")
    before = json.dumps(guard.get_stats(), sort_keys=True)
    guard.save(path)

    loaded = Guard.load(path)
    after = json.dumps(loaded.get_stats(), sort_keys=True)
    check("load 后统计与 save 前一致", before == after)
    check("load 后时钟读数一致", loaded.clock.now() == 2.0)
    check("load 后状态为 open", loaded.get_state("a")["state"] == STATE_OPEN)
    check("load 保留配置（2 个探测名额）",
          loaded.circuit_breaker.half_open_max_calls == 2)

    # 时钟不回退：把快照载入更早的时钟会把时钟向前推进到快照时间；
    # 载入更晚的时钟（要求时钟倒退）则报错。
    earlier_ok = FakeClock()  # 当前 0，早于快照的 2
    loaded2 = Guard.load(path, clock=earlier_ok)
    check("载入更早时钟：时钟被推进到快照时间且状态可用",
          loaded2.clock.now() == 2.0 and
          loaded2.get_state("a")["state"] == STATE_OPEN)
    later = FakeClock()
    later.set_now(50)  # 晚于快照的 2，载入将导致时钟回退
    try:
        Guard.load(path, clock=later)
        check("载入更晚时钟必须拒绝（时钟不回退）", False)
    except SnapshotError:
        check("载入更晚时钟必须拒绝（时钟不回退）", True)
    check("被拒绝后原时钟保持不变", later.now() == 50.0)

    section("7. 坏文件 / 缺字段：清晰报错，不静默吞掉")

    def expect_error(label: str, data: object) -> None:
        p = os.path.join(tmp, "bad.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        try:
            Guard.load(p)
            check(label, False, "未报错")
        except SnapshotError as exc:
            check(label, bool(str(exc).strip()), f"错误信息: {exc}")

    # 文件不存在 / JSON 损坏
    try:
        Guard.load(os.path.join(tmp, "missing.json"))
        check("文件不存在报错", False)
    except SnapshotError as exc:
        check("文件不存在报错", "不存在" in str(exc))
    with open(os.path.join(tmp, "corrupt.json"), "w", encoding="utf-8") as fh:
        fh.write("{oops")
    try:
        Guard.load(os.path.join(tmp, "corrupt.json"))
        check("JSON 损坏报错", False)
    except SnapshotError as exc:
        check("JSON 损坏报错并带位置", "JSON" in str(exc))

    good = guard.to_dict()
    bad_state = json.loads(json.dumps(good))
    bad_state["keys"]["a"]["breaker"]["state"] = "half_closed"
    expect_error("非法状态取值报错", bad_state)

    neg = json.loads(json.dumps(good))
    neg["keys"]["a"]["breaker"]["consecutive_failures"] = -1
    expect_error("负计数报错", neg)

    neg_cd = json.loads(json.dumps(good))
    neg_cd["keys"]["a"]["breaker"]["current_cooldown"] = -1
    expect_error("负冷却期报错", neg_cd)

    rollback = json.loads(json.dumps(good))
    rollback["keys"]["a"]["breaker"]["cooldown_end"] = 0.0
    rollback["keys"]["a"]["breaker"]["opened_at"] = 2.0
    expect_error("冷却期回退（end < opened_at）报错", rollback)

    too_many = json.loads(json.dumps(good))
    too_many["keys"]["a"]["breaker"]["state"] = STATE_HALF_OPEN
    too_many["keys"]["a"]["breaker"]["half_open_calls"] = 9
    expect_error("半开探测数超过配置报错", too_many)

    missing = json.loads(json.dumps(good))
    del missing["keys"]["a"]["breaker"]["state"]
    expect_error("字段缺失报错", missing)

    missing_cfg = json.loads(json.dumps(good))
    del missing_cfg["breaker_config"]["cooldown_duration"]
    expect_error("配置字段缺失报错", missing_cfg)

    bad_clock = json.loads(json.dumps(good))
    bad_clock["clock_now"] = -1
    expect_error("负逻辑时钟报错", bad_clock)


# ---------------------------------------------------------------------------
# 8. 边界参数校验
# ---------------------------------------------------------------------------


def acceptance_edge_arguments() -> None:
    section("8. 边界参数：空 key / cost<=0 / 非法配置 / 窗口为 0")
    clock = FakeClock()
    guard = Guard(clock, SlidingWindowRateLimiter(10, 3, clock),
                  CircuitBreaker(clock))

    def raises(label: str, fn: object) -> None:
        try:
            fn()  # type: ignore[operator]
            check(label, False, "未抛 ValueError")
        except ValueError:
            check(label, True)

    raises("空 key 拒绝（限流）", lambda: guard.rate_limiter.allow(""))
    raises("空 key 拒绝（熔断）", lambda: guard.circuit_breaker.get_state(""))
    raises("cost=0 拒绝", lambda: guard.allow("x", 0))
    raises("cost=-1 拒绝", lambda: guard.allow("x", -1))
    raises("限流窗口长度=0 拒绝",
           lambda: SlidingWindowRateLimiter(0, 3, clock))
    raises("限流阈值=0 拒绝",
           lambda: SlidingWindowRateLimiter(10, 0, clock))
    raises("失败率阈值=0 拒绝",
           lambda: CircuitBreaker(clock, failure_rate_threshold=0))
    raises("失败率阈值>1 拒绝",
           lambda: CircuitBreaker(clock, failure_rate_threshold=1.2))
    raises("退避倍数<1 拒绝",
           lambda: CircuitBreaker(clock, backoff_multiplier=0.5))
    raises("未知退避策略拒绝",
           lambda: CircuitBreaker(clock, backoff_strategy="linear"))


# ---------------------------------------------------------------------------
# 9. CLI 子进程
# ---------------------------------------------------------------------------


def acceptance_cli() -> None:
    section("9. main.py 命令行：逐行 JSON，错误也返回 error 字段")
    work = tempfile.mkdtemp()
    snap = os.path.join(work, "cli_snap.json").replace("\\", "/")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
    commands = "\n".join([
        json.dumps({"cmd": "allow", "key": "a"}),
        json.dumps({"cmd": "failure", "key": "a"}),
        json.dumps({"cmd": "state", "key": "a"}),
        json.dumps({"cmd": "tick", "delta": 5}),
        json.dumps({"cmd": "allow", "key": "a"}),
        json.dumps({"cmd": "success", "key": "a"}),
        json.dumps({"cmd": "state", "key": "a"}),
        json.dumps({"cmd": "stats"}),
        json.dumps({"cmd": "reset", "key": "a"}),
        json.dumps({"cmd": "save", "path": snap}),
        json.dumps({"cmd": "load", "path": snap}),
        json.dumps({"cmd": "dump"}),
        '{"cmd":"allow","key":""}',       # 错误：空 key
        '{"cmd":"allow","key":"x","cost":-2}',  # 错误：cost
        "not-a-json-line",                # 错误：坏 JSON
        json.dumps({"cmd": "nope"}),      # 错误：未知命令
    ]) + "\n"
    proc = subprocess.run(
        [sys.executable, script,
         "--rate-window", "10", "--rate-limit", "3",
         "--consecutive-failures", "1", "--cooldown", "5",
         "--half-open-calls", "1"],
        input=commands, capture_output=True, text=True, encoding="utf-8",
    )
    lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    check("每行都有输出", len(lines) == 16, f"实际 {len(lines)} 行")
    check("allow 放行", lines[0]["allowed"] is True)
    check("failure 后 open", lines[2]["state"] == STATE_OPEN)
    check("tick 后半开探测放行",
          lines[4]["state"] == STATE_HALF_OPEN and lines[4]["probe"])
    check("探测成功后 closed", lines[6]["state"] == STATE_CLOSED)
    check("stats 返回全量", "stats" in lines[7] and "a" in lines[7]["stats"])
    check("save/load 成功", lines[9]["ok"] and lines[10]["ok"])
    check("dump 带版本号", lines[11]["version"] == Guard.SNAPSHOT_VERSION)
    for idx, label in ((12, "空 key"), (13, "cost 非法"),
                       (14, "坏 JSON"), (15, "未知命令")):
        ok = lines[idx].get("ok") is False and bool(lines[idx].get("error"))
        check(f"{label} 返回 JSON 错误且含 error 字段", ok,
              f"实际 {lines[idx]}")
    check("进程退出码为 0（错误在行内体现）", proc.returncode == 0)


def main() -> int:
    acceptance_sliding_window()
    acceptance_circuit_breaker()
    acceptance_backoff()
    acceptance_adaptive()
    acceptance_guard()
    acceptance_persistence()
    acceptance_edge_arguments()
    acceptance_cli()
    print(f"\n验收结果：{PASS} 通过, {FAIL} 失败")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
