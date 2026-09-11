"""压缩前缀树（radix tree）前缀索引内核。

用于配置中心 / 服务发现场景：上游不断注册、注销带字符串键的条目，
支持按前缀快速列举、按最长公共前缀分组统计、以及从磁盘快照恢复整棵树。

仅依赖 Python 标准库。

核心概念
--------
- :class:`Entry`：一条注册条目，由 ``(key, owner)`` 唯一标识。
- :class:`RadixIndex`：压缩前缀树索引。每个节点存一段公共前缀（而非单个
  字符），条目挂在“完整路径恰好等于其 key”的节点上，节点内条目按 owner
  升序排列。
- 路径压缩不变量：除根节点外，不存在“自身不挂条目且只有一个孩子”的中间
  节点。插入与删除后都会维护该不变量，可用 :meth:`RadixIndex.assert_invariants`
  主动校验。

策略（详见 README）
-------------------
- 覆盖策略：同一 ``(key, owner)`` 重复注册时，后注册覆盖先注册，
  返回结果中标记被覆盖的 owner 与旧 value；同一 key 不同 owner 的注册
  互不影响、共存于同一节点。
- 容量策略：构造时指定 ``max_entries`` 后，达到上限再注册**新**条目会被
  拒绝并抛出 :class:`CapacityError`（本次注册不生效，不静默丢弃）；
  覆盖已有 ``(key, owner)`` 不受上限限制。``max_entries=None`` 为精确
  模式（无上限）。
"""

from __future__ import annotations

import bisect
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

__all__ = [
    "MAX_KEY_BYTES",
    "SNAPSHOT_FORMAT",
    "SNAPSHOT_VERSION",
    "RadixIndexError",
    "EntryValidationError",
    "CapacityError",
    "SnapshotError",
    "Entry",
    "InsertResult",
    "RemoveResult",
    "RadixIndex",
]

#: key 的 UTF-8 编码长度上限（字节）。
MAX_KEY_BYTES = 256

#: 快照文件的格式标识与版本号。
SNAPSHOT_FORMAT = "radix-index-snapshot"
SNAPSHOT_VERSION = 1


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class RadixIndexError(Exception):
    """本模块所有异常的基类。"""


class EntryValidationError(RadixIndexError, ValueError):
    """条目字段非法（key 为空 / 超长、owner 为空、value 不可 JSON 序列化等）。"""


class CapacityError(RadixIndexError):
    """注册新条目会超出 max_entries 上限。"""


class SnapshotError(RadixIndexError):
    """快照文件缺失、损坏或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 字段校验
# ---------------------------------------------------------------------------


def _validate_key(key: Any) -> None:
    """校验 key：必须是非空字符串，且 UTF-8 编码后不超过 MAX_KEY_BYTES 字节。"""
    if not isinstance(key, str):
        raise EntryValidationError(
            f"key 必须是字符串，实际为 {type(key).__name__}: {key!r}"
        )
    if not key:
        raise EntryValidationError("key 不能为空字符串")
    n = len(key.encode("utf-8"))
    if n > MAX_KEY_BYTES:
        raise EntryValidationError(
            f"key 的 UTF-8 编码为 {n} 字节，超过上限 {MAX_KEY_BYTES} 字节: {key!r}"
        )


def _validate_owner(owner: Any) -> None:
    """校验 owner：必须是非空字符串。"""
    if not isinstance(owner, str):
        raise EntryValidationError(
            f"owner 必须是字符串，实际为 {type(owner).__name__}: {owner!r}"
        )
    if not owner:
        raise EntryValidationError("owner 不能为空字符串")


def _validate_value(value: Any) -> None:
    """校验 value：必须可被 json.dumps 序列化。"""
    try:
        json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise EntryValidationError(f"value 必须可 JSON 序列化: {exc}") from exc


def _validate_prefix(prefix: Any) -> None:
    """校验查询前缀：必须是字符串（允许为空字符串，表示匹配全部）。"""
    if not isinstance(prefix, str):
        raise EntryValidationError(
            f"prefix 必须是字符串，实际为 {type(prefix).__name__}: {prefix!r}"
        )


# ---------------------------------------------------------------------------
# 条目与结果类型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Entry:
    """一条注册条目。

    :param key: 非空字符串，UTF-8 编码后不超过 256 字节。
    :param value: 任意可 JSON 序列化的对象。
    :param owner: 非空字符串，表示注册方。
    """

    key: str
    value: Any
    owner: str

    def __post_init__(self) -> None:
        _validate_key(self.key)
        _validate_owner(self.owner)
        _validate_value(self.value)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的字典。"""
        return {"key": self.key, "owner": self.owner, "value": self.value}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Entry":
        """从字典反序列化（字段缺失或非法时抛出相应异常）。"""
        if not isinstance(data, dict):
            raise EntryValidationError(f"条目必须是 JSON 对象: {data!r}")
        for field_name in ("key", "owner", "value"):
            if field_name not in data:
                raise EntryValidationError(f"条目缺少字段 {field_name!r}: {data!r}")
        return cls(key=data["key"], value=data["value"], owner=data["owner"])


