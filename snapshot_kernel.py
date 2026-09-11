"""目录快照与三方合并内核。

只用 Python 标准库。核心概念：

* :class:`Entry`  —— 目录树中的一个条目（文件或目录）。
* :class:`Snapshot` —— 一棵目录树在某个逻辑时间点的不可变快照。
* :class:`SnapshotStore` —— 维护快照树、逻辑时钟与限额，负责创建快照、
  查找共同祖先、diff、三方合并以及 JSON 持久化。

所有时间戳都是调用方/存储注入的非负整数逻辑时间，不读取墙上时钟，
因此在测试里是确定性的。
"""

from __future__ import annotations

import json
import os
import posixpath
import types
from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional, Tuple

# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class KernelError(Exception):
    """所有内核层错误的基类，错误信息可直接展示给调用方。"""


class ValidationError(KernelError):
    """条目或快照不满足不变量。``path`` 指出问题路径（可能为 None）。"""

    def __init__(self, message: str, path: Optional[str] = None):
        if path is not None:
            message = f"{message} (path={path})"
        super().__init__(message)
        self.path = path


class SnapshotNotFoundError(KernelError):
    """引用了存储中不存在的快照 id。"""


class AncestorNotFoundError(KernelError):
    """两个快照之间找不到共同祖先。"""


class LimitExceededError(KernelError):
    """超出 max_entries / max_snapshots 限额。"""


class SerializationError(KernelError):
    """快照文件损坏、字段缺失或格式不被识别。"""


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------

VALID_KINDS = ("file", "dir")


@dataclass(frozen=True)
class Entry:
    """目录树条目。

    不变量：
      * ``path`` 非空、以 ``/`` 开头、是规范化的绝对路径，不含 ``.`` / ``..``；
      * ``kind`` 为 ``'file'`` 或 ``'dir'``；
      * file 必填非空 ``content_hash``，dir 必须没有 ``content_hash``；
      * ``size`` 为非负整数（布尔值除外，``True``/``False`` 不是合法整数）；
      * ``mode`` 为非负整数。
    """

    path: str
    kind: str
    content_hash: Optional[str] = None
    size: int = 0
    mode: int = 0

    def __post_init__(self) -> None:
        # 规范化后写回：Entry("/a//b") 与 Entry("/a/b") 必须是同一个路径身份，
        # 否则重复路径检测会被不同写法绕过。
        normalized_path = validate_path(self.path)
        object.__setattr__(self, "path", normalized_path)
        validate_entry(self)


@dataclass(frozen=True)
class Snapshot:
    """一棵目录树的不可变快照。"""

    snap_id: str
    parent_id: Optional[str]
    entries: Dict[str, Entry] = field(default_factory=dict)
    logical_time: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.snap_id, str) or not self.snap_id:
            raise ValidationError("snap_id 必须是非空字符串")
        if self.parent_id is not None and not isinstance(self.parent_id, str):
            raise ValidationError("parent_id 必须是字符串或 None")
        if not isinstance(self.entries, dict):
            raise ValidationError("entries 必须是 dict")
        # 快照不可变：拷贝一层并用只读代理封住，外部无法通过遗留引用
        # 或返回的映射 mutate 快照内容。
        object.__setattr__(
            self, "entries", types.MappingProxyType(dict(self.entries))
        )


@dataclass(frozen=True)
class Conflict:
    """三方合并中无法自动裁决的冲突。"""

    path: str
    kind: str  # modify-modify / add-add / delete-modify / modify-delete /
    #            file-dir / parent-dir / orphaned
    base: Optional[str]
    ours: Optional[str]
    theirs: Optional[str]
    message: str

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "kind": self.kind,
            "base": self.base,
            "ours": self.ours,
            "theirs": self.theirs,
            "message": self.message,
        }


@dataclass(frozen=True)
class MergeResult:
    """三方合并结果。

    * ``entries``  —— 合并后的条目（无冲突时构成一棵完整合法的目录树）；
    * ``conflicts`` —— 冲突列表；
    * ``has_conflicts`` —— 是否存在冲突；
    * ``auto_resolved`` —— 被自动裁决的路径及裁决说明；
    * ``orphaned`` —— 因父目录被一方删除而成为孤儿、从结果中剔除的路径。

    当存在冲突时调用方不应直接把 ``entries`` 当作最终目录树落盘；
    每个冲突都带有双方值与可读解释，可用于人工裁决。
    """

    entries: Dict[str, Entry]
    conflicts: List[Conflict] = field(default_factory=list)
    auto_resolved: Dict[str, str] = field(default_factory=dict)
    orphaned: List[str] = field(default_factory=list)
    base_id: Optional[str] = None

    @property
    def has_conflicts(self) -> bool:
        return bool(self.conflicts)

    def to_dict(self) -> dict:
        return {
            "base_id": self.base_id,
            "has_conflicts": self.has_conflicts,
            "entries": {
                path: entry_to_dict(entry)
                for path, entry in sorted(self.entries.items())
            },
            "conflicts": [c.to_dict() for c in self.conflicts],
            "auto_resolved": self.auto_resolved,
            "orphaned": self.orphaned,
        }


