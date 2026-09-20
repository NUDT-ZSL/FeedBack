# -*- coding: utf-8 -*-
"""命令行入口：status / impact / apply / rebuild / check / show / repl。"""
import argparse
import os
import shlex
import sys

from . import report
from .engine import Analysis
from .impact import compute_impact
from .model import Change, Manifest, ModelError, apply_changes


def _split_pair(text, sep):
    if sep not in text:
        raise argparse.ArgumentTypeError("格式应为 模块%s依赖：%s" % (sep, text))
    left, right = text.split(sep, 1)
    return left.strip(), right.strip()


class _ChangeAction(argparse.Action):
    """按命令行出现顺序收集改动，保证先删后加等次序语义不丢失。"""

    KINDS = {"--fp": "fingerprint", "--add-dep": "add_dep",
             "--remove-dep": "remove_dep"}

    def __call__(self, parser, namespace, values, option_string=None):
        items = getattr(namespace, "change_items", None)
        if items is None:
            items = []
            setattr(namespace, "change_items", items)
        items.append((self.KINDS[option_string], values))


def parse_change_args(change_items):
    """把按顺序收集的改动项解析为 Change 列表。"""
    changes = []
    for kind, item in change_items or []:
        if kind == "fingerprint":
            mid, value = _split_pair(item, "=")
            changes.append(Change("fingerprint", mid, value=value))
        else:
            mid, target = _split_pair(item, ":")
            changes.append(Change(kind, mid, target=target))
    return changes


def build_parser():
    parser = argparse.ArgumentParser(
        prog="depsim",
        description="多模块构建依赖推演工具（本地离线运行）")
    parser.add_argument("--manifest", default="manifest.json",
                        help="模块清单路径（默认 ./manifest.json）")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("status", help="查看构建顺序、成环组与缓存复用状态")
    sub.add_parser("check", help="校验清单（重复标识、缺失依赖、依赖环）")
    sub.add_parser("rebuild", help="模拟重编：为必须重编的模块写入新缓存签名")
    sub.add_parser("repl", help="交互模式：连续改动并观察影响")

    show = sub.add_parser("show", help="查看单个模块的详细判定")
    show.add_argument("module", help="模块标识")

    for name, helptext in (("impact", "推演改动影响（不写回清单）"),
                           ("apply", "应用改动、写回清单并输出影响")):
        sp = sub.add_parser(name, help=helptext)
        sp.add_argument("--fp", action=_ChangeAction,
                        metavar="模块=新指纹", help="修改模块内容指纹，可重复")
        sp.add_argument("--add-dep", action=_ChangeAction,
                        metavar="模块:依赖", help="新增依赖声明，可重复")
        sp.add_argument("--remove-dep", action=_ChangeAction,
                        metavar="模块:依赖", help="移除依赖声明，可重复")
    return parser


def _load(path):
    if not os.path.exists(path):
        raise ModelError("清单文件不存在：%s" % path)
    return Manifest.load(path)


def _cmd_status(manifest, _args):
    print(report.format_status(Analysis(manifest)))
    return 0


def _cmd_check(manifest, _args):
    analysis = Analysis(manifest)
    problems = 0
    if analysis.cycle_groups:
        problems += len(analysis.cycle_groups)
        for i, group in enumerate(analysis.cycle_groups, 1):
            print("依赖环 #%d：%s" % (i, ", ".join(group)))
    if analysis.missing:
        problems += len(analysis.missing)
        for mid in sorted(analysis.missing):
            print("依赖缺失：%s -> %s" % (mid, ", ".join(analysis.missing[mid])))
        print("结论不可信的下游模块：%s" % ", ".join(sorted(analysis.untrusted)))
    if problems:
        print("校验发现 %d 类问题" % problems)
        return 1
    print("校验通过：无依赖环、无缺失依赖")
    return 0


def _cmd_show(manifest, args):
    if args.module not in manifest.modules:
        print("模块 %s 不在清单中" % args.module)
        return 1
    print(report.format_module(Analysis(manifest), args.module))
    return 0


def _do_impact(manifest, changes):
    """在克隆上应用改动并推演，返回 (影响, 改动后的清单, 改动说明)。"""
    after = manifest.clone()
    notes = apply_changes(after, changes)
    return compute_impact(manifest, after), after, notes


def _cmd_impact(manifest, args):
    changes = parse_change_args(getattr(args, "change_items", None))
    if not changes:
        print("未指定任何改动（使用 --fp / --add-dep / --remove-dep）")
        return 1
    imp, _after, notes = _do_impact(manifest, changes)
    print(report.format_impact(imp, notes))
    print("")
    print("（推演模式：清单未写回；使用 apply 子命令落盘）")
    return 0


def _cmd_apply(manifest, args, path):
    changes = parse_change_args(getattr(args, "change_items", None))
    if not changes:
        print("未指定任何改动（使用 --fp / --add-dep / --remove-dep）")
        return 1
    imp, after, notes = _do_impact(manifest, changes)
    after.save(path)
    print(report.format_impact(imp, notes))
    print("")
    print("改动已写回 %s" % path)
    return 0


