"""增量保存 / 加载 / 版本 diff。

文件格式（``.dtj``，doctree journal）：**逐行 JSON（JSON Lines）**，
每行一条记录，字段 ``type`` 区分：

=================  ============================================================
记录               说明
=================  ============================================================
``header``         首行，固定格式标识与版本号。
``snapshot``       某分段的基准快照（``segment`` 为分段下标，0 号分段即
                   文件基准快照；``base_version`` 必须等于快照内 version）。
``change``         一条变更：``seq``（文件内全局连续序号，从 1 开始）、
                   ``segment``、``base_version``、``version``、``change``。
=================  ============================================================

- 首次 :func:`save` 写 header + 0 号分段快照 + 全部变更；
- 之后对同一路径的 save 只**追加**新分段的快照与新变更记录，不写全量；
- :meth:`~doctree.tree.DocumentTree.rollback` 会开启新分段，新分段的
  ``snapshot`` 记录就是分支的 checkpoint，其 ``base_version`` 指向所回滚到的
  历史版本；
- :func:`load` 逐行解析，严格校验：seq 连续、基准版本衔接、变更可重放、
  引用存在、移动不成环、最终树一致。任何错误都带行号 / 第几条变更，
  绝不静默跳过。
"""

from __future__ import annotations

import copy
import json
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from doctree.exceptions import InvalidChangeError, ValidationError
from doctree.tree import DocumentTree

#: 文件头标识与格式版本。
FORMAT = "doctree-journal"
FORMAT_VERSION = 1

_RECORD_HEADER = "header"
_RECORD_SNAPSHOT = "snapshot"
_RECORD_CHANGE = "change"


# ================================================================ 版本 diff


