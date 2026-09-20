# -*- coding: utf-8 -*-
"""命令行入口：加载清单、连续改动、查看影响面与缓存复用。"""
import argparse
import json
import os
import sys

from . import model
from .engine import Analysis
from .report import print_mutation_report, print_report

STATE_FILE = ".depviz-state.json"


def _load_state():
    if not os.path.exists(STATE_FILE):
        sys.exit("尚未加载清单，请先运行: python -m depviz load <清单.json>")
    with open(STATE_FILE, "r", encoding="utf-8") as fh:
        return model.parse_manifest(json.load(fh))


def _save_state(modules):
    with open(STATE_FILE, "w", encoding="utf-8") as fh:
        json.dump(model.dump_manifest(modules), fh,
                  ensure_ascii=False, indent=2)


def _require_module(modules, mid):
    if mid not in modules:
        sys.exit("模块不存在: %s" % mid)


def _mutate(title, origin, apply_fn):
    """加载状态 -> 改动 -> 保存 -> 完整重算 -> 输出影响面报告。"""
    modules = _load_state()
    before = Analysis(modules)
    before_deps = {m: list(mod.deps) for m, mod in modules.items()}
    apply_fn(modules)
    _save_state(modules)
    after = Analysis(modules)
    print_mutation_report(title, before, after, origin, before_deps)


def cmd_analyze(args):
    print_report(Analysis(model.load_manifest(args.manifest)))


def cmd_load(args):
    modules = model.load_manifest(args.manifest)
    _save_state(modules)
    print("已加载 %d 个模块。" % len(modules))
    print_report(Analysis(modules))


def cmd_status(args):
    print_report(Analysis(_load_state()))


def cmd_set_fingerprint(args):
    def apply(mods):
        _require_module(mods, args.module)
        mods[args.module].fingerprint = args.fingerprint
    _mutate("指纹变更: %s -> %s" % (args.module, args.fingerprint),
            args.module, apply)


def cmd_add_dep(args):
    def apply(mods):
        _require_module(mods, args.module)
        if args.dep in mods[args.module].deps:
            sys.exit("%s 已依赖 %s，无需重复添加" % (args.module, args.dep))
        mods[args.module].deps.append(args.dep)
    _mutate("新增依赖: %s -> %s" % (args.module, args.dep),
            args.module, apply)


def cmd_remove_dep(args):
    def apply(mods):
        _require_module(mods, args.module)
        if args.dep not in mods[args.module].deps:
            sys.exit("%s 并未依赖 %s" % (args.module, args.dep))
        mods[args.module].deps.remove(args.dep)
    _mutate("移除依赖: %s -> %s" % (args.module, args.dep),
            args.module, apply)
def cmd_set_cache(args):
    def apply(mods):
        _require_module(mods, args.module)
        mods[args.module].cache = args.marker
    _mutate("设置缓存标记: %s = %s" % (args.module, args.marker),
            None, apply)


def cmd_clear_cache(args):
    def apply(mods):
        _require_module(mods, args.module)
        mods[args.module].cache = None
    _mutate("清除缓存标记: %s" % args.module, None, apply)


def cmd_mark_built(args):
    """模拟重编：把可构建模块的缓存标记更新为当前输入签名。"""
    modules = _load_state()
    ana = Analysis(modules)
    targets = args.modules or [m for m, v in ana.verdicts.items()
                               if v[0] == "rebuild"]
    done, skipped = [], []
    for m in targets:
        _require_module(modules, m)
        status, reason = ana.verdicts[m]
        if status in ("cyclic", "untrustworthy"):
            skipped.append((m, reason))
            continue
        modules[m].cache = ana.signatures[m]
        done.append(m)
    _save_state(modules)
    if done:
        print("已重编并更新缓存标记: %s" % ", ".join(sorted(done)))
    for m, reason in skipped:
        print("跳过 %s（%s）" % (m, reason))
    if not done and not skipped:
        print("没有需要重编的模块。")
    print_report(Analysis(modules))


def cmd_show(args):
    modules = _load_state()
    _require_module(modules, args.module)
    ana = Analysis(modules)
    mod = modules[args.module]
    m = args.module
    print("模块: %s" % m)
    print("  内容指纹: %s" % mod.fingerprint)
    print("  直接依赖: %s" % (", ".join(mod.deps) if mod.deps else "无"))
    trans = sorted(ana.trans_deps.get(m, []))
    print("  传递依赖: %s" % (", ".join(trans) if trans else "无"))
    print("  输入签名: %s" % ana.signatures.get(m, "（不可用）"))
    print("  缓存标记: %s" % (mod.cache or "无"))
    dependents = sorted(x for x, ds in ana.edges.items() if m in ds)
    print("  直接被依赖: %s" % (", ".join(dependents) or "无"))
    status, reason = ana.verdicts[m]
    print("  结论: %s - %s" % (status, reason))


def build_parser():
    p = argparse.ArgumentParser(
        prog="depviz",
        description="多模块构建依赖推演工具（本地离线运行）")
    sub = p.add_subparsers(dest="cmd")
    sub.required = True

    sp = sub.add_parser("analyze", help="对清单做一次完整分析（不保存状态）")
    sp.add_argument("manifest")
    sp.set_defaults(func=cmd_analyze)

    sp = sub.add_parser("load", help="加载清单并初始化工作区状态")
    sp.add_argument("manifest")
    sp.set_defaults(func=cmd_load)

    sp = sub.add_parser("status", help="查看当前构建顺序、结论与缓存复用情况")
    sp.set_defaults(func=cmd_status)

    sp = sub.add_parser("set-fingerprint",
                        help="修改某模块的内容指纹并查看影响面")
    sp.add_argument("module")
    sp.add_argument("fingerprint")
    sp.set_defaults(func=cmd_set_fingerprint)

    sp = sub.add_parser("add-dep",
                        help="为模块新增依赖（目标可不存在，用于推演缺失场景）")
    sp.add_argument("module")
    sp.add_argument("dep")
    sp.set_defaults(func=cmd_add_dep)

    sp = sub.add_parser("remove-dep", help="移除模块的某个依赖")
    sp.add_argument("module")
    sp.add_argument("dep")
    sp.set_defaults(func=cmd_remove_dep)

    sp = sub.add_parser("set-cache", help="设置模块的缓存产物标记")
    sp.add_argument("module")
    sp.add_argument("marker")
    sp.set_defaults(func=cmd_set_cache)

    sp = sub.add_parser("clear-cache", help="清除模块的缓存产物标记")
    sp.add_argument("module")
    sp.set_defaults(func=cmd_clear_cache)

    sp = sub.add_parser("mark-built",
                        help="模拟重编：把可构建模块的缓存标记更新为当前签名")
    sp.add_argument("modules", nargs="*")
    sp.set_defaults(func=cmd_mark_built)

    sp = sub.add_parser("show", help="查看单个模块的详情与结论依据")
    sp.add_argument("module")
    sp.set_defaults(func=cmd_show)
    return p


def main(argv=None):
    # Windows 控制台默认代码页可能不是 UTF-8，显式统一输出编码
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    args.func(args)