def _do_rebuild(manifest):
    """模拟重编：为所有缓存不可复用的模块写入当前签名，返回重编清单。"""
    analysis = Analysis(manifest)
    rebuilt = []
    for mid in analysis.order:
        if not analysis.statuses[mid].reusable:
            manifest.modules[mid].cache = {"signature": analysis.signatures[mid]}
            rebuilt.append(mid)
    return rebuilt


def _cmd_rebuild(manifest, args, path):
    rebuilt = _do_rebuild(manifest)
    manifest.save(path)
    if rebuilt:
        print("已模拟重编 %d 个模块并更新缓存标记：%s"
              % (len(rebuilt), ", ".join(rebuilt)))
    else:
        print("所有模块缓存均可复用，无需重编")
    return 0


REPL_HELP = """可用命令：
  status                     查看构建顺序、成环组与缓存复用状态
  show <模块>                查看单个模块的详细判定
  check                      校验清单（缺失依赖、依赖环）
  impact <改动...>           推演改动影响（不写回）
  apply <改动...>            应用改动并写回清单，同时输出影响
  rebuild                    模拟重编：为必须重编的模块写入新缓存签名
  save [路径]                保存清单
  load <路径>                加载另一份清单
  help                       显示本帮助
  quit                       退出

改动语法（可一次给多个）：
  fp 模块=新指纹        修改内容指纹
  add-dep 模块:依赖     新增依赖声明
  remove-dep 模块:依赖  移除依赖声明
示例：impact fp core=v2 add-dep app:core
"""


def _parse_repl_changes(tokens):
    changes = []
    i = 0
    while i < len(tokens):
        key = tokens[i]
        if key not in ("fp", "add-dep", "remove-dep") or i + 1 >= len(tokens):
            raise ModelError("无法识别的改动参数：%s（见 help）" % key)
        value = tokens[i + 1]
        if key == "fp":
            mid, fp = _split_pair(value, "=")
            changes.append(Change("fingerprint", mid, value=fp))
        elif key == "add-dep":
            mid, target = _split_pair(value, ":")
            changes.append(Change("add_dep", mid, target=target))
        else:
            mid, target = _split_pair(value, ":")
            changes.append(Change("remove_dep", mid, target=target))
        i += 2
    return changes


def _cmd_repl(manifest, path):
    print("进入交互模式，清单：%s（输入 help 查看命令）" % path)
    while True:
        try:
            line = input("depsim> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("")
            break
        if not line:
            continue
        try:
            tokens = shlex.split(line)
        except ValueError as exc:
            print("解析失败：%s" % exc)
            continue
        cmd, rest = tokens[0], tokens[1:]
        try:
            if cmd in ("quit", "exit"):
                break
            elif cmd == "help":
                print(REPL_HELP)
            elif cmd == "status":
                print(report.format_status(Analysis(manifest)))
            elif cmd == "check":
                _cmd_check(manifest, None)
            elif cmd == "show" and rest:
                if rest[0] in manifest.modules:
                    print(report.format_module(Analysis(manifest), rest[0]))
                else:
                    print("模块 %s 不在清单中" % rest[0])
            elif cmd in ("impact", "apply"):
                changes = _parse_repl_changes(rest)
                if not changes:
                    print("未指定改动，语法见 help")
                    continue
                imp, after, notes = _do_impact(manifest, changes)
                print(report.format_impact(imp, notes))
                if cmd == "apply":
                    manifest = after
                    manifest.save(path)
                    print("改动已写回 %s" % path)
            elif cmd == "rebuild":
                rebuilt = _do_rebuild(manifest)
                manifest.save(path)
                print("已模拟重编 %d 个模块：%s"
                      % (len(rebuilt), ", ".join(rebuilt) or "（无）"))
            elif cmd == "save":
                target = rest[0] if rest else path
                manifest.save(target)
                print("已保存到 %s" % target)
            elif cmd == "load" and rest:
                manifest = _load(rest[0])
                path = rest[0]
                print("已加载 %s（%d 个模块）" % (path, len(manifest.modules)))
            else:
                print("未知命令：%s（输入 help 查看命令）" % cmd)
        except ModelError as exc:
            print("错误：%s" % exc)
    print("已退出交互模式")
    return 0


def main(argv=None):
    args = build_parser().parse_args(argv)
    # 输出被管道捕获时统一用 UTF-8，避免中文在 GBK 管道里乱码
    for stream in (sys.stdout, sys.stderr):
        if not stream.isatty():
            try:
                stream.reconfigure(encoding="utf-8")
            except (AttributeError, ValueError):
                pass
    try:
        if args.command == "repl":
            return _cmd_repl(_load(args.manifest), args.manifest)
        if args.command == "status":
            return _cmd_status(_load(args.manifest), args)
        if args.command == "check":
            return _cmd_check(_load(args.manifest), args)
        if args.command == "show":
            return _cmd_show(_load(args.manifest), args)
        if args.command == "impact":
            return _cmd_impact(_load(args.manifest), args)
        if args.command == "apply":
            return _cmd_apply(_load(args.manifest), args, args.manifest)
        if args.command == "rebuild":
            return _cmd_rebuild(_load(args.manifest), args, args.manifest)
        build_parser().print_help()
        return 2
    except ModelError as exc:
        print("错误：%s" % exc, file=sys.stderr)
        return 1