@dataclass
class VersionDiff:
    """两个版本之间的差异。

    属性：
        v1 / v2: 比较的两个版本号。
        added: v2 相对 v1 新增的 node_id（字典序）。
        removed: v2 相对 v1 删除的 node_id（字典序）。
        moved: 两版本都存在但父节点或兄弟下标变化的节点：
            ``{"node_id", "old_parent_id", "new_parent_id",
               "old_index", "new_index", "old_path", "new_path"}``。
        content_changed: content 发生变化的节点
            ``{"node_id", "old", "new"}``（按 node_id 排序）。
        refs_added / refs_removed: 引用边
            ``{"owner", "target"}``（按字典序）。
    """

    v1: int
    v2: int
    added: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    moved: List[Dict[str, Any]] = field(default_factory=list)
    content_changed: List[Dict[str, Any]] = field(default_factory=list)
    refs_added: List[Dict[str, str]] = field(default_factory=list)
    refs_removed: List[Dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为普通 dict。"""
        return {
            "v1": self.v1,
            "v2": self.v2,
            "added": list(self.added),
            "removed": list(self.removed),
            "moved": list(self.moved),
            "content_changed": list(self.content_changed),
            "refs_added": list(self.refs_added),
            "refs_removed": list(self.refs_removed),
        }

    @classmethod
    def compute(cls, v1: int, v2: int, t1: DocumentTree, t2: DocumentTree) -> "VersionDiff":
        """对两棵分别代表 v1、v2 状态的树计算差异（结果顺序稳定）。"""
        ids1 = set(t1.preorder_ids())
        ids2 = set(t2.preorder_ids())
        added = sorted(ids2 - ids1)
        removed = sorted(ids1 - ids2)

        moved: List[Dict[str, Any]] = []
        content_changed: List[Dict[str, Any]] = []
        for nid in sorted(ids1 & ids2):
            n1, n2 = t1.get_node(nid), t2.get_node(nid)
            old_index = (
                t1.get_node(n1.parent_id).children.index(nid) if n1.parent_id else None
            )
            new_index = (
                t2.get_node(n2.parent_id).children.index(nid) if n2.parent_id else None
            )
            if n1.parent_id != n2.parent_id or old_index != new_index:
                moved.append(
                    {
                        "node_id": nid,
                        "old_parent_id": n1.parent_id,
                        "new_parent_id": n2.parent_id,
                        "old_index": old_index,
                        "new_index": new_index,
                        "old_path": t1.get_path(nid),
                        "new_path": t2.get_path(nid),
                    }
                )
            if n1.content != n2.content:
                content_changed.append({"node_id": nid, "old": n1.content, "new": n2.content})

        edges1 = {
            (owner, target)
            for owner in ids1
            for target in t1.get_node(owner).refs
        }
        edges2 = {
            (owner, target)
            for owner in ids2
            for target in t2.get_node(owner).refs
        }
        refs_added = [
            {"owner": o, "target": t} for o, t in sorted(edges2 - edges1)
        ]
        refs_removed = [
            {"owner": o, "target": t} for o, t in sorted(edges1 - edges2)
        ]
        return cls(
            v1=v1,
            v2=v2,
            added=added,
            removed=removed,
            moved=moved,
            content_changed=content_changed,
            refs_added=refs_added,
            refs_removed=refs_removed,
        )


# ================================================================ 保存


def save(tree: DocumentTree, path: str) -> Dict[str, Any]:
    """增量保存。

    - ``path`` 是当前会话已绑定的日志文件：只追加上次 save 之后的新记录；
    - 否则（新文件 / 另存为）：重写整份日志（header + 各分段快照 +
      全部变更记录），加载方据此即可完整重建。

    返回 ``{"path", "version", "records_written", "mode"}``。
    """
    if not isinstance(path, str) or not path:
        raise ValidationError("save path must be a non-empty string")
    path = os.path.abspath(path)
    if not tree._segments:
        # 从未编辑过：以当前状态建立基准分段，使“先 save 再编辑”也能增量追加。
        tree._ensure_segment()
    segments = tree._journal_segments()
    append_mode = tree.journal_path == path and os.path.exists(path)

    new_records: List[Dict[str, Any]] = []
    if append_mode:
        next_seq = tree._persisted_seq + 1
        # 已写过的分段只追加新 change；新分段先写 snapshot 再写 change。
        for seg_idx, seg in enumerate(segments):
            already = seg.get("persisted", 0)
            snapshot_written = seg.get("snapshot_persisted", False)
            if not snapshot_written:
                base = seg["snapshot"]["version"]
                new_records.append(
                    {
                        "type": _RECORD_SNAPSHOT,
                        "seq": next_seq,
                        "segment": seg_idx,
                        "base_version": base,
                        "snapshot": seg["snapshot"],
                    }
                )
                next_seq += 1
            for wrapper in seg["changes"][already:]:
                new_records.append(_change_record(seg_idx, next_seq, wrapper))
                next_seq += 1
        if new_records:
            _append_lines(path, new_records)
    else:
        records = _build_full_journal(segments)
        _atomic_write_jsonl(path, records)
        new_records = records  # header 也算写入记录数

    # 回写记账。
    persisted_counts = [len(seg["changes"]) for seg in segments]
    last_seq = (tree._persisted_seq + len(new_records)) if append_mode else len(new_records)
    tree._mark_saved(
        path=path,
        last_seq=last_seq,
        persisted_counts=persisted_counts,
        max_version=tree.version,
    )
    return {
        "path": path,
        "version": tree.version,
        "records_written": len(new_records),
        "mode": "append" if append_mode else "full",
    }


def _build_full_journal(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """把所有分段序列化成完整记录列表（含 header），并赋全局连续 seq。"""
    records: List[Dict[str, Any]] = [
        {
            "type": _RECORD_HEADER,
            "seq": 1,
            "format": FORMAT,
            "format_version": FORMAT_VERSION,
        }
    ]
    seq = 2
    if not segments:  # 理论上 save() 已保证至少一个分段，防御性处理。
        raise ValidationError("internal error: no segments to serialize")
    for seg_idx, seg in enumerate(segments):
        base = seg["snapshot"]["version"]
        records.append(
            {
                "type": _RECORD_SNAPSHOT,
                "seq": seq,
                "segment": seg_idx,
                "base_version": base,
                "snapshot": seg["snapshot"],
            }
        )
        seq += 1
        for wrapper in seg["changes"]:
            records.append(_change_record(seg_idx, seq, wrapper))
            seq += 1
    return records


def _empty_snapshot() -> Dict[str, Any]:
    return {"version": 0, "root_id": None, "policy": "cascade", "nodes": {}}


def _change_record(seg_idx: int, seq: int, wrapper: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": _RECORD_CHANGE,
        "seq": seq,
        "segment": seg_idx,
        "base_version": wrapper["base_version"],
        "version": wrapper["version"],
        "change": wrapper["change"],
    }


def _append_lines(path: str, records: List[Dict[str, Any]]) -> None:
    with open(path, "a", encoding="utf-8", newline="\n") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def _atomic_write_jsonl(path: str, records: List[Dict[str, Any]]) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".dtj-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            for record in records:
                fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ================================================================ 加载


def load(path: str) -> DocumentTree:
    """从日志文件重建 :class:`DocumentTree`，全量校验后返回。

    任何损坏（非 JSON、缺字段、seq 不连续、基准版本不匹配、变更引用不存在
    的节点、移动成环、index 越界、最终树不一致等）都抛
    :class:`~doctree.exceptions.InvalidChangeError` 或
    :class:`~doctree.exceptions.ValidationError`，错误信息带行号 / 第几条。
    """
    if not isinstance(path, str) or not path:
        raise ValidationError("load path must be a non-empty string")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise ValidationError(f"cannot read journal {path!r}: {exc}") from exc
    if not lines:
        raise ValidationError(f"journal {path!r} is empty")

    segments: List[Dict[str, Any]] = []
    max_version = 0
    change_seq_seen = 0
    last_seq = 0
    expected_seq = 1
    established_versions: set = set()  # type: ignore[assignment]

    for line_no, raw in enumerate(lines, start=1):
        text = raw.strip()
        if not text:
            raise ValidationError(f"line {line_no}: blank line is not allowed")
        try:
            record = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"line {line_no}: invalid JSON: {exc.msg}") from exc
        if not isinstance(record, dict) or "type" not in record:
            raise ValidationError(f"line {line_no}: record must be an object with 'type'")
        seq = record.get("seq")
        if not isinstance(seq, int) or isinstance(seq, bool):
            raise ValidationError(f"line {line_no}: missing/invalid 'seq'")
        if seq != expected_seq:
            raise InvalidChangeError(
                f"seq {seq} is not consecutive (expected {expected_seq}) "
                f"at line {line_no}",
                change_index=expected_seq - 1,
            )
        expected_seq += 1
        last_seq = seq
        rtype = record["type"]

        if line_no == 1:
            if rtype != _RECORD_HEADER:
                raise ValidationError(f"line 1: first record must be a header, got {rtype!r}")
            if record.get("format") != FORMAT:
                raise ValidationError(f"line 1: unexpected format {record.get('format')!r}")
            if record.get("format_version") != FORMAT_VERSION:
                raise ValidationError(
                    f"line 1: unsupported format_version {record.get('format_version')!r}"
                )
            continue

        if rtype == _RECORD_SNAPSHOT:
            seg_idx = record.get("segment")
            if not isinstance(seg_idx, int) or isinstance(seg_idx, bool) or seg_idx < 0:
                raise ValidationError(f"line {line_no}: invalid segment index")
            if seg_idx != len(segments):
                raise ValidationError(
                    f"line {line_no}: snapshot segment {seg_idx} out of order "
                    f"(expected {len(segments)})"
                )
            snapshot = record.get("snapshot")
            if not isinstance(snapshot, dict):
                raise ValidationError(f"line {line_no}: snapshot record missing snapshot object")
            base = record.get("base_version")
            if not isinstance(base, int) or isinstance(base, bool) or base < 0:
                raise ValidationError(f"line {line_no}: invalid base_version")
            if snapshot.get("version") != base:
                raise ValidationError(
                    f"line {line_no}: snapshot version {snapshot.get('version')} does not "
                    f"match record base_version {base}"
                )
            # 快照本身必须是一棵合法树。
            live = _build_tree_from_snapshot(snapshot, line_no)
            if seg_idx > 0 and base not in established_versions:
                raise ValidationError(
                    f"line {line_no}: segment {seg_idx} branches from unknown version {base}"
                )
            segments.append({"snapshot": copy.deepcopy(snapshot), "changes": [], "_live": live})
            established_versions.add(base)
            max_version = max(max_version, base)

        elif rtype == _RECORD_CHANGE:
            change_seq_seen += 1
            seg_idx = record.get("segment")
            if not isinstance(seg_idx, int) or isinstance(seg_idx, bool) or seg_idx < 0:
                raise ValidationError(f"line {line_no}: invalid segment index")
            if seg_idx >= len(segments):
                raise ValidationError(
                    f"line {line_no}: change for segment {seg_idx} before its snapshot"
                )
            seg = segments[seg_idx]
            live: DocumentTree = seg["_live"]
            base_version = record.get("base_version")
            version = record.get("version")
            if not isinstance(base_version, int) or not isinstance(version, int):
                raise ValidationError(f"line {line_no}: base_version/version must be ints")
            if version in established_versions:
                raise InvalidChangeError(
                    f"duplicate version number {version}",
                    change_index=change_seq_seen - 1,
                )
            expected_base = (
                seg["snapshot"]["version"]
                if not seg["changes"]
                else seg["changes"][-1]["version"]
            )
            if base_version != expected_base:
                raise InvalidChangeError(
                    f"base_version {base_version} does not match replayed state "
                    f"version {expected_base}",
                    change_index=change_seq_seen - 1,
                )
            if version <= base_version:
                raise InvalidChangeError(
                    f"version {version} must be greater than base_version {base_version}",
                    change_index=change_seq_seen - 1,
                )
            change = record.get("change")
            if not isinstance(change, dict):
                raise ValidationError(f"line {line_no}: change record missing change object")
            try:
                live.apply_change(change)
                live.validate()
            except Exception as exc:
                raise InvalidChangeError(
                    f"{exc}",
                    change_index=change_seq_seen - 1,
                ) from exc
            seg["changes"].append(
                {"base_version": base_version, "version": version, "change": copy.deepcopy(change)}
            )
            established_versions.add(version)
            max_version = max(max_version, version)
        else:
            raise ValidationError(f"line {line_no}: unknown record type {rtype!r}")

    if len(lines) == 1:
        # 只有 header：视为空树 version 0（容错；下次 append save 会补写快照）。
        snapshot = _empty_snapshot()
        live = DocumentTree._from_snapshot(snapshot)
        segments = [
            {
                "snapshot": snapshot,
                "changes": [],
                "_live": live,
            }
        ]
        clean_kwargs = {"snapshot_persisted": False}
    else:
        clean_kwargs = {"snapshot_persisted": True}

    if not segments:
        raise ValidationError("journal contains no snapshot records")

    # 活动状态 = 最后一个分段重放后的状态。
    final_seg = segments[-1]
    live = final_seg["_live"]
    live.validate()

    clean_segments = [
        {
            "snapshot": seg["snapshot"],
            "changes": seg["changes"],
            "persisted": len(seg["changes"]),
            **clean_kwargs,
        }
        for seg in segments
    ]
    result = DocumentTree(ref_policy=live.ref_policy)
    result._adopt_segments(
        segments=clean_segments,
        live=live,
        max_version=max_version,
        path=os.path.abspath(path),
        last_seq=last_seq,
    )
    return result


def _build_tree_from_snapshot(snapshot: Dict[str, Any], line_no: int) -> DocumentTree:
    """构造并校验快照，把错误统一加上行号。"""
    try:
        return DocumentTree._from_snapshot(snapshot)
    except Exception as exc:
        raise ValidationError(f"line {line_no}: invalid snapshot: {exc}") from exc
