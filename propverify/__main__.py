"""命令行入口：python -m propverify check CONFIG.json [--json OUT.json]"""

from __future__ import annotations

import argparse
import json
import sys

from .errors import SpecError
from .loader import load_config
from .report import build_report, render_text
from .runner import Runner


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="propverify", description="离线属性验证工具")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="按配置生成输入并判定全部不变量")
    check.add_argument("config", help="JSON 配置文件路径")
    check.add_argument("--json", dest="json_out", default=None, help="把机器可读报告写入该文件")
    args = parser.parse_args(argv)

    try:
        with open(args.config, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        registry, cfg = load_config(data)
    except SpecError as exc:
        print(f"配置被拒绝: {exc}", file=sys.stderr)
        return 2
    except (OSError, json.JSONDecodeError) as exc:
        print(f"无法读取配置: {exc}", file=sys.stderr)
        return 2

    runner = Runner(registry, cfg).run()
    report = build_report(runner)
    print(render_text(report))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
    failed = sum(i["fail"] for i in report["invariants"].values())
    conflicts = sum(i["conflict"] for i in report["invariants"].values())
    return 1 if failed or conflicts else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