# ---------------------------------------------------------------------------
# 路径工具与校验
# ---------------------------------------------------------------------------


def validate_path(path: object) -> str:
    """校验路径，返回规范化后的路径。"""
    if not isinstance(path, str):
        raise ValidationError("path 必须是非空字符串", path=None)
    if not path:
        raise ValidationError("path 不能为空", path=None)
    if not path.startswith("/"):
        raise ValidationError("path 必须以 / 开头的绝对路径", path=path)
    # 先在原始分段上拒绝 . 与 ..，避免 /a/../ 被 normpath 规整成 / 后漏检。
    raw_parts = [segment for segment in path.split("/") if segment]
    for segment in raw_parts:
        if segment in (".", ".."):
            raise ValidationError("path 不能包含 . 或 .. 段", path=path)
    # 路径是逻辑 POSIX 路径，固定用 posixpath 规范化（合并重复斜杠、
    # 去掉尾部斜杠），避免 Windows 上 os.path 把正斜杠转成反斜杠。
    normalized = posixpath.normpath(path)
    # os.path.normpath 在 POSIX 语义下处理正斜杠；Windows 上反斜杠是普通字符，
    # 我们显式禁止它，避免跨平台歧义。
    if "\\" in normalized:
        raise ValidationError("path 不能包含反斜杠", path=path)
    parts = [p for p in normalized.split("/") if p]
    if not parts:
        return "/"
    return "/" + "/".join(parts)


def _is_nonneg_int(value: object) -> bool:
    # bool 是 int 的子类，显式排除。
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def validate_entry(entry: object) -> None:
    """校验单个 :class:`Entry`，不合法时抛 :class:`ValidationError`。"""
    if not isinstance(entry, Entry):
        raise ValidationError("条目必须是 Entry 实例")
    path = validate_path(entry.path)
    if entry.kind not in VALID_KINDS:
        raise ValidationError(
            f"kind 非法：{entry.kind!r}，必须是 {VALID_KINDS} 之一", path=path
        )
    if entry.kind == "file":
        if not isinstance(entry.content_hash, str) or not entry.content_hash:
            raise ValidationError(
                "file 条目必须带非空 content_hash", path=path
            )
    else:
        if entry.content_hash is not None:
            raise ValidationError(
                "dir 条目不能带 content_hash", path=path
            )
    if not _is_nonneg_int(entry.size):
        raise ValidationError("size 必须是非负整数", path=path)
    if not _is_nonneg_int(entry.mode):
        raise ValidationError("mode 必须是非负整数", path=path)


def _parent_path(path: str) -> Optional[str]:
    """返回直接父目录路径；根 ``/`` 没有父目录。"""
    if path == "/":
        return None
    return path.rsplit("/", 1)[0] or "/"


def _ancestor_dirs(path: str) -> List[str]:
    """返回从根到直接父级的全部祖先目录路径（不含自身）。"""
    parents: List[str] = []
    parent = _parent_path(path)
    while parent is not None:
        parents.append(parent)
        if parent == "/":
            break
        parent = _parent_path(parent)
    parents.reverse()
    return parents


def _is_under(child: str, dir_path: str) -> bool:
    """``child`` 是否位于目录 ``dir_path`` 之下（严格子孙）。"""
    if dir_path == "/":
        return child != "/"
    return child.startswith(dir_path + "/")


def validate_entry_set(entries: Dict[str, Entry]) -> None:
    """校验整个条目集合的结构性不变量。

    1. 每个条目自身合法；
    2. 键（dict 的 key）与 ``entry.path`` 一致、路径无重复；
    3. 每个非根路径的每一级父目录都存在，且父级 kind 为 dir；
    4. 目录的子路径不能是文件（file-dir 层级冲突）。
    """
    if not isinstance(entries, Mapping):
        raise ValidationError("entries 必须是 path -> Entry 的映射")

    seen: set = set()
    for key, entry in entries.items():
        key_norm = validate_path(key)
        if not isinstance(entry, Entry):
            raise ValidationError("条目必须是 Entry 实例", path=key_norm)
        validate_entry(entry)
        entry_norm = validate_path(entry.path)
        if key_norm != entry_norm:
            raise ValidationError(
                f"entries 的键 {key_norm!r} 与条目 path {entry_norm!r} 不一致",
                path=key_norm,
            )
        if entry_norm in seen:
            # dict 本身不可能有重复键，但防御路径经不同写法归一化后碰撞，
            # 例如 /a//b 与 /a/b。
            raise ValidationError("路径重复", path=entry_norm)
        seen.add(entry_norm)

    by_path = {validate_path(e.path): e for e in entries.values()}
    for path, entry in sorted(by_path.items()):
        for ancestor in _ancestor_dirs(path):
            parent_entry = by_path.get(ancestor)
            if parent_entry is None:
                raise ValidationError(
                    f"缺少父目录 {ancestor}", path=path
                )
            if parent_entry.kind != "dir":
                raise ValidationError(
                    f"祖先 {ancestor} 是 file，不能作为目录", path=path
                )


