#!/usr/bin/env python3
"""命令行入口：微服务指标实时聚合与告警引擎。

批处理示例::

    python main.py --events examples/events.jsonl --rules examples/rules.json \\
        --window-size 60 --group-by service,instance --pretty

交互模式（事件与命令混在标准输入；以 ``:`` 开头的是命令）::

    python main.py --rules examples/rules.json --interactive
    > {"metric_name": "cpu", "value": 99, "timestamp": "2026-09-09T10:00:01Z", ...}
    > :rules examples/more_rules.json      # 运行中动态加载规则
    > :alerts                              # 查看全部告警
    > :query avg --metric cpu              # 查询聚合
    > :quit

仅标准库。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from monitoring.aggregator import AGG_FUNCS, TagFilter, TimeRange
from monitoring.models import parse_timestamp
from monitoring.rules import load_rules
from monitoring.sources import EventSource, FileEventSource, StdinEventSource
from monitoring.engine import MonitoringEngine


# --------------------------------------------------------------------------- #
# 参数解析辅助
# --------------------------------------------------------------------------- #
def parse_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


def parse_tag_filter(text: str | None) -> TagFilter | None:
    """解析 ``service=auth,region=cn-*`` 形式的标签过滤器。"""
    if not text:
        return None
    conditions: dict[str, str] = {}
    for pair in text.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if "=" not in pair:
            raise argparse.ArgumentTypeError(
                f"标签过滤条件必须是 key=pattern 形式: {pair!r}"
            )
        key, pattern = pair.split("=", 1)
        key, pattern = key.strip(), pattern.strip()
        if not key:
            raise argparse.ArgumentTypeError(f"标签过滤条件缺少键: {pair!r}")
        conditions[key] = pattern
    return TagFilter.from_mapping(conditions)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="monitor-engine",
        description="微服务监控：事件时间窗口聚合 + 多维标签索引 + 告警评估（仅标准库）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "-e", "--events",
        help="JSON Lines 事件文件（每行一个事件）；使用 - 表示标准输入（非交互模式）",
    )
    parser.add_argument(
        "-r", "--rules",
        help="告警规则 JSON 文件（数组或 {\"rules\": [...]}）",
    )
    parser.add_argument(
        "-w", "--window-size", type=int, default=60,
        help="报表聚合窗口大小（秒）",
    )
    parser.add_argument(
        "-s", "--slide", type=int, default=None,
        help="报表聚合滑动步长（秒），默认等于窗口大小（固定窗口）",
    )
    parser.add_argument(
        "-g", "--group-by", default="",
        help="报表分组标签，逗号分隔，如 service,instance",
    )
    parser.add_argument(
        "--allowed-lateness", type=int, default=300,
        help="允许的乱序延迟（秒），超过的迟到事件会被丢弃并计数",
    )
    parser.add_argument(
        "-f", "--funcs", default=",".join(AGG_FUNCS),
        help="报表输出的聚合函数，逗号分隔，可选 sum,avg,min,max,count",
    )
    parser.add_argument(
        "--metric", default=None, help="只输出指定指标的聚合结果",
    )
    parser.add_argument(
        "--tag-filter", default=None,
        help="查询用标签过滤，如 service=auth,region=cn-*（支持 * 通配符）",
    )
    parser.add_argument("--start", default=None, help="查询起始时间（ISO 8601，含）")
    parser.add_argument("--end", default=None, help="查询结束时间（ISO 8601，不含）")
    parser.add_argument(
        "-o", "--output", default=None,
        help="结果输出文件；默认打印到标准输出",
    )
    parser.add_argument(
        "--pretty", action="store_true", help="格式化输出 JSON（缩进 2 格）",
    )
    parser.add_argument(
        "-i", "--interactive", action="store_true",
        help="交互模式：从标准输入读取事件和 :命令，支持运行中加载规则",
    )
    return parser


# --------------------------------------------------------------------------- #
# 引擎构造
# --------------------------------------------------------------------------- #
def build_engine(args: argparse.Namespace) -> MonitoringEngine:
    funcs = parse_csv(args.funcs)
    invalid = [f for f in funcs if f not in AGG_FUNCS]
    if invalid:
        raise SystemExit(f"非法聚合函数: {invalid}，可选 {AGG_FUNCS}")

    try:
        engine = MonitoringEngine(
            window_size=args.window_size,
            slide_seconds=args.slide,
            group_by=parse_csv(args.group_by),
            allowed_lateness=args.allowed_lateness,
        )
    except ValueError as exc:
        raise SystemExit(f"窗口参数非法: {exc}") from exc
    rule_errors: list[str] = []
    if args.rules:
        path = Path(args.rules)
        if not path.exists():
            raise SystemExit(f"规则文件不存在: {path}")
        rules, rule_errors = load_rules(path.read_text(encoding="utf-8"))
        engine.load_rules(rules)
    engine._initial_rule_errors = rule_errors  # type: ignore[attr-defined]
    return engine


def build_time_range(args: argparse.Namespace) -> TimeRange | None:
    if not args.start and not args.end:
        return None
    start = parse_timestamp(args.start) if args.start else None
    end = parse_timestamp(args.end) if args.end else None
    return TimeRange(start=start, end=end)


def render_result(
    engine: MonitoringEngine,
    args: argparse.Namespace,
    funcs: Sequence[str],
) -> dict[str, Any]:
    points = engine.query(
        funcs=list(funcs),
        time_range=build_time_range(args),
        tag_filter=parse_tag_filter(args.tag_filter),
        metric_name=args.metric,
    )
    return {
        "summary": {
            "events_received": engine.stats.events_received,
            "events_accepted": engine.stats.events_accepted,
            "events_dropped_late": engine.stats.late_dropped,
            "event_parse_errors": engine.stats.parse_errors,
            "window_size_seconds": engine.query_config.size_seconds,
            "slide_seconds": engine.query_config.slide_seconds,
            "group_by": list(engine.query_config.group_by),
            "allowed_lateness_seconds": engine.query_config.allowed_lateness_seconds,
            "alert_count": len(engine.get_alerts()),
        },
        "rule_errors": getattr(engine, "_initial_rule_errors", [])
        + engine.alert_engine.rule_errors,
        "event_errors": [err.to_dict() for err in engine.errors],
        "aggregations": [point.to_dict() for point in points],
        "alerts": [alert.to_dict() for alert in engine.get_alerts()],
    }


def dump_json(obj: Any, pretty: bool) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None)


# --------------------------------------------------------------------------- #
# 批处理
# --------------------------------------------------------------------------- #
def run_batch(args: argparse.Namespace) -> int:
    engine = build_engine(args)
    funcs = parse_csv(args.funcs)

    try:
        if args.events and args.events != "-":
            source: EventSource = FileEventSource(args.events)
            engine.process_source(source)
        elif not sys.stdin.isatty() or args.events == "-":
            engine.process_source(StdinEventSource())
        else:
            # 没有事件输入（例如只看规则校验）也能正常输出空结果。
            engine.finalize()
    except FileNotFoundError as exc:
        raise SystemExit(f"错误: {exc}") from exc

    result = render_result(engine, args, funcs)
    text = dump_json(result, args.pretty)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)

    # 退出码：0 正常（坏数据只记录不致命）；规则全部非法仍输出，便于排查。
    return 0


# --------------------------------------------------------------------------- #
# 交互模式
# --------------------------------------------------------------------------- #
INTERACTIVE_HELP = """\
命令:
  <一行 JSON>          发送一条指标事件
  :rules <文件路径>     运行中加载/更新规则（同 id 覆盖）
  :rules-inline <JSON> 直接给一条或多条规则 JSON
  :remove <规则id>      删除一条规则
  :rules-list          列出当前规则
  :alerts              输出全部告警（JSON）
  :active              输出当前仍在 firing 的告警
  :query [funcs]       输出当前聚合结果，如 :query avg --metric cpu
  :errors              输出规则/事件错误
  :help                显示本帮助
  :quit / :EOF         结束（结束时冲刷未封口窗口并输出最终报告）