@dataclass(frozen=True)
class InsertResult:
    """insert 的返回结果。

    :param overwritten: 是否覆盖了同 ``(key, owner)`` 的旧注册。
    :param previous_owner: 被覆盖条目的 owner（未覆盖时为 None）。
    :param previous_value: 被覆盖条目的旧 value（未覆盖时为 None）。
    :param size: 操作完成后索引中的条目总数。
    """

    key: str
    owner: str
    overwritten: bool
    previous_owner: Optional[str]
    previous_value: Any
    size: int

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的字典。"""
        return {
            "key": self.key,
            "owner": self.owner,
            "overwritten": self.overwritten,
            "previous_owner": self.previous_owner,
            "previous_value": self.previous_value,
            "size": self.size,
        }


@dataclass(frozen=True)
class RemoveResult:
    """remove 的返回结果。

    :param removed: 是否确实移除了一条条目。
    :param entry: 被移除的条目（未移除时为 None）。
    :param reason: 未移除时的原因说明（移除成功时为 None）。
    :param size: 操作完成后索引中的条目总数。
    """

    removed: bool
    key: str
    owner: str
    entry: Optional[Entry]
    reason: Optional[str]
    size: int

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的字典。"""
        return {
            "removed": self.removed,
            "key": self.key,
            "owner": self.owner,
            "entry": self.entry.to_dict() if self.entry is not None else None,
            "reason": self.reason,
            "size": self.size,
        }


# ---------------------------------------------------------------------------
# 压缩前缀树节点
# ---------------------------------------------------------------------------


class _Node:
    """压缩前缀树节点。

    - ``segment``：本节点相对父节点的前缀段。根节点为空字符串，其余节点
      必须非空。
    - ``entries``：完整路径恰好等于本节点路径的所有条目（同一 key、不同
      owner），按 owner 升序排列。
    - ``children``：孩子节点，按孩子 segment 的首字符索引（首字符互不相同，
      保证孩子前缀不重叠）。
    """

    __slots__ = ("segment", "entries", "children")

    def __init__(self, segment: str) -> None:
        self.segment = segment
        self.entries: List[Entry] = []
        self.children: Dict[str, "_Node"] = {}


def _common_prefix_len(a: str, b: str) -> int:
    """返回两个字符串的最长公共前缀长度（按字符计）。"""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


# ---------------------------------------------------------------------------
# 索引本体
# ---------------------------------------------------------------------------