# ---------------------------------------------------------------------------
# 序列化
# ---------------------------------------------------------------------------


def entry_to_dict(entry: Entry) -> dict:
    return {
        "path": entry.path,
        "kind": entry.kind,
        "content_hash": entry.content_hash,
        "size": entry.size,
        "mode": entry.mode,
    }


def entry_from_dict(data: object, *, path_hint: Optional[str] = None) -> Entry:
    if not isinstance(data, dict):
        raise SerializationError(
            f"条目必须是 JSON 对象，实际为 {type(data).__name__}"
            + (f" (path={path_hint})" if path_hint else "")
        )
    missing = [
        name for name in ("path", "kind", "size", "mode") if name not in data
    ]
    if "path" not in data and path_hint is not None:
        data = dict(data)
        data["path"] = path_hint
        if "path" in missing:
            missing.remove("path")
    if missing:
        raise SerializationError(
            "条目缺少字段: " + ", ".join(sorted(missing))
            + (f" (path={data.get('path', path_hint)})" if data.get("path", path_hint) else "")
        )
    try:
        return Entry(
            path=data["path"],
            kind=data["kind"],
            content_hash=data.get("content_hash"),
            size=data["size"],
            mode=data["mode"],
        )
    except ValidationError as exc:
        raise SerializationError(f"条目非法: {exc}") from None


def snapshot_to_dict(snap: Snapshot) -> dict:
    return {
        "snap_id": snap.snap_id,
        "parent_id": snap.parent_id,
        "logical_time": snap.logical_time,
        "entries": {
            path: entry_to_dict(entry) for path, entry in sorted(snap.entries.items())
        },
    }


def snapshot_from_dict(data: object) -> Snapshot:
    if not isinstance(data, dict):
        raise SerializationError("快照文件顶层必须是 JSON 对象")
    for name in ("snap_id", "entries"):
        if name not in data:
            raise SerializationError(f"快照缺少字段: {name}")
    entries_raw = data["entries"]
    if not isinstance(entries_raw, dict):
        raise SerializationError("快照 entries 必须是 JSON 对象")
    entries: Dict[str, Entry] = {}
    for key, raw in entries_raw.items():
        entry = entry_from_dict(raw, path_hint=key)
        entries[entry.path] = entry
    snap = Snapshot(
        snap_id=data["snap_id"],
        parent_id=data.get("parent_id"),
        entries=entries,
        logical_time=data.get("logical_time", 0),
    )
    # 加载时同样要满足结构不变量（父目录存在等）。
    validate_entry_set(snap.entries)
    return snap


# ---------------------------------------------------------------------------
# 存储
# ---------------------------------------------------------------------------


@dataclass
class Changeset:
    """从一个快照到另一个快照的最小变更集。

    added     : 目标存在、源不存在（新建文件/目录，含其下整棵新子树）
    removed   : 源存在、目标不存在（含目录级删除下的全部路径）
    modified  : 两边都存在但内容/类型/元数据不同
    """

    added: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    modified: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "added": list(self.added),
            "removed": list(self.removed),
            "modified": list(self.modified),
        }

    @property
    def is_empty(self) -> bool:
        return not (self.added or self.removed or self.modified)


def _entry_identity(entry: Entry) -> Tuple[str, Optional[str], int, int]:
    """用于判定两个条目是否“相同”的字段元组。"""
    return entry.kind, entry.content_hash, entry.size, entry.mode