""".strip()


def run_interactive(args: argparse.Namespace) -> int:
    engine = build_engine(args)
    funcs = parse_csv(args.funcs)

    def emit(obj: Any) -> None:
        print(dump_json(obj, False), flush=True)

    emit({"type": "ready", "message": "交互模式就绪，:help 查看命令"})

    def handle_command(line: str) -> bool:
        """处理 : 命令，返回是否退出。"""
        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd in (":quit", ":exit", ":eof"):
            return True
        if cmd == ":help":
            emit({"type": "help", "text": INTERACTIVE_HELP})
        elif cmd == ":rules":
            if not arg:
                emit({"type": "error", "error": "用法: :rules <文件路径>"})
            else:
                try:
                    payload = Path(arg).read_text(encoding="utf-8")
                except OSError as exc:
                    emit({"type": "error", "error": f"读取规则文件失败: {exc}"})
                    return False
                _load_inline(engine, payload, emit)
        elif cmd == ":rules-inline":
            _load_inline(engine, arg, emit)
        elif cmd == ":remove":
            ok = engine.remove_rule(arg) if arg else False
            emit({"type": "removed", "rule_id": arg, "ok": ok})
        elif cmd == ":rules-list":
            emit({"type": "rules", "rules": [r.to_dict() for r in engine.alert_engine.rules]})
        elif cmd == ":alerts":
            emit({"type": "alerts", "alerts": [a.to_dict() for a in engine.get_alerts()]})
        elif cmd == ":active":
            emit({"type": "active", "alerts": engine.alert_engine.active_alerts()})
        elif cmd == ":query":
            emit(_do_query(engine, arg, funcs))
        elif cmd == ":errors":
            emit(
                {
                    "type": "errors",
                    "rule_errors": engine.alert_engine.rule_errors,
                    "event_errors": [e.to_dict() for e in engine.errors],
                }
            )
        else:
            emit({"type": "error", "error": f"未知命令 {cmd}，:help 查看帮助"})
        return False

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        if line.startswith(":"):
            if handle_command(line):
                break
            continue
        # 当作事件处理。
        try:
            event = EventSource.parse_line(line)
        except ValueError as exc:
            engine.stats.parse_errors += 1
            emit({"type": "event_error", "error": str(exc), "raw": line[:200]})
            continue
        engine.stats.events_received += 1
        engine.add_event(event)
        fresh = engine.take_new_alerts()
        for alert in fresh:
            emit({"type": "alert", "alert": alert.to_dict()})

    # EOF：冲刷窗口，补发末窗口产生的告警。
    engine.finalize()
    for alert in engine.take_new_alerts():
        emit({"type": "alert", "alert": alert.to_dict()})
    emit({"type": "final", "report": render_result(engine, args, funcs)})
    return 0


def _load_inline(engine: MonitoringEngine, payload: str, emit: Any) -> None:
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        emit({"type": "error", "error": f"规则 JSON 语法错误: {exc}"})
        return
    before = {r.id for r in engine.alert_engine.rules}
    added, errors = engine.load_rules(parsed)
    after = {r.id for r in engine.alert_engine.rules}
    emit(
        {
            "type": "rules_loaded",
            "loaded": added,
            "new_ids": sorted(after - before),
            "updated_ids": sorted(after & before),
            "errors": errors,
        }
    )


def _do_query(engine: MonitoringEngine, arg: str, default_funcs: Sequence[str]) -> dict[str, Any]:
    """支持 ``:query avg``、``:query avg,sum --metric cpu`` 这类简易语法。"""
    tokens = arg.split()
    funcs: list[str] = list(default_funcs)
    metric = None
    if tokens and not tokens[0].startswith("-"):
        funcs = list(parse_csv(tokens[0]))
        tokens = tokens[1:]
    if "--metric" in tokens:
        idx = tokens.index("--metric")
        if idx + 1 < len(tokens):
            metric = tokens[idx + 1]
    bad = [f for f in funcs if f not in AGG_FUNCS]
    if bad:
        return {"type": "error", "error": f"非法聚合函数 {bad}"}
    points = engine.query(funcs=funcs, metric_name=metric)
    return {
        "type": "query_result",
        "metric": metric,
        "points": [point.to_dict() for point in points],
    }


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #
def main(argv: Sequence[str] | None = None) -> int:
    # Windows 控制台默认 GBK，统一 UTF-8 输出，避免中文乱码。
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        parse_tag_filter(args.tag_filter)  # 提前校验格式
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
    if args.interactive:
        return run_interactive(args)
    return run_batch(args)


if __name__ == "__main__":
    raise SystemExit(main())
