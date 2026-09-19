# -*- coding: utf-8 -*-
"""Command-line interface for the offline log-chain verification tool."""
import argparse
import json
import sys

from logchain.adjudication import AdjudicationStore
from logchain.chain import Chain, OK
from logchain.model import Basis
from logchain.storage import load_jsonl, save_jsonl

ADJ_PATH = "adjudications.json"


def _load_chain(args):
    records = load_jsonl(args.file)
    basis = Basis(algorithm=args.algorithm) if args.algorithm else Basis()
    chain = Chain(records, basis)
    chain.verify(full=True)
    return chain


def cmd_verify(args):
    chain = _load_chain(args)
    s = chain.summary()
    print("记录总数: %d" % s["total"])
    print("状态统计: %s" % json.dumps(s["counts"], ensure_ascii=False))
    fault = s["first_fault"]
    if fault:
        impacted = s["impact_range"]
        seqs = [chain.records[i].seq for i in impacted]
        print("首个不一致: 位置 %d (seq=%s), 状态=%s"
              % (fault["index"], fault["seq"], fault["status"]))
        for reason in fault["reasons"]:
            print("  原因: %s" % reason)
        print("影响范围: 位置 %d..%d, 涉及顺序号 %s"
              % (impacted[0], impacted[-1], seqs))
    else:
        print("整条链校验通过。")
    if args.json:
        print(json.dumps(s, ensure_ascii=False, indent=2))
    return 1 if fault else 0


def cmd_list(args):
    chain = _load_chain(args)
    for rec, res in zip(chain.records, chain.results):
        mark = "OK " if res["status"] == OK else "!!!"
        print("%s seq=%-5s %-20s %-12s %s"
              % (mark, rec.seq, rec.timestamp, rec.source, res["status"]))
    return 0


def cmd_adjudicate(args):
    chain = _load_chain(args)
    store = AdjudicationStore(args.store)
    res = next((r for r in chain.results if r["seq"] == args.seq), None)
    if res is None:
        print("找不到 seq=%s 的记录" % args.seq, file=sys.stderr)
        return 2
    rec = chain._find(args.seq)
    store.rule(args.seq, args.verdict, args.note, rec.to_dict(), res["status"])
    print("已记录裁决: seq=%s verdict=%s conclusion=%s"
          % (args.seq, args.verdict, store.rulings[args.seq]["conclusion"]))
    return 0


def cmd_reevaluate(args):
    chain = _load_chain(args)
    store = AdjudicationStore(args.store)
    updated = store.re_evaluate(chain.results)
    print("本次更新的裁决: %s" % (updated or "无(其余裁决保持不变)"))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="离线日志链可信性核查工具")
    p.add_argument("--algorithm", choices=["sha256", "sha1", "md5"],
                   help="覆盖校验依据使用的哈希算法")
    sub = p.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("file", help="JSONL 日志文件")

    pv = sub.add_parser("verify", parents=[common], help="校验整条链")
    pv.add_argument("--json", action="store_true")
    pv.set_defaults(func=cmd_verify)

    pl = sub.add_parser("list", parents=[common], help="查看完整链条")
    pl.set_defaults(func=cmd_list)

    pa = sub.add_parser("adjudicate", parents=[common], help="记录裁决")
    pa.add_argument("seq", type=int)
    pa.add_argument("--verdict", required=True,
                    choices=["tampered", "false_positive", "fixed", "pending"])
    pa.add_argument("--note", default="")
    pa.add_argument("--store", default=ADJ_PATH)
    pa.set_defaults(func=cmd_adjudicate)

    pr = sub.add_parser("reevaluate", parents=[common],
                        help="依据变化后重估裁决结论")
    pr.add_argument("--store", default=ADJ_PATH)
    pr.set_defaults(func=cmd_reevaluate)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
