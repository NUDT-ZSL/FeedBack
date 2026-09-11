# -*- coding: utf-8 -*-
"""pattern_kernel 的命令行入口。

子命令：
    compile   编译单个模式，输出编译报告（状态数/转移数/占位符列表）
    match     输出第一个命中的模式与字段（pattern_id 升序优先）
    match-all 输出全部命中，按 pattern_id 升序
    extract   对指定 pattern_id 按占位符出现顺序输出字段值
    explain   输出匹配诊断（失败位置与原因）
    stream    从 stdin 流式喂入，输出全部抽取记录
    save      把模式集合保存为快照文件
    stats     输出模式集合的统计信息

模式来源（match/match-all/extract/explain/stream/stats 通用）：
    --pattern ID=PATTERN   可重复；按第一个 '=' 切分
    --snapshot PATH        从快照文件加载
两者可同时使用，--pattern 在快照模式基础上追加。

所有输出为 JSON（stdout）。出错时 stdout 输出 {"error": ..., "error_type": ...}
并以退出码 1 结束。
"""

from __future__ import annotations

import argparse
import json
import sys

from pattern_kernel import (
    DEFAULT_MAX_BUFFER,
    PatternError,
    PatternSet,
    StreamExtractor,
)


def _print(obj):
    print(json.dumps(obj, ensure_ascii=False))


def _build_patternset(args):
    if getattr(args, "snapshot", None):
        ps = PatternSet.load(args.snapshot)
    else:
        ps = PatternSet()
    for spec in getattr(args, "pattern", None) or []:
        if "=" not in spec:
            raise PatternError(
                "invalid --pattern %r: expected form ID=PATTERN" % spec
            )
        pid, text = spec.split("=", 1)
        ps.compile(pid, text)
    return ps


def _add_source_args(parser):
    parser.add_argument(
        "--pattern",
        action="append",
        default=[],
        metavar="ID=PATTERN",
        help="register a pattern (repeatable)",
    )
    parser.add_argument("--snapshot", help="load patterns from a snapshot file")


def _cmd_compile(args):
    ps = PatternSet()
    _print(ps.compile(args.pattern_id, args.pattern))
    return 0


def _cmd_match(args):
    ps = _build_patternset(args)
    _print(ps.match(args.text))
    return 0


def _cmd_match_all(args):
    ps = _build_patternset(args)
    _print(ps.match_all(args.text))
    return 0


def _cmd_extract(args):
    ps = _build_patternset(args)
    _print(ps.extract(args.text, args.pattern_id))
    return 0


def _cmd_explain(args):
    ps = _build_patternset(args)
    _print(ps.explain(args.text, args.pattern_id))
    return 0


def _cmd_stream(args):
    ps = _build_patternset(args)
    extractor = StreamExtractor(ps, max_buffer=args.max_buffer)
    out = []
    if args.chunk_size is not None:
        data = sys.stdin.read()
        for i in range(0, len(data), args.chunk_size):
            out.extend(extractor.feed(data[i : i + args.chunk_size]))
    else:
        for line in sys.stdin:
            out.extend(extractor.feed(line))
    out.extend(extractor.finish())
    _print(out)
    return 0


def _cmd_save(args):
    ps = PatternSet()
    for spec in args.pattern:
        if "=" not in spec:
            raise PatternError(
                "invalid --pattern %r: expected form ID=PATTERN" % spec
            )
        pid, text = spec.split("=", 1)
        ps.compile(pid, text)
    ps.save(args.output)
    _print({"saved": args.output, "pattern_count": len(ps)})
    return 0


def _cmd_stats(args):
    ps = _build_patternset(args)
    _print(ps.stats())
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="text pattern matching and structured extraction kernel CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("compile", help="compile one pattern and print the report")
    p.add_argument("--pattern-id", required=True)
    p.add_argument("--pattern", required=True, help="pattern text")
    p.set_defaults(func=_cmd_compile)

    p = sub.add_parser("match", help="first matching pattern and its fields")
    _add_source_args(p)
    p.add_argument("--text", required=True)
    p.set_defaults(func=_cmd_match)

    p = sub.add_parser("match-all", help="all matching patterns, ascending id")
    _add_source_args(p)
    p.add_argument("--text", required=True)
    p.set_defaults(func=_cmd_match_all)

    p = sub.add_parser("extract", help="field values for one pattern, in order")
    _add_source_args(p)
    p.add_argument("--pattern-id", required=True)
    p.add_argument("--text", required=True)
    p.set_defaults(func=_cmd_extract)

    p = sub.add_parser("explain", help="match diagnostics for one pattern")
    _add_source_args(p)
    p.add_argument("--pattern-id", required=True)
    p.add_argument("--text", required=True)
    p.set_defaults(func=_cmd_explain)

    p = sub.add_parser("stream", help="stream extraction over stdin")
    _add_source_args(p)
    p.add_argument("--max-buffer", type=int, default=DEFAULT_MAX_BUFFER)
    p.add_argument(
        "--chunk-size",
        type=int,
        default=None,
        help="feed stdin in fixed-size chunks instead of line by line",
    )
    p.set_defaults(func=_cmd_stream)

    p = sub.add_parser("save", help="save a pattern set snapshot")
    p.add_argument(
        "--pattern",
        action="append",
        default=[],
        metavar="ID=PATTERN",
        help="register a pattern (repeatable)",
    )
    p.add_argument("--output", required=True, help="snapshot file to write")
    p.set_defaults(func=_cmd_save)

    p = sub.add_parser("stats", help="pattern set statistics")
    _add_source_args(p)
    p.set_defaults(func=_cmd_stats)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except PatternError as exc:
        _print({"error": str(exc), "error_type": type(exc).__name__})
        return 1
    except OSError as exc:
        _print({"error": str(exc), "error_type": type(exc).__name__})
        return 1


if __name__ == "__main__":
    sys.exit(main())