class RadixIndex:
    """压缩前缀树前缀索引。

    :param max_entries: 条目总数上限。``None`` 表示精确模式（无上限）；
        达到上限后注册**新**条目会抛出 :class:`CapacityError`，覆盖已有
        ``(key, owner)`` 不受限制。
    """

    def __init__(self, max_entries: Optional[int] = None) -> None:
        if max_entries is not None:
            if not isinstance(max_entries, int) or isinstance(max_entries, bool):
                raise ValueError(
                    f"max_entries 必须是 int 或 None，实际为 {max_entries!r}"
                )
            if max_entries < 0:
                raise ValueError(f"max_entries 不能为负数: {max_entries}")
        self.max_entries = max_entries
        self._root = _Node("")
        self._size = 0

    # -- 基本属性 ----------------------------------------------------------

    def __len__(self) -> int:
        """返回索引中的条目总数。"""
        return self._size

    # -- 注册 --------------------------------------------------------------

    def insert(self, key: str, value: Any, owner: str) -> InsertResult:
        """注册一条条目。

        同一 ``(key, owner)`` 重复注册时覆盖旧 value，返回结果标记被覆盖的
        owner 与旧 value；新条目在达到 ``max_entries`` 上限时抛出
        :class:`CapacityError`，本次注册不生效。

        :raises EntryValidationError: 字段非法。
        :raises CapacityError: 超出容量上限。
        """
        entry = Entry(key=key, value=value, owner=owner)  # 统一做字段校验

        node = self._find_node(key)
        if node is not None:
            idx = self._entry_index(node, owner)
            if idx is not None:
                previous = node.entries[idx]
                node.entries[idx] = entry
                return InsertResult(
                    key=key,
                    owner=owner,
                    overwritten=True,
                    previous_owner=previous.owner,
                    previous_value=previous.value,
                    size=self._size,
                )

        if self.max_entries is not None and self._size >= self.max_entries:
            raise CapacityError(
                f"条目数已达上限 max_entries={self.max_entries}，"
                f"拒绝注册 key={key!r} owner={owner!r}（本次注册未生效）"
            )

        node = self._insert_path(key)
        pos = bisect.bisect_left([e.owner for e in node.entries], owner)
        node.entries.insert(pos, entry)
        self._size += 1
        return InsertResult(
            key=key,
            owner=owner,
            overwritten=False,
            previous_owner=None,
            previous_value=None,
            size=self._size,
        )

    def _insert_path(self, key: str) -> _Node:
        """沿树下行，必要时分裂节点，返回 key 应挂载的节点。"""
        node = self._root
        rest = key
        while rest:
            child = node.children.get(rest[0])
            if child is None:
                fresh = _Node(rest)
                node.children[rest[0]] = fresh
                return fresh
            seg = child.segment
            common = _common_prefix_len(seg, rest)
            if common == len(seg):
                # 整段匹配，继续下行
                node = child
                rest = rest[common:]
                continue
            # 公共部分短于孩子段：在孩子中间分裂出新的中间节点
            mid = _Node(seg[:common])
            child.segment = seg[common:]
            mid.children[child.segment[0]] = child
            node.children[seg[0]] = mid  # seg[0] == mid.segment[0]
            if common == len(rest):
                # key 恰好结束在中间节点上
                return mid
            fresh = _Node(rest[common:])
            mid.children[rest[common]] = fresh
            return fresh
        return node

    # -- 注销 --------------------------------------------------------------

    def remove(self, key: str, owner: str) -> RemoveResult:
        """精确移除某个 owner 对某个 key 的注册。

        组合不存在时返回 ``RemoveResult(removed=False, reason=...)``，不静默
        成功、也不抛异常。移除后若节点不再挂条目，会触发路径压缩（叶子回收、
        单子节点合并）。

        :raises EntryValidationError: key 或 owner 非法。
        """
        _validate_key(key)
        _validate_owner(owner)

        node = self._root
        rest = key
        stack: List[Tuple[_Node, str]] = []  # (父节点, 孩子段首字符)
        while rest:
            child = node.children.get(rest[0])
            if child is None or not rest.startswith(child.segment):
                return RemoveResult(
                    removed=False,
                    key=key,
                    owner=owner,
                    entry=None,
                    reason=f"key 未注册: {key!r}",
                    size=self._size,
                )
            stack.append((node, rest[0]))
            node = child
            rest = rest[len(child.segment):]

        idx = self._entry_index(node, owner)
        if idx is None:
            return RemoveResult(
                removed=False,
                key=key,
                owner=owner,
                entry=None,
                reason=f"key {key!r} 下没有 owner {owner!r} 的注册",
                size=self._size,
            )

        entry = node.entries.pop(idx)
        self._size -= 1
        self._compress_after_remove(stack)
        return RemoveResult(
            removed=True, key=key, owner=owner, entry=entry, reason=None, size=self._size
        )

    def _compress_after_remove(self, stack: List[Tuple[_Node, str]]) -> None:
        """删除条目后自底向上维护路径压缩不变量。

        ``stack`` 是从根到目标节点的路径，最后一项是目标节点的父节点与
        目标段首字符。最多发生一次叶子回收加一次父子合并（合并后祖父的
        孩子数不变，无需继续向上）。
        """
        if not stack:
            return  # 目标是根节点，根节点豁免不变量
        parent, first = stack[-1]
        node = parent.children[first]
        if node.entries:
            return  # 节点仍挂有条目，无需压缩
        if not node.children:
            # 空叶子：直接从父节点摘除
            del parent.children[first]
            # 父节点若因此变成“无条目且只有一个孩子”的中间节点，与其孩子合并
            if len(stack) >= 2:
                grand, gfirst = stack[-2]
                pnode = grand.children.get(gfirst)
                if pnode is not None and not pnode.entries and len(pnode.children) == 1:
                    child = next(iter(pnode.children.values()))
                    child.segment = pnode.segment + child.segment
                    grand.children[gfirst] = child
        elif len(node.children) == 1:
            # 无条目且只有一个孩子：与孩子合并（段首字符不变，父索引无需改键）
            child = next(iter(node.children.values()))
            child.segment = node.segment + child.segment
            parent.children[first] = child

    # -- 查询 --------------------------------------------------------------

    def prefix_scan(self, prefix: str) -> List[Entry]:
        """返回所有 key 以 ``prefix`` 开头的条目，按 key 的 UTF-8 字节序升序。

        实现上沿压缩前缀树走到最长匹配节点，再收集其子树条目，不做全量
        扫描。``prefix`` 为空字符串时返回全部条目。同一 key 的多 owner
        条目之间按 owner 升序。

        :raises EntryValidationError: prefix 不是字符串。
        """
        _validate_prefix(prefix)
        node = self._root
        rest = prefix
        while rest:
            child = node.children.get(rest[0])
            if child is None:
                return []
            seg = child.segment
            if len(rest) <= len(seg):
                if not seg.startswith(rest):
                    return []
                node = child  # 前缀结束在段中间，子树整体匹配
                rest = ""
            else:
                if not rest.startswith(seg):
                    return []
                node = child
                rest = rest[len(seg):]

        out: List[Entry] = []
        stack = [node]
        while stack:
            current = stack.pop()
            out.extend(current.entries)
            stack.extend(current.children.values())
        # UTF-8 字节序与码点序一致；同 key 时按 owner 排序保证确定性。
        out.sort(key=lambda e: (e.key.encode("utf-8"), e.owner))
        return out

    def common_prefix_stats(self, prefix: str) -> Dict[str, Any]:
        """对 ``prefix`` 下的条目做最长公共前缀分组统计。

        返回字典包含：

        - ``prefix``：查询前缀；
        - ``lcp`` / ``lcp_length``：该前缀下所有不同 key 的最长公共前缀
          （按字符计）及其长度；
        - ``count``：条目总数（同一 key 多个 owner 分别计数）；
        - ``distinct_keys``：不同 key 的数量；
        - ``owners``：按 owner 分组的条目计数（按 owner 排序）。

        前缀下没有条目时返回全零结果（``lcp`` 为空串），不抛异常。
        """
        entries = self.prefix_scan(prefix)
        owners: Dict[str, int] = {}
        keys = set()
        for e in entries:
            owners[e.owner] = owners.get(e.owner, 0) + 1
            keys.add(e.key)
        if not keys:
            return {
                "prefix": prefix,
                "lcp": "",
                "lcp_length": 0,
                "count": 0,
                "distinct_keys": 0,
                "owners": {},
            }
        ordered = sorted(keys, key=lambda k: k.encode("utf-8"))
        # 字典序最小与最大 key 的公共前缀即全体 key 的最长公共前缀
        lcp_len = _common_prefix_len(ordered[0], ordered[-1])
        lcp = ordered[0][:lcp_len]
        return {
            "prefix": prefix,
            "lcp": lcp,
            "lcp_length": len(lcp),
            "count": len(entries),
            "distinct_keys": len(ordered),
            "owners": dict(sorted(owners.items())),
        }

    def stats(self) -> Dict[str, Any]:
        """返回索引的整体统计：条目数、不同 key 数、节点数、容量上限。"""
        nodes = 0
        keys = 0
        stack = [self._root]
        while stack:
            node = stack.pop()
            nodes += 1
            if node.entries:
                keys += 1
            stack.extend(node.children.values())
        return {
            "entries": self._size,
            "distinct_keys": keys,
            "nodes": nodes,
            "max_entries": self.max_entries,
        }

    # -- 不变量 ------------------------------------------------------------

    def assert_invariants(self) -> None:
        """校验路径压缩不变量与结构约束，违反时抛出 ``AssertionError``。

        校验内容：非根节点段非空；孩子索引键等于孩子段首字符（保证孩子
        前缀互不重叠）；除根外不存在“无条目且只有一个孩子”的中间节点。
        """
        stack: List[Tuple[_Node, bool]] = [(self._root, True)]
        while stack:
            node, is_root = stack.pop()
            if not is_root:
                if not node.segment:
                    raise AssertionError("非根节点的前缀段为空")
                if not node.entries and len(node.children) == 1:
                    raise AssertionError(
                        f"路径压缩不变量被破坏: 段 {node.segment!r} 无条目且只有一个孩子"
                    )
            for first, child in node.children.items():
                if not child.segment or child.segment[0] != first:
                    raise AssertionError(
                        f"孩子索引 {first!r} 与孩子段 {child.segment!r} 的首字符不一致"
                    )
                stack.append((child, False))

    # -- 持久化 ------------------------------------------------------------

    def dump(self) -> Dict[str, Any]:
        """以可 JSON 化的字典导出整棵树（含 max_entries），供调试与快照。"""
        return {
            "format": SNAPSHOT_FORMAT,
            "version": SNAPSHOT_VERSION,
            "max_entries": self.max_entries,
            "root": self._node_to_dict(self._root),
        }

    @staticmethod
    def _node_to_dict(node: _Node) -> Dict[str, Any]:
        return {
            "segment": node.segment,
            "entries": [e.to_dict() for e in node.entries],
            "children": [
                RadixIndex._node_to_dict(child)
                for _, child in sorted(node.children.items())
            ],
        }

    def save(self, path: str) -> None:
        """把整棵树（节点结构、前缀段、挂载条目）写入 JSON 快照文件。

        先写临时文件再原子替换，避免写一半留下损坏的快照。
        """
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(self.dump(), fh, ensure_ascii=False)
        os.replace(tmp_path, path)

    @classmethod
    def load(cls, path: str) -> "RadixIndex":
        """从 JSON 快照文件重建索引，并做完整一致性校验。

        校验内容：格式与版本、节点前缀段非空（根除外）、子节点前缀不重叠、
        路径压缩不变量、条目 key 与节点完整路径一致（蕴含“以节点前缀开头”）、
        owner 非空、同一节点内 owner 不重复、条目数不超过 max_entries。
        文件缺失、不是合法 JSON、字段缺失或校验失败都抛出
        :class:`SnapshotError`，不静默吞掉。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError as exc:
            raise SnapshotError(f"快照文件不存在: {path}") from exc
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"快照文件不是合法 JSON ({path}): {exc}") from exc
        except OSError as exc:
            raise SnapshotError(f"读取快照文件失败 ({path}): {exc}") from exc

        if not isinstance(data, dict):
            raise SnapshotError(f"快照顶层必须是 JSON 对象: {path}")
        if data.get("format") != SNAPSHOT_FORMAT:
            raise SnapshotError(
                f"快照格式标识错误: 期望 {SNAPSHOT_FORMAT!r}，实际为 {data.get('format')!r}"
            )
        if data.get("version") != SNAPSHOT_VERSION:
            raise SnapshotError(
                f"不支持的快照版本: {data.get('version')!r}（当前支持 {SNAPSHOT_VERSION}）"
            )
        max_entries = data.get("max_entries")
        if max_entries is not None and (
            not isinstance(max_entries, int)
            or isinstance(max_entries, bool)
            or max_entries < 0
        ):
            raise SnapshotError(f"快照中的 max_entries 非法: {max_entries!r}")
        if "root" not in data:
            raise SnapshotError("快照缺少字段 'root'")

        index = cls(max_entries=max_entries)
        count = cls._load_node(data["root"], path_prefix="", is_root=True,
                               node=index._root, where="root")
        if max_entries is not None and count > max_entries:
            raise SnapshotError(
                f"快照包含 {count} 条条目，超过其 max_entries={max_entries}"
            )
        index._size = count
        return index

    @classmethod
    def _load_node(
        cls,
        data: Any,
        path_prefix: str,
        is_root: bool,
        node: _Node,
        where: str,
    ) -> int:
        """递归重建节点并校验，返回子树条目总数。"""
        if not isinstance(data, dict):
            raise SnapshotError(f"节点必须是 JSON 对象（位于 {where}）: {data!r}")
        for field_name in ("segment", "entries", "children"):
            if field_name not in data:
                raise SnapshotError(f"节点缺少字段 {field_name!r}（位于 {where}）")

        segment = data["segment"]
        if not isinstance(segment, str):
            raise SnapshotError(f"节点 segment 必须是字符串（位于 {where}）: {segment!r}")
        if is_root:
            if segment != "":
                raise SnapshotError(f"根节点的 segment 必须为空串，实际为 {segment!r}")
        elif not segment:
            raise SnapshotError(f"非根节点的 segment 不能为空（位于 {where}）")
        node.segment = segment
        full_path = path_prefix + segment

        entries = data["entries"]
        if not isinstance(entries, list):
            raise SnapshotError(f"节点 entries 必须是数组（位于 {where}）")
        seen_owners = set()
        for raw in entries:
            try:
                entry = Entry.from_dict(raw)
            except EntryValidationError as exc:
                raise SnapshotError(f"快照条目非法（位于 {where}）: {exc}") from exc
            if entry.key != full_path:
                raise SnapshotError(
                    f"条目 key {entry.key!r} 与节点完整路径 {full_path!r} "
                    f"不一致（位于 {where}）"
                )
            if entry.owner in seen_owners:
                raise SnapshotError(
                    f"节点内 owner {entry.owner!r} 重复（位于 {where}）"
                )
            seen_owners.add(entry.owner)
            node.entries.append(entry)
        node.entries.sort(key=lambda e: e.owner)

        children = data["children"]
        if not isinstance(children, list):
            raise SnapshotError(f"节点 children 必须是数组（位于 {where}）")
        total = len(node.entries)
        for child_data in children:
            child = _Node("")
            child_where = f"{where}/{child_data.get('segment')!r}" if isinstance(
                child_data, dict
            ) else f"{where}/?"
            total += cls._load_node(
                child_data, path_prefix=full_path, is_root=False,
                node=child, where=child_where,
            )
            first = child.segment[0]
            if first in node.children:
                raise SnapshotError(
                    f"子节点前缀重叠: 多个孩子以 {first!r} 开头（位于 {where}）"
                )
            node.children[first] = child

        if not is_root and not node.entries and len(node.children) == 1:
            raise SnapshotError(
                f"路径压缩不变量被破坏: 段 {segment!r} 无条目且只有一个孩子"
                f"（位于 {where}）"
            )
        return total

    # -- 内部工具 ----------------------------------------------------------

    def _find_node(self, key: str) -> Optional[_Node]:
        """返回完整路径恰好等于 key 的节点，不存在时返回 None。"""
        node = self._root
        rest = key
        while rest:
            child = node.children.get(rest[0])
            if child is None or not rest.startswith(child.segment):
                return None
            node = child
            rest = rest[len(child.segment):]
        return node

    @staticmethod
    def _entry_index(node: _Node, owner: str) -> Optional[int]:
        """在节点的有序条目列表中查找 owner，返回下标或 None。"""
        for i, entry in enumerate(node.entries):
            if entry.owner == owner:
                return i
        return None