class SnapshotStore:
    """维护快照树、整数逻辑时钟与限额。

    :param max_entries: 单个快照允许的最大条目数（None 表示不限）。
    :param max_snapshots: 存储中允许的最大快照数（None 表示不限）。
    :param initial_time: 逻辑时钟初值（非负整数），根快照从下一个 tick 开始。
    """

    def __init__(
        self,
        *,
        max_entries: Optional[int] = None,
        max_snapshots: Optional[int] = None,
        initial_time: int = 0,
    ) -> None:
        if max_entries is not None and (
            not _is_nonneg_int(max_entries) or max_entries <= 0
        ):
            raise KernelError("max_entries 必须是正整数或 None")
        if max_snapshots is not None and (
            not _is_nonneg_int(max_snapshots) or max_snapshots <= 0
        ):
            raise KernelError("max_snapshots 必须是正整数或 None")
        if not _is_nonneg_int(initial_time):
            raise KernelError("initial_time 必须是非负整数")
        self.max_entries = max_entries
        self.max_snapshots = max_snapshots
        self._logical_clock = initial_time
        self._snapshots: Dict[str, Snapshot] = {}
        self._children: Dict[str, List[str]] = {}

    # ---- 基本访问 -------------------------------------------------------

    @property
    def logical_time(self) -> int:
        return self._logical_clock

    def get(self, snap_id: str) -> Snapshot:
        if snap_id not in self._snapshots:
            raise SnapshotNotFoundError(f"快照不存在: {snap_id}")
        return self._snapshots[snap_id]

    def __contains__(self, snap_id: object) -> bool:
        return snap_id in self._snapshots

    def all_snapshots(self) -> List[Snapshot]:
        return list(self._snapshots.values())

    def children(self, snap_id: str) -> List[str]:
        """返回直接挂在某快照下的子快照 id（按创建顺序）。"""
        if snap_id not in self._snapshots:
            raise SnapshotNotFoundError(f"快照不存在: {snap_id}")
        return list(self._children.get(snap_id, []))

    def roots(self) -> List[Snapshot]:
        return [s for s in self._snapshots.values() if s.parent_id is None]

    def ancestors_of(self, snap_id: str) -> List[Snapshot]:
        """从自身沿 parent 链到根，含自身。"""
        chain: List[Snapshot] = []
        current: Optional[str] = snap_id
        visited: set = set()
        while current is not None:
            if current in visited:
                raise KernelError(f"快照父链存在环: {current}")
            visited.add(current)
            snap = self.get(current)
            chain.append(snap)
            current = snap.parent_id
        return chain

    # ---- 创建 -----------------------------------------------------------

    def create_snapshot(
        self,
        parent_id: Optional[str],
        entries: Dict[str, Entry],
        *,
        snap_id: Optional[str] = None,
    ) -> Snapshot:
        """在 ``parent_id`` 下创建一个新快照。

        ``parent_id`` 为 None 时创建根快照。条目集合会经过完整校验
        （路径合法性、无重复、父目录存在、kind/字段匹配）。
        ``snap_id`` 可显式指定（用于反序列化/CLI），否则用
        ``snap-<逻辑时间>-n`` 自动生成。
        """
        if parent_id is not None and parent_id not in self._snapshots:
            raise SnapshotNotFoundError(f"父快照不存在: {parent_id}")

        # 先校验再检查限额：非法输入报 ValidationError，而不是限额错误。
        validate_entry_set(entries)
        normalized = {validate_path(e.path): e for e in entries.values()}

        if self.max_entries is not None and len(normalized) > self.max_entries:
            raise LimitExceededError(
                f"快照条目数 {len(normalized)} 超过 max_entries={self.max_entries}"
            )
        if (
            self.max_snapshots is not None
            and len(self._snapshots) >= self.max_snapshots
        ):
            raise LimitExceededError(
                f"快照数量已达上限 max_snapshots={self.max_snapshots}，"
                "拒绝创建新快照"
            )

        if snap_id is None:
            snap_id = self._generate_id()
        if not isinstance(snap_id, str) or not snap_id:
            raise ValidationError("snap_id 必须是非空字符串")
        if snap_id in self._snapshots:
            raise KernelError(f"snap_id 已存在: {snap_id}")

        self._logical_clock += 1
        snap = Snapshot(
            snap_id=snap_id,
            parent_id=parent_id,
            entries=normalized,
            logical_time=self._logical_clock,
        )
        self._snapshots[snap_id] = snap
        self._children.setdefault(snap_id, [])
        if parent_id is not None:
            self._children.setdefault(parent_id, []).append(snap_id)
        return snap

    def _generate_id(self) -> str:
        # 同一逻辑时间下连续创建（理论上时钟每次都自增，这里仍做去重保护）。
        candidate = f"snap-{self._logical_clock + 1}"
        suffix = 1
        unique = candidate
        while unique in self._snapshots:
            suffix += 1
            unique = f"{candidate}-{suffix}"
        return unique

    def add_existing(self, snap: Snapshot, *, check_limits: bool = True) -> Snapshot:
        """把一个已存在（含显式 logical_time）的快照登记进存储。

        用于 load 往返。会把逻辑时钟前推到不小于该快照的逻辑时间。
        ``check_limits=False`` 仅供只读加载跳过限额（结构校验仍执行）。
        """
        validate_entry_set(snap.entries)
        if snap.snap_id in self._snapshots:
            raise KernelError(f"snap_id 已存在: {snap.snap_id}")
        if snap.parent_id is not None and snap.parent_id not in self._snapshots:
            raise SnapshotNotFoundError(
                f"父快照不存在: {snap.parent_id}（需先加载父快照）"
            )
        if check_limits:
            if self.max_entries is not None and len(snap.entries) > self.max_entries:
                raise LimitExceededError(
                    f"快照条目数 {len(snap.entries)} 超过 max_entries={self.max_entries}"
                )
            if (
                self.max_snapshots is not None
                and len(self._snapshots) >= self.max_snapshots
            ):
                raise LimitExceededError(
                    f"快照数量已达上限 max_snapshots={self.max_snapshots}，拒绝载入"
                )
        self._snapshots[snap.snap_id] = snap
        self._children.setdefault(snap.snap_id, [])
        if snap.parent_id is not None:
            self._children.setdefault(snap.parent_id, []).append(snap.snap_id)
        if snap.logical_time > self._logical_clock:
            self._logical_clock = snap.logical_time
        return snap

    # ---- 祖先 -----------------------------------------------------------

    def find_common_ancestor(self, a_id: str, b_id: str) -> Snapshot:
        """返回两个快照最近（最深）的共同祖先；找不到则报错。"""
        a_chain = self.ancestors_of(a_id)
        a_ancestors = {snap.snap_id for snap in a_chain}
        current: Optional[str] = b_id
        visited: set = set()
        while current is not None:
            if current in visited:
                raise KernelError(f"快照父链存在环: {current}")
            visited.add(current)
            if current in a_ancestors:
                return self.get(current)
            current = self.get(current).parent_id
        raise AncestorNotFoundError(
            f"快照 {a_id} 与 {b_id} 没有共同祖先（属于不同的根）"
        )

    # ---- diff -----------------------------------------------------------

    def diff(self, a_id: str, b_id: str) -> Changeset:
        """计算从快照 ``a`` 到快照 ``b`` 的最小变更集，路径按字典序排列。"""
        a = self.get(a_id)
        b = self.get(b_id)
        a_paths = set(a.entries)
        b_paths = set(b.entries)

        added = sorted(b_paths - a_paths)
        removed = sorted(a_paths - b_paths)

        modified: List[str] = []
        for path in sorted(a_paths & b_paths):
            if _entry_identity(a.entries[path]) != _entry_identity(b.entries[path]):
                modified.append(path)

        return Changeset(added=added, removed=removed, modified=modified)

    @staticmethod
    def diff_snapshots(a: Snapshot, b: Snapshot) -> Changeset:
        """不经过存储、直接对两棵快照做 diff。"""
        a_paths = set(a.entries)
        b_paths = set(b.entries)
        modified = [
            path
            for path in sorted(a_paths & b_paths)
            if _entry_identity(a.entries[path]) != _entry_identity(b.entries[path])
        ]
        return Changeset(
            added=sorted(b_paths - a_paths),
            removed=sorted(a_paths - b_paths),
            modified=modified,
        )

    # ---- 三方合并 -------------------------------------------------------

    def three_way_merge(
        self,
        base_id: Optional[str],
        ours_id: str,
        theirs_id: str,
    ) -> MergeResult:
        """以 ``base`` 为共同祖先，合并 ``ours`` 与 ``theirs``。

        ``base_id`` 为 None 时按“双方均无共同祖先”处理：路径只在一方
        出现视为该方新增，双方都有但不同则是 add-add 冲突。

        裁决规则（逐路径）：

        * 两边都没动           -> 任取一方（相同）；
        * 只有一边改/增/删     -> 采用该边变更（含目录级删除）；
        * 两边改成相同结果     -> 自动采用该结果；
        * file 内容都改但不同  -> modify-modify 冲突；
        * 双方各自新增且不同   -> add-add 冲突；
        * 一边删一边改         -> delete-modify / modify-delete 冲突；
        * 一边是 file 一边是 dir -> file-dir 冲突；
        * 父目录冲突未解决     -> 子孙路径成为 parent-dir 冲突。

        孤儿路径策略见 README：一边删除目录 D、另一边只改了 D 内部的
        既有文件时，文件层面报 delete-modify 冲突（默认保留，不静默
        删除修改）；另一边在被删子树中新增的路径，其父目录仅在删除方
        缺失，无法构成合法目录树，按 orphaned 处理：冲突解决、父目录
        确定恢复前不进入合并结果，并在 ``orphaned`` 中列出。
        """
        ours = self.get(ours_id)
        theirs = self.get(theirs_id)
        base = self.get(base_id) if base_id is not None else None

        base_entries = base.entries if base is not None else {}
        all_paths = sorted(
            set(base_entries) | set(ours.entries) | set(theirs.entries)
        )

        result: Dict[str, Entry] = {}
        conflicts: List[Conflict] = []
        auto: Dict[str, str] = {}
        orphaned: set = set()

        def desc(entry: Optional[Entry]) -> Optional[str]:
            if entry is None:
                return None
            if entry.kind == "dir":
                return "dir"
            return f"file(hash={entry.content_hash})"

        # 第一遍：逐路径裁决。
        decisions: Dict[str, Optional[Entry]] = {}
        for path in all_paths:
            b = base_entries.get(path)
            o = ours.entries.get(path)
            t = theirs.entries.get(path)

            # 完全一致（含两边都删除）。
            if o == t:
                if o is not None:
                    decisions[path] = o
                    # 相对 base 发生了变化但两边殊途同归 -> both-same。
                    if o != b:
                        auto[path] = "both-same"
                else:
                    decisions[path] = None
                continue

            # 仅一边相对 base 发生变化。
            if o == b:
                # ours 未动（可能不存在），theirs 改了/增了/删了。
                decisions[path] = t
                if t is not None:
                    auto[path] = "theirs"
                else:
                    auto[path] = "deleted-by-theirs"
                continue
            if t == b:
                decisions[path] = o
                if o is not None:
                    auto[path] = "ours"
                else:
                    auto[path] = "deleted-by-ours"
                continue

            # 两边都相对 base 变化。
            if o is not None and t is not None:
                if o.kind != t.kind:
                    conflicts.append(
                        Conflict(
                            path=path,
                            kind="file-dir",
                            base=desc(b),
                            ours=desc(o),
                            theirs=desc(t),
                            message=(
                                f"路径 {path} 双方类型不一致："
                                f"ours={o.kind}，theirs={t.kind}，无法自动合并"
                            ),
                        )
                    )
                    decisions[path] = None
                elif _entry_identity(o) == _entry_identity(t):
                    # 两边改成同样的结果。
                    decisions[path] = o
                    auto[path] = "both-same"
                elif b is None:
                    conflicts.append(
                        Conflict(
                            path=path,
                            kind="add-add",
                            base=None,
                            ours=desc(o),
                            theirs=desc(t),
                            message=(
                                f"路径 {path} 被双方同时新建但内容不同"
                                if o.kind == "file"
                                else f"路径 {path} 被双方同时新建为目录但元数据不同"
                            ),
                        )
                    )
                    decisions[path] = None
                else:
                    conflicts.append(
                        Conflict(
                            path=path,
                            kind="modify-modify",
                            base=desc(b),
                            ours=desc(o),
                            theirs=desc(t),
                            message=(
                                f"路径 {path} 双方都修改且内容不同"
                                if o.kind == "file"
                                else f"路径 {path} 双方都修改了目录元数据且不一致"
                            ),
                        )
                    )
                    decisions[path] = None
            elif o is not None and t is None:
                # theirs 删除，ours 修改（或在无 base 时 ours 独有：
                # 此时 ours == b 分支已覆盖，能走到这里说明 ours 变了）。
                kind = "modify-delete" if b is not None else "add-delete"
                conflicts.append(
                    Conflict(
                        path=path,
                        kind=kind,
                        base=desc(b),
                        ours=desc(o),
                        theirs=None,
                        message=(
                            f"路径 {path} 被 theirs 删除，"
                            f"但 ours 对其做了修改；需要人工决定保留 ours 还是接受删除"
                            if b is not None
                            else f"路径 {path} ours 新增而 theirs 不存在且无共同祖先"
                        ),
                    )
                )
                decisions[path] = None
            else:  # o is None and t is not None
                kind = "delete-modify" if b is not None else "delete-add"
                conflicts.append(
                    Conflict(
                        path=path,
                        kind=kind,
                        base=desc(b),
                        ours=None,
                        theirs=desc(t),
                        message=(
                            f"路径 {path} 被 ours 删除，"
                            f"但 theirs 对其做了修改；需要人工决定保留 theirs 还是接受删除"
                            if b is not None
                            else f"路径 {path} theirs 新增而 ours 不存在且无共同祖先"
                        ),
                    )
                )
                decisions[path] = None

        conflict_paths = {c.path for c in conflicts}

        # 第二遍：处理父目录缺失导致的孤儿路径。
        #
        # 目录级删除的传播规则：
        #   * 某路径的决策是“保留”，但它的某个祖先目录决策为删除
        #     （纯删除，无冲突），说明一边删了整棵子树，另一边在其中
        #     新增了条目 —— 该路径成为孤儿，记录 parent-dir 冲突并
        #     从结果剔除，而不是让悬空路径破坏“父目录存在”不变量。
        #   * 祖先目录本身存在未解决冲突时，子孙路径同样无法落位，
        #     记为 parent-dir 冲突。
        #   * 祖先被删除、子孙是“修改既有文件”的情况在第一遍已生成
        #     delete-modify/modify-delete 冲突，这里把它的下层子路径
        #     一并归入冲突集合（不重复报同一文件）。
        for path in all_paths:
            decision = decisions.get(path)
            if decision is None:
                continue  # 已删除或已有冲突
            blocking_ancestor: Optional[str] = None
            for ancestor in _ancestor_dirs(path):
                if ancestor in conflict_paths:
                    blocking_ancestor = ancestor
                    break
                anc_decision = decisions.get(ancestor, "MISSING")
                if anc_decision is None or anc_decision == "MISSING":
                    # 祖先被删除，或结果里根本没有该祖先。
                    blocking_ancestor = ancestor
                    break
            if blocking_ancestor is not None:
                orphaned.add(path)
                # 若该路径自身在一边相对 base 有修改（不是纯新增），
                # 第一遍已经给它报过冲突；否则补一个 parent-dir 冲突。
                if path not in conflict_paths:
                    b = base_entries.get(path)
                    o = ours.entries.get(path)
                    t = theirs.entries.get(path)
                    conflicts.append(
                        Conflict(
                            path=path,
                            kind="parent-dir",
                            base=desc(b),
                            ours=desc(o),
                            theirs=desc(t),
                            message=(
                                f"路径 {path} 的父目录 {blocking_ancestor} "
                                "在合并中被删除或存在未解决冲突，"
                                "该路径成为孤儿，暂不进入合并结果"
                            ),
                        )
                    )

        # 第三遍：产出最终条目。
        for path, entry in decisions.items():
            if entry is None:
                continue
            if path in conflict_paths or path in orphaned:
                continue
            result[path] = entry

        # 结构修复：对保留下来的条目补齐可能缺失的祖先目录
        # （例如 base 中父目录因双方一致的某种状态未进入决策集）。
        result = self._repair_parents(
            result, base_entries, ours.entries, theirs.entries
        )

        # 最终不变量校验（无冲突结果必须是一棵合法树）。
        if not conflicts:
            validate_entry_set(result)

        # 进入冲突/孤儿集合的路径并未真正自动裁决，从说明表剔除，
        # 保持 auto_resolved 只包含最终无异议采用的路径。
        resolved_auto = {
            path: how
            for path, how in auto.items()
            if path not in conflict_paths and path not in orphaned
        }

        return MergeResult(
            entries=result,
            conflicts=conflicts,
            auto_resolved=dict(sorted(resolved_auto.items())),
            orphaned=sorted(orphaned),
            base_id=base.snap_id if base is not None else None,
        )

    def merge(self, ours_id: str, theirs_id: str) -> MergeResult:
        """先查找最近共同祖先，再做三方合并。

        两个快照没有共同祖先时抛 :class:`AncestorNotFoundError`；
        需要“无祖先”空合并的调用方可直接用 :meth:`three_way_merge`
        并传 ``base_id=None``。
        """
        base = self.find_common_ancestor(ours_id, theirs_id)
        return self.three_way_merge(base.snap_id, ours_id, theirs_id)

    @staticmethod
    def _repair_parents(
        result: Dict[str, Entry],
        base_entries: Dict[str, Entry],
        ours_entries: Dict[str, Entry],
        theirs_entries: Dict[str, Entry],
    ) -> Dict[str, Entry]:
        """补齐结果中缺失的祖先目录，目录条目优先取 ours，其次 base/theirs。"""
        repaired = dict(result)

        def pick_dir(path: str) -> Optional[Entry]:
            for source in (ours_entries, base_entries, theirs_entries):
                candidate = source.get(path)
                if candidate is not None and candidate.kind == "dir":
                    return candidate
            return None

        changed = True
        while changed:
            changed = False
            for path in list(repaired):
                for ancestor in _ancestor_dirs(path):
                    if ancestor not in repaired:
                        entry = pick_dir(ancestor)
                        if entry is None:
                            # 三方都没有这个目录的信息，构造一个默认空目录。
                            entry = Entry(path=ancestor, kind="dir", size=0, mode=0)
                        repaired[ancestor] = entry
                        changed = True
        return repaired

    # ---- 持久化 ---------------------------------------------------------

    def save(self, path: str) -> None:
        """把整个存储保存为单个 JSON 文件（原子写入）。"""
        payload = {
            "format": "snapshot-store-v1",
            "logical_time": self._logical_clock,
            "limits": {
                "max_entries": self.max_entries,
                "max_snapshots": self.max_snapshots,
            },
            "snapshots": [
                snapshot_to_dict(snap)
                # 按 parent 链拓扑顺序写出：根在前。
                for snap in self._topological_order()
            ],
        }
        directory = os.path.dirname(os.path.abspath(path))
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2, sort_keys=False)
                fh.write("\n")
            os.replace(tmp_path, path)
        except OSError as exc:
            raise SerializationError(f"写入快照文件失败 {path}: {exc}") from exc

    def _topological_order(self) -> List[Snapshot]:
        ordered: List[Snapshot] = []
        emitted: set = set()

        def emit(snap_id: str) -> None:
            if snap_id in emitted:
                return
            snap = self._snapshots[snap_id]
            if snap.parent_id is not None and snap.parent_id in self._snapshots:
                emit(snap.parent_id)
            emitted.add(snap_id)
            ordered.append(snap)

        for snap_id in sorted(self._snapshots):
            emit(snap_id)
        return ordered

    @classmethod
    def load(
        cls,
        path: str,
        *,
        max_entries: Optional[int] = None,
        max_snapshots: Optional[int] = None,
        enforce_limits: bool = True,
    ) -> "SnapshotStore":
        """从 JSON 文件加载存储。

        文件中记录的限额默认生效；显式传入 ``max_entries``/``max_snapshots``
        时以参数为准。文件损坏或字段缺失抛 :class:`SerializationError`。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except FileNotFoundError as exc:
            raise SerializationError(f"快照文件不存在: {path}") from exc
        except json.JSONDecodeError as exc:
            raise SerializationError(
                f"快照文件损坏，不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）: "
                f"{exc.msg}"
            ) from exc
        except OSError as exc:
            raise SerializationError(f"读取快照文件失败 {path}: {exc}") from exc

        if not isinstance(payload, dict):
            raise SerializationError("快照文件损坏：顶层必须是 JSON 对象")
        if "snapshots" not in payload:
            raise SerializationError("快照文件损坏：缺少 snapshots 字段")
        if not isinstance(payload["snapshots"], list):
            raise SerializationError("快照文件损坏：snapshots 必须是数组")

        limits = payload.get("limits", {})
        if not isinstance(limits, dict):
            raise SerializationError("快照文件损坏：limits 必须是对象")
        file_max_entries = limits.get("max_entries")
        file_max_snapshots = limits.get("max_snapshots")

        def resolve(param: object, from_file: object) -> Optional[int]:
            value = param if param is not None else from_file
            if value is None:
                return None
            if not _is_nonneg_int(value) or value <= 0:
                raise SerializationError("限额必须是正整数")
            return value

        eff_max_entries = resolve(max_entries, file_max_entries)
        eff_max_snapshots = resolve(max_snapshots, file_max_snapshots)

        logical_time = payload.get("logical_time", 0)
        if not _is_nonneg_int(logical_time):
            raise SerializationError("logical_time 必须是非负整数")

        store = cls(
            max_entries=eff_max_entries,
            max_snapshots=eff_max_snapshots,
            initial_time=logical_time,
        )
        # 反序列化时逻辑时间保持文件值，add_existing 只会前推不会自增。
        for index, raw in enumerate(payload["snapshots"]):
            try:
                snap = snapshot_from_dict(raw)
            except SerializationError as exc:
                raise SerializationError(
                    f"快照文件损坏：第 {index} 个快照: {exc}"
                ) from exc
            try:
                store.add_existing(snap, check_limits=enforce_limits)
            except SnapshotNotFoundError as exc:
                # 拓扑顺序不对：父快照晚于子快照。
                raise SerializationError(
                    f"快照文件损坏：快照 {snap.snap_id} 的父快照 "
                    f"{snap.parent_id} 未在它之前出现"
                ) from exc
        return store


# ---------------------------------------------------------------------------
# 便捷函数
# ---------------------------------------------------------------------------


def make_file(path: str, content_hash: str, *, size: int = 0, mode: int = 0o644) -> Entry:
    """构造一个 file 条目的简写。"""
    return Entry(path=path, kind="file", content_hash=content_hash, size=size, mode=mode)


def make_dir(path: str, *, mode: int = 0o755) -> Entry:
    """构造一个 dir 条目的简写。"""
    return Entry(path=path, kind="dir", size=0, mode=mode)
