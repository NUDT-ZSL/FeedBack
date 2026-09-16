"""命令行入口（离线可验收）。

用法：
    python -m fund_allocator.cli validate <file>
    python -m fund_allocator.cli solve    <file> [--out out.json]
    python -m fund_allocator.cli query    <file> [PROJECT_ID]
    python -m fund_allocator.cli cut      <file> PROJECT_ID [NEW_AMOUNT] [--out out.json]

文件格式见 persistence 模块。solve 会读入“场景文件”（可含或不含 plan，
含有的旧 plan 会被覆盖重算），打印方案摘要；--out 把项目、依赖、上限与
新方案整体写回一个文件，可再用 query / validate 验收。
"""

from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from typing import Any, Dict, List

from . import persistence
from .engine import Engine
from .errors import AllocationError


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return str(obj)
    raise TypeError(f"不可序列化的类型 {type(obj).__name__}")


def _print_json(obj: Any) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, indent=2, default=_json_default)
    sys.stdout.write("\n")


def _cmd_validate(args: argparse.Namespace) -> int:
    persistence.load_new(args.file)
    print(f"OK: {args.file} 校验通过")
    return 0


def _cmd_solve(args: argparse.Namespace) -> int:
    engine = persistence.load_new(args.file)
    budget = getattr(engine, "_loaded_budget", None)
    if budget is None:
        budget = engine.plan.budget if engine.plan is not None else None
    if budget is None:
        raise AllocationError("文件缺少 budget，无法求解")
    engine.solve(budget)
    _print_json(engine.query_plan())
    if args.out:
        persistence.save_to(args.out, engine)
        print(f"已保存至 {args.out}", file=sys.stderr)
    return 0


def _cmd_query(args: argparse.Namespace) -> int:
    engine = persistence.load_new(args.file)
    if engine.plan is None:
        raise AllocationError("文件中没有分配方案，请先 solve")
    if args.project_id:
        _print_json(engine.query_project(args.project_id))
    else:
        _print_json(engine.query_plan())
    return 0


def _cmd_cut(args: argparse.Namespace) -> int:
    engine = persistence.load_new(args.file)
    if engine.plan is None:
        raise AllocationError("文件中没有分配方案，请先 solve")
    new_amount = Decimal("0") if args.amount is None else Decimal(args.amount)
    plan, affected = engine.reduce(args.project_id, new_amount)
    result: Dict[str, Any] = {"affected": affected, "plan": engine.query_plan()}
    _print_json(result)
    if args.out:
        persistence.save_to(args.out, engine)
        print(f"已保存至 {args.out}", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fund_allocator", description="离线年度资金分配引擎")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate", help="校验场景/方案文件")
    p.add_argument("file")
    p.set_defaults(func=_cmd_validate)

    p = sub.add_parser("solve", help="按资金上限重新求解")
    p.add_argument("file")
    p.add_argument("--out", help="把完整状态（含新方案）写入该文件")
    p.set_defaults(func=_cmd_solve)

    p = sub.add_parser("query", help="查询方案摘要或单个项目")
    p.add_argument("file")
    p.add_argument("project_id", nargs="?", default=None)
    p.set_defaults(func=_cmd_query)

    p = sub.add_parser("cut", help="削减/取消项目拨款，仅重算下游")
    p.add_argument("file")
    p.add_argument("project_id")
    p.add_argument("amount", nargs="?", default=None, help="新金额（缺省 0 = 取消）")
    p.add_argument("--out", help="把削减后的完整状态写入该文件")
    p.set_defaults(func=_cmd_cut)

    return parser


def main(argv: List[str] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except AllocationError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
