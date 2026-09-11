"""目录快照与三方合并内核的命令行入口。

只用 Python 标准库。所有命令的输入输出都是 JSON：

    python main.py --store snapshots.json init --max-entries 10000
    python main.py root --entries tree.json [--id root]
    python main.py create --parent root --entries tree.json [--id snap-7]
    python main.py list
    python main.py show --id snap-1
    python main.py ancestor --a snap-2 --b snap-3
    python main.py diff --from snap-1 --to snap-2
    python main.py merge --ours snap-2 --theirs snap-3 [--base snap-1]
    python main.py validate --entries tree.json

entries 文件格式（JSON）：

    {
      "entries": {
        "/":          {"kind": "dir", "size": 0, "mode": 448},
        "/etc":       {"kind": "dir", "size": 0, "mode": 448},
        "/etc/hosts": {"kind": "file", "content_hash": "abc",
                       "size": 12, "mode": 384}
      }
    }

成功时把结果 JSON 打到 stdout，退出码 0；失败时打印
``{"error": "...", "type": "..."}`` 到 stdout，退出码 1。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Dict, Optional

from snapshot_kernel import (
    AncestorNotFoundError,
    Entry,
    KernelError,
    LimitExceededError,
    SnapshotNotFoundError,
    SnapshotStore,
    ValidationError,
    SerializationError,
    entry_from_dict,
    snapshot_to_dict,
)

DEFAULT_STORE_PATH = "snapshots.json"


# ---------------------------------------------------------------------------
# 输入解析
# ---------------------------------------------------------------------------


def parse_entries_payload(data: object) -> Dict[str, Entry]:
    """解析 entries JSON 负载。

    接受两种形态：
      * ``{"entries": {path: {entry...}, ...}}``（推荐）；
      * 直接的 ``{path: {entry...}, ...}`` 映射。
    """
    if not isinstance(data, dict):
        raise ValidationError("entries 文件顶层必须是 JSON 对象")
    mapping = data["entries"] if "entries" in data else data
    if not isinstance(mapping, dict):
        raise ValidationError("entries 必须是 path -> 条目 的 JSON 对象")
    entries: Dict[str, Entry] = {}
    for path, raw in mapping.items():
        if not isinstance(raw, dict):
            raise ValidationError("条目必须是 JSON 对象", path=path)
        payload = dict(raw)
        payload.setdefault("path", path)
        entries[path] = entry_from_dict(payload, path_hint=path)
    return entries


def load_entries_file(path: str) -> Dict[str, Entry]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise SerializationError(f"entries 文件不存在: {path}")
    except json.JSONDecodeError as exc:
        raise SerializationError(
            f"entries 文件不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}"
        )
    return parse_entries_payload(data)


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------


def emit(payload: dict) -> None:
    # ensure_ascii=True：stdout 在 Windows 上可能是 GBK 控制台，
    # 纯 ASCII 的 JSON 对任何编码环境都安全，程序化解析也完全无损。
    json.dump(payload, sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")


def fail(exc: Exception) -> int:
    emit({"error": str(exc), "type": type(exc).__name__})
    return 1


# ---------------------------------------------------------------------------
# 存储加载
# ---------------------------------------------------------------------------


def load_store(path: str) -> SnapshotStore:
    return SnapshotStore.load(path)


# ---------------------------------------------------------------------------
# 子命令实现
# ---------------------------------------------------------------------------


def cmd_init(store_path: str, args: argparse.Namespace) -> dict:
    if os.path.exists(store_path) and not args.force:
        raise KernelError(
            f"存储文件已存在: {store_path}（加 --force 可覆盖重新初始化）"
        )
    store = SnapshotStore(
        max_entries=args.max_entries,
        max_snapshots=args.max_snapshots,
        initial_time=0,
    )
    store.save(store_path)
    return {
        "status": "ok",
        "store": store_path,
        "max_entries": store.max_entries,
        "max_snapshots": store.max_snapshots,
    }


def cmd_root(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    entries = load_entries_file(args.entries)
    snap = store.create_snapshot(None, entries, snap_id=args.id)
    store.save(store_path)
    return {"status": "ok", "snapshot": snapshot_to_dict(snap)}


def cmd_create(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    entries = load_entries_file(args.entries)
    snap = store.create_snapshot(args.parent, entries, snap_id=args.id)
    store.save(store_path)
    return {"status": "ok", "snapshot": snapshot_to_dict(snap)}


def cmd_list(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    return {
        "snapshots": [
            {
                "snap_id": s.snap_id,
                "parent_id": s.parent_id,
                "logical_time": s.logical_time,
                "entry_count": len(s.entries),
            }
            for s in store.all_snapshots()
        ]
    }


def cmd_show(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    return {"snapshot": snapshot_to_dict(store.get(args.id))}


def cmd_ancestor(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    snap = store.find_common_ancestor(args.a, args.b)
    return {"a": args.a, "b": args.b, "common_ancestor": snap.snap_id}


def cmd_diff(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    changes = store.diff(args.src, args.dst)
    return {"from": args.src, "to": args.dst, "changes": changes.to_dict()}


def cmd_merge(store_path: str, args: argparse.Namespace) -> dict:
    store = load_store(store_path)
    if args.base is not None:
        result = store.three_way_merge(args.base, args.ours, args.theirs)
    else:
        result = store.merge(args.ours, args.theirs)

    payload: dict = {"status": "ok", "merge": result.to_dict()}

    if args.commit_as:
        if result.has_conflicts:
            raise KernelError(
                "合并存在 "
                + str(len(result.conflicts))
                + " 个冲突，拒绝提交；请解决冲突后再创建快照"
            )
        parent = args.commit_parent
        if parent is None:
            # 默认挂在 ours 之下。
            parent = args.ours
        snap = store.create_snapshot(
            parent, result.entries, snap_id=args.commit_as
        )
        store.save(store_path)
        payload["committed"] = snapshot_to_dict(snap)
    return payload


def cmd_validate(store_path: str, args: argparse.Namespace) -> dict:
    entries = load_entries_file(args.entries)
    # parse + 内核结构校验（重复路径、父目录缺失等）。
    from snapshot_kernel import validate_entry_set

    validate_entry_set(entries)
    return {"status": "ok", "entry_count": len(entries)}


# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------


class JsonArgumentParser(argparse.ArgumentParser):
    """用法错误时也输出 {\"error\": ...}，退出码 2。"""

    def error(self, message: str) -> None:
        emit({"error": f"参数错误: {message}", "type": "ArgumentError"})
        sys.exit(2)


def build_parser() -> JsonArgumentParser:
    parser = JsonArgumentParser(
        prog="main.py", description="目录快照与三方合并内核（JSON CLI）"
    )
    parser.add_argument(
        "--store",
        default=DEFAULT_STORE_PATH,
        help=f"快照存储文件路径（默认 {DEFAULT_STORE_PATH}）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="初始化一个空存储")
    p_init.add_argument("--max-entries", type=int, default=None)
    p_init.add_argument("--max-snapshots", type=int, default=None)
    p_init.add_argument(
        "--force", action="store_true", help="覆盖已存在的存储文件"
    )
    p_init.set_defaults(handler=cmd_init)

    p_root = sub.add_parser("root", help="创建根快照（parent 为 null）")
    p_root.add_argument("--entries", required=True, help="entries JSON 文件")
    p_root.add_argument("--id", default=None, help="显式指定 snap_id")
    p_root.set_defaults(handler=cmd_root)

    p_create = sub.add_parser("create", help="在父快照下创建新快照")
    p_create.add_argument("--parent", required=True, help="父快照 id")
    p_create.add_argument("--entries", required=True, help="entries JSON 文件")
    p_create.add_argument("--id", default=None, help="显式指定 snap_id")
    p_create.set_defaults(handler=cmd_create)

    p_list = sub.add_parser("list", help="列出全部快照")
    p_list.set_defaults(handler=cmd_list)

    p_show = sub.add_parser("show", help="显示某个快照的完整内容")
    p_show.add_argument("--id", required=True)
    p_show.set_defaults(handler=cmd_show)

    p_anc = sub.add_parser("ancestor", help="查找两个快照的最近共同祖先")
    p_anc.add_argument("--a", required=True)
    p_anc.add_argument("--b", required=True)
    p_anc.set_defaults(handler=cmd_ancestor)

    p_diff = sub.add_parser("diff", help="计算两个快照之间的变更集")
    p_diff.add_argument("--from", dest="src", required=True)
    p_diff.add_argument("--to", dest="dst", required=True)
    p_diff.set_defaults(handler=cmd_diff)

    p_merge = sub.add_parser("merge", help="三方合并（默认自动查找共同祖先）")
    p_merge.add_argument("--ours", required=True)
    p_merge.add_argument("--theirs", required=True)
    p_merge.add_argument(
        "--base", default=None, help="显式指定共同祖先；缺省时自动查找"
    )
    p_merge.add_argument(
        "--commit-as",
        default=None,
        help="无冲突时把合并结果提交为新快照，使用该 snap_id",
    )
    p_merge.add_argument(
        "--commit-parent",
        default=None,
        help="提交时挂载的父快照（默认 ours）",
    )
    p_merge.set_defaults(handler=cmd_merge)

    p_val = sub.add_parser("validate", help="仅校验 entries 文件，不写存储")
    p_val.add_argument("--entries", required=True)
    p_val.set_defaults(handler=cmd_validate)

    return parser


def main(argv: Optional[list] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        payload = args.handler(args.store, args)
    except KernelError as exc:
        return fail(exc)
    except FileNotFoundError as exc:
        return fail(KernelError(f"文件不存在: {exc.filename}"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return fail(SerializationError(f"JSON 解析失败: {exc}"))
    emit(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
