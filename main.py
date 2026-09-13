"""命令行入口：从标准输入逐行读取 JSON 命令，逐行输出 JSON 结果。

用法（参数全部可选，括号内为默认值）::

    python main.py \
        [--rate-window 10] [--rate-limit 10] [--no-limiter] \
        [--cb-window 10] [--failure-rate 0.5] [--min-samples 5] \
        [--consecutive-failures 5] [--cooldown 5] \
        [--half-open-calls 1] [--backoff exponential] \
        [--backoff-multiplier 2] [--max-cooldown 60] \
        [--observation-window 30] [--fast-open-multiplier 0.5]

每行输入一个 JSON 对象，必须带 ``cmd`` 字段，支持：

    allow     {"cmd":"allow","key":"a","cost":1}
    success   {"cmd":"success","key":"a"}
    failure   {"cmd":"failure","key":"a"}
    state     {"cmd":"state","key":"a"}
    stats     {"cmd":"stats"} 或 {"cmd":"stats","key":"a"}
    reset     {"cmd":"reset","key":"a"}
    save      {"cmd":"save","path":"snap.json"}
    load      {"cmd":"load","path":"snap.json"}
    dump      {"cmd":"dump"}
    tick      {"cmd":"tick","delta":5}
    now       {"cmd":"now"}

每行输出一个 JSON 对象：成功为 ``{"ok": true, ...}``，
失败为 ``{"ok": false, "error": "...", "cmd": ...}``。
空行忽略；进程在 EOF 时退出。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, IO, List, Optional

from kernel import (
    CircuitBreaker,
    FakeClock,
    Guard,
    SnapshotError,
    SlidingWindowRateLimiter,
)


def build_guard(args: argparse.Namespace) -> Guard:
    """根据命令行参数构造 Guard（共享同一个逻辑时钟）。"""
    clock = FakeClock(0)
    limiter: Optional[SlidingWindowRateLimiter] = None
    if not args.no_limiter:
        limiter = SlidingWindowRateLimiter(
            window_length=args.rate_window,
            rate_limit=args.rate_limit,
            clock=clock,
        )
    breaker = CircuitBreaker(
        clock=clock,
        window_length=args.cb_window,
        failure_rate_threshold=args.failure_rate,
        min_samples=args.min_samples,
        consecutive_failure_threshold=args.consecutive_failures,
        cooldown_duration=args.cooldown,
        half_open_max_calls=args.half_open_calls,
        backoff_strategy=args.backoff,
        backoff_multiplier=args.backoff_multiplier,
        max_cooldown=args.max_cooldown,
        observation_window=args.observation_window,
        fast_open_multiplier=args.fast_open_multiplier,
    )
    return Guard(clock=clock, rate_limiter=limiter, circuit_breaker=breaker)


def make_parser() -> argparse.ArgumentParser:
    """构造命令行参数解析器。"""
    p = argparse.ArgumentParser(
        description="滑动窗口限流 + 失败率熔断内核（离线、逻辑时钟驱动）"
    )
    # 限流器
    p.add_argument("--rate-window", type=float, default=10.0,
                   help="限流滑动窗口长度（默认 10）")
    p.add_argument("--rate-limit", type=int, default=10,
                   help="限流窗口内允许的请求总量（默认 10）")
    p.add_argument("--no-limiter", action="store_true",
                   help="禁用限流器，Guard 退化为纯熔断闸门")
    # 熔断器
    p.add_argument("--cb-window", type=float, default=10.0,
                   help="熔断失败率统计窗口长度（默认 10）")
    p.add_argument("--failure-rate", type=float, default=0.5,
                   help="失败率阈值，取值 (0,1]，>= 该值触发熔断（默认 0.5）")
    p.add_argument("--min-samples", type=int, default=5,
                   help="失败率判定所需的最小样本数（默认 5）")
    p.add_argument("--consecutive-failures", type=int, default=5,
                   help="连续失败熔断阈值（默认 5）")
    p.add_argument("--cooldown", type=float, default=5.0,
                   help="首次打开后的冷却期长度（默认 5）")
    p.add_argument("--half-open-calls", type=int, default=1,
                   help="半开状态放行的探测请求数（默认 1）")
    p.add_argument("--backoff", choices=("fixed", "exponential"),
                   default="exponential", help="冷却期延长策略（默认 exponential）")
    p.add_argument("--backoff-multiplier", type=float, default=2.0,
                   help="指数退避倍数（默认 2）")
    p.add_argument("--max-cooldown", type=float, default=60.0,
                   help="冷却期上限（默认 60）")
    p.add_argument("--observation-window", type=float, default=30.0,
                   help="恢复后的观察期长度（默认 30）")
    p.add_argument("--fast-open-multiplier", type=float, default=0.5,
                   help="观察期内重新熔断时冷却期的缩短比例（默认 0.5）")
    return p


class CommandRunner:
    """逐行执行 JSON 命令；把输入/输出流参数化以便单测。"""

    def __init__(self, guard: Guard) -> None:
        self.guard = guard

    def handle(self, line: str) -> Dict[str, Any]:
        """处理一行原始文本，返回将要输出的 JSON 可序列化字典。"""
        line = line.strip()
        if not line:
            return {"ok": True, "ignored": True, "reason": "empty_line"}
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            return {
                "ok": False,
                "error": f"输入不是合法 JSON（第 {exc.lineno} 行）: {exc.msg}",
            }
        if not isinstance(command, dict):
            return {"ok": False, "error": "命令必须是 JSON 对象，如 "
                                          '{"cmd":"allow","key":"a"}'}
        cmd = command.get("cmd")
        if not isinstance(cmd, str):
            return {"ok": False, "error": "命令缺少字符串字段 cmd"}
        try:
            result = self._dispatch(cmd, command)
        except KeyError as exc:
            result = {"ok": False, "cmd": cmd,
                      "error": f"命令缺少必填字段: {exc}"}
        except (ValueError, TypeError, SnapshotError, OSError) as exc:
            result = {"ok": False, "cmd": cmd, "error": str(exc)}
        if isinstance(result, dict):
            result.setdefault("ok", True)
            result.setdefault("cmd", cmd)
            result.setdefault("now", self.guard.clock.now())
        return result

    def _dispatch(self, cmd: str, command: Dict[str, Any]) -> Dict[str, Any]:
        if cmd == "allow":
            key = self._require_key(command)
            cost = int(command.get("cost", 1))
            return dict(self.guard.allow(key, cost=cost))
        if cmd == "success":
            return dict(self.guard.record_success(self._require_key(command)))
        if cmd == "failure":
            return dict(self.guard.record_failure(self._require_key(command)))
        if cmd == "state":
            return dict(self.guard.get_state(self._require_key(command)))
        if cmd == "stats":
            if "key" in command:
                return dict(self.guard.get_state(self._require_key(command)))
            return {"stats": self.guard.get_stats()}
        if cmd == "reset":
            return dict(self.guard.reset(self._require_key(command)))
        if cmd == "tick":
            delta = float(command.get("delta", 1))
            return {"now": self.guard.tick(delta), "delta": delta}
        if cmd == "now":
            return {"now": self.guard.clock.now()}
        if cmd == "save":
            path = self._require_path(command)
            self.guard.save(path)
            return {"saved": path}
        if cmd == "load":
            path = self._require_path(command)
            # 逻辑时钟不回退：快照时钟早于当前时钟会抛 SnapshotError。
            self.guard = Guard.load(path, clock=self.guard.clock)
            return {"loaded": path, "now": self.guard.clock.now()}
        if cmd == "dump":
            return dict(self.guard.to_dict())
        return {"ok": False, "error": f"未知命令: {cmd!r}（支持 allow/success/"
                                      "failure/state/stats/reset/save/load/"
                                      "dump/tick/now）"}

    @staticmethod
    def _require_key(command: Dict[str, Any]) -> str:
        key = command.get("key")
        if not isinstance(key, str) or key == "":
            raise ValueError("key 必须是非空字符串")
        return key

    @staticmethod
    def _require_path(command: Dict[str, Any]) -> str:
        path = command.get("path")
        if not isinstance(path, str) or path == "":
            raise ValueError("path 必须是非空字符串")
        return path


def run(
    guard: Guard,
    in_stream: IO[str],
    out_stream: IO[str],
) -> int:
    """从 ``in_stream`` 逐行读命令，把 JSON 结果逐行写到 ``out_stream``。

    返回进程退出码（始终为 0；单条命令的失败体现在该行的 ``error`` 字段）。
    """
    runner = CommandRunner(guard)
    for line in in_stream:
        result = runner.handle(line)
        out_stream.write(json.dumps(result, ensure_ascii=False, sort_keys=True))
        out_stream.write("\n")
        out_stream.flush()
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    """进程入口：解析参数、强制 UTF-8 标准流后进入命令循环。"""
    args = make_parser().parse_args(argv)
    guard = build_guard(args)
    try:
        sys.stdin.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    return run(guard, sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
