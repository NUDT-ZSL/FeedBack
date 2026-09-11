"""内容寻址块存储与差分同步内核（仅依赖 Python 标准库）。

模块组成：

* :func:`chunk_data` —— 按固定大小把字节流切块；
* :func:`hash_bytes` / :func:`hash_block_ids` —— SHA-256 块 ID 与整体内容哈希；
* :class:`Manifest` —— 文件清单（路径、长度、块 ID 序列、整体哈希）；
* :class:`SyncPlan` —— 两端清单的差分同步计划；
* :class:`ContentStore` —— 块存储主体：去重、引用计数、gc、内存上限、
  差分重建以及 JSON + 块目录的快照持久化。

约定的策略（详见 README）：

* **块大小不匹配**：``diff`` / ``apply_diff`` 直接拒绝，抛
  :class:`BlockSizeMismatchError`，不做任何重切。
* **内存上限**：``max_bytes`` 限制的是去重后实际占用的字节数；超限则整次
  写入被原子拒绝，抛 :class:`StorageLimitError`，已存内容与引用计数不变。
  ``max_bytes=None`` 表示无上限（精确模式）。
* **引用计数**：每写入 / 引用一个块（同一清单内重复出现也按出现次数计），
  引用计数加一；只有计数为 0 的块才会被 ``gc`` 清理。
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set

__all__ = [
    "DEFAULT_BLOCK_SIZE",
    "SNAPSHOT_VERSION",
    "CasError",
    "BlockNotFoundError",
    "MissingBlockError",
    "StorageLimitError",
    "BlockSizeMismatchError",
    "ManifestValidationError",
    "StoreCorruptionError",
    "ContentHashMismatchError",
    "BlockHashMismatchError",
    "chunk_data",
    "hash_bytes",
    "hash_block_ids",
    "Manifest",
    "SyncPlan",
    "ContentStore",
]

DEFAULT_BLOCK_SIZE: int = 4096
SNAPSHOT_VERSION: int = 1


# --------------------------------------------------------------------------- #
# 异常类型
# --------------------------------------------------------------------------- #
class CasError(Exception):
    """所有 CAS 相关异常的基类。"""


class BlockNotFoundError(CasError):
    """块 ID 在存储中不存在。"""

    def __init__(self, block_id: str) -> None:
        super().__init__(f"块不存在: {block_id}")
        self.block_id = block_id


class MissingBlockError(CasError):
    """同步计划引用了远端存储中不存在的块（不允许静默跳过）。"""

    def __init__(self, missing: Iterable[str]) -> None:
        self.missing: List[str] = list(dict.fromkeys(missing))
        super().__init__(
            "远端存储缺失计划引用的块: " + ", ".join(self.missing)
        )


class StorageLimitError(CasError):
    """写入会突破 ``max_bytes`` 上限，整次写入被拒绝。"""

    def __init__(self, need: int, used: int, limit: Optional[int]) -> None:
        self.need = need
        self.used = used
        self.limit = limit
        super().__init__(
            f"写入被拒绝: 需要新增 {need} 字节, 已用 {used} 字节, "
            f"上限 {limit if limit is not None else '无'}"
        )


class BlockSizeMismatchError(CasError):
    """两端清单 / 存储的块大小不一致，拒绝差分。"""

    def __init__(self, local_size: int, remote_size: int) -> None:
        self.local_size = local_size
        self.remote_size = remote_size
        super().__init__(
            f"块大小不匹配: 本地 {local_size} 字节, 远端 {remote_size} 字节; "
            "策略为拒绝同步, 请使用相同块大小重新切块"
        )


class ManifestValidationError(CasError):
    """清单字段缺失、类型错误或整体哈希校验失败。"""


class StoreCorruptionError(CasError):
    """快照目录结构损坏、字段缺失或一致性校验失败。"""


class ContentHashMismatchError(CasError):
    """重建内容的整体哈希与远端清单不一致。"""

    def __init__(self, expected: str, actual: str) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"重建后整体内容哈希不匹配: 期望 {expected}, 实际 {actual}"
        )


class BlockHashMismatchError(CasError):
    """块内容的 SHA-256 与其块 ID 不一致（内容损坏或张冠李戴）。"""

    def __init__(self, block_id: str, actual_id: str) -> None:
        self.block_id = block_id
        self.actual_id = actual_id
        super().__init__(
            f"块内容哈希与块 ID 不匹配: 块 ID {block_id}, 内容实际哈希 {actual_id}"
        )


# --------------------------------------------------------------------------- #
# 纯函数：切块与哈希
# --------------------------------------------------------------------------- #
def hash_bytes(data: bytes) -> str:
    """返回 ``data`` 的 SHA-256 十六进制摘要（即块 ID）。"""
    return hashlib.sha256(data).hexdigest()


def hash_block_ids(block_ids: Iterable[str]) -> str:
    """把块 ID 按顺序拼接后再做一次 SHA-256，得到整体内容哈希。"""
    joined = "".join(block_ids).encode("utf-8")
    return hashlib.sha256(joined).hexdigest()


def chunk_data(data: bytes, block_size: int = DEFAULT_BLOCK_SIZE) -> List[bytes]:
    """按固定大小切块。

    :param data: 原始字节；空字节流返回空列表（空文件没有任何块）。
    :param block_size: 块大小，必须为正整数。最后一块可以短于块大小。
    """
    if not isinstance(block_size, int) or block_size <= 0:
        raise ValueError(f"block_size 必须是正整数, 得到: {block_size!r}")
    return [data[i : i + block_size] for i in range(0, len(data), block_size)]


# --------------------------------------------------------------------------- #
# 清单
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Manifest:
    """单个文件的清单。

    :ivar path: 文件逻辑路径（清单内不做路径归一化，原样保存）。
    :ivar length: 文件总字节数。
    :ivar block_ids: 按文件顺序排列的块 ID 列表（允许同一 ID 重复出现）。
    :ivar content_hash: 把所有块 ID 顺序拼接后的 SHA-256 十六进制摘要。
    :ivar block_size: 切块大小；diff 时两端必须一致。
    """

    path: str
    length: int
    block_ids: List[str] = field(default_factory=list)
    content_hash: str = ""
    block_size: int = DEFAULT_BLOCK_SIZE

    def __post_init__(self) -> None:
        if not isinstance(self.path, str):
            raise ManifestValidationError("path 必须是字符串")
        if not isinstance(self.length, int) or self.length < 0:
            raise ManifestValidationError("length 必须是非负整数")
        if not isinstance(self.block_ids, list) or not all(
            isinstance(b, str) for b in self.block_ids
        ):
            raise ManifestValidationError("block_ids 必须是字符串列表")
        if not isinstance(self.block_size, int) or self.block_size <= 0:
            raise ManifestValidationError("block_size 必须是正整数")
        if not self.content_hash:
            # dataclass 是 frozen 的，用 object.__setattr__ 补全派生字段。
            object.__setattr__(
                self, "content_hash", hash_block_ids(self.block_ids)
            )

    # -- 序列化 ------------------------------------------------------------- #
    def to_dict(self) -> Dict[str, object]:
        """转成可 JSON 序列化的字典，字段顺序固定。"""
        return {
            "path": self.path,
            "length": self.length,
            "block_size": self.block_size,
            "block_ids": list(self.block_ids),
            "content_hash": self.content_hash,
        }

    @classmethod
    def from_dict(
        cls, data: Dict[str, object], validate: bool = False
    ) -> "Manifest":
        """从字典重建清单。

        :param validate: 为 ``True`` 时额外重算整体哈希并与保存值比对，
            不一致抛 :class:`ManifestValidationError`。
        """
        if not isinstance(data, dict):
            raise ManifestValidationError("清单必须是 JSON 对象")
        required = ("path", "length", "block_ids", "content_hash", "block_size")
        missing = [k for k in required if k not in data]
        if missing:
            raise ManifestValidationError(
                "清单缺失字段: " + ", ".join(sorted(missing))
            )
        try:
            manifest = cls(
                path=data["path"],  # type: ignore[arg-type]
                length=int(data["length"]),  # type: ignore[arg-type]
                block_ids=list(data["block_ids"]),  # type: ignore[arg-type]
                content_hash=str(data["content_hash"]),
                block_size=int(data["block_size"]),  # type: ignore[arg-type]
            )
        except ManifestValidationError:
            raise
        except (TypeError, ValueError) as exc:
            raise ManifestValidationError(f"清单字段类型错误: {exc}") from exc
        if validate and manifest.content_hash != hash_block_ids(
            manifest.block_ids
        ):
            raise ManifestValidationError(
                f"清单 {manifest.path!r} 整体内容哈希与块序列不一致"
            )
        return manifest

    def to_json(self) -> str:
        """序列化为 JSON 字符串。"""
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True)

    @classmethod
    def from_json(cls, text: str, validate: bool = False) -> "Manifest":
        """从 JSON 字符串反序列化。"""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ManifestValidationError(f"清单 JSON 解析失败: {exc}") from exc
        return cls.from_dict(data, validate=validate)

    @classmethod
    def from_data(
        cls, path: str, data: bytes, block_size: int = DEFAULT_BLOCK_SIZE
    ) -> "Manifest":
        """直接从文件内容构造清单（不涉及任何存储）。"""
        block_ids = [hash_bytes(chunk) for chunk in chunk_data(data, block_size)]
        return cls(
            path=path,
            length=len(data),
            block_ids=block_ids,
            content_hash=hash_block_ids(block_ids),
            block_size=block_size,
        )


# --------------------------------------------------------------------------- #
# 差分同步计划
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class SyncPlan:
    """本地清单与远端清单之间的同步计划。

    :ivar fetch_ids: 需要从远端拉取的块 ID（远端有、本地清单没有），
        按远端序列中的首次出现顺序去重排列。
    :ivar delete_ids: 本地清单有、远端清单没有的块 ID（建议删除），
        按本地序列首次出现顺序去重；真正是否删除由引用计数 + gc 决定。
    :ivar rebuild_ids: 按顺序重建远端文件所需的完整块 ID 序列，
        即远端清单的 ``block_ids``。
    """

    block_size: int
    local_path: str
    remote_path: str
    fetch_ids: List[str] = field(default_factory=list)
    delete_ids: List[str] = field(default_factory=list)
    rebuild_ids: List[str] = field(default_factory=list)
    remote_length: int = 0
    content_hash: str = ""

    def to_dict(self) -> Dict[str, object]:
        return {
            "block_size": self.block_size,
            "local_path": self.local_path,
            "remote_path": self.remote_path,
            "remote_length": self.remote_length,
            "content_hash": self.content_hash,
            "fetch_ids": list(self.fetch_ids),
            "delete_ids": list(self.delete_ids),
            "rebuild_ids": list(self.rebuild_ids),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "SyncPlan":
        if not isinstance(data, dict):
            raise ManifestValidationError("同步计划必须是 JSON 对象")
        required = (
            "block_size",
            "local_path",
            "remote_path",
            "remote_length",
            "content_hash",
            "fetch_ids",
            "delete_ids",
            "rebuild_ids",
        )
        missing = [k for k in required if k not in data]
        if missing:
            raise ManifestValidationError(
                "同步计划缺失字段: " + ", ".join(sorted(missing))
            )
        try:
            return cls(
                block_size=int(data["block_size"]),  # type: ignore[arg-type]
                local_path=str(data["local_path"]),
                remote_path=str(data["remote_path"]),
                remote_length=int(data["remote_length"]),  # type: ignore[arg-type]
                content_hash=str(data["content_hash"]),
                fetch_ids=list(data["fetch_ids"]),  # type: ignore[arg-type]
                delete_ids=list(data["delete_ids"]),  # type: ignore[arg-type]
                rebuild_ids=list(data["rebuild_ids"]),  # type: ignore[arg-type]
            )
        except (TypeError, ValueError) as exc:
            raise ManifestValidationError(f"同步计划字段类型错误: {exc}") from exc

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> "SyncPlan":
        try:
            return cls.from_dict(json.loads(text))
        except json.JSONDecodeError as exc:
            raise ManifestValidationError(f"同步计划 JSON 解析失败: {exc}") from exc


def diff(local_manifest: Manifest, remote_manifest: Manifest) -> SyncPlan:
    """对两份清单做差分，返回 :class:`SyncPlan`。

    策略：

    * 两端 ``block_size`` 不同 → 抛 :class:`BlockSizeMismatchError`，
      拒绝同步（块边界不同无法在块级别精确比对）。
    * ``fetch_ids`` = 远端序列中出现、但本地块 ID 集合中没有的块，
      按首次出现顺序去重，因此拉取量恰好等于变化块数。
    * ``delete_ids`` = 本地有、远端没有的块；仅为建议，实际删除由
      引用计数决定，避免删掉仍被其它文件共享的块。
    """
    if local_manifest.block_size != remote_manifest.block_size:
        raise BlockSizeMismatchError(
            local_manifest.block_size, remote_manifest.block_size
        )

    local_ids: Set[str] = set(local_manifest.block_ids)
    remote_ids: Set[str] = set(remote_manifest.block_ids)

    fetch_ids = [
        bid for bid in _unique_in_order(remote_manifest.block_ids)
        if bid not in local_ids
    ]
    delete_ids = [
        bid for bid in _unique_in_order(local_manifest.block_ids)
        if bid not in remote_ids
    ]
    return SyncPlan(
        block_size=remote_manifest.block_size,
        local_path=local_manifest.path,
        remote_path=remote_manifest.path,
        fetch_ids=fetch_ids,
        delete_ids=delete_ids,
        rebuild_ids=list(remote_manifest.block_ids),
        remote_length=remote_manifest.length,
        content_hash=remote_manifest.content_hash,
    )


def _unique_in_order(items: Iterable[str]) -> List[str]:
    """按首次出现顺序去重。"""
    return list(dict.fromkeys(items))


# --------------------------------------------------------------------------- #
# 内容寻址块存储
# --------------------------------------------------------------------------- #
class ContentStore:
    """内容寻址块存储。

    :param block_size: 新文件 :meth:`add_file` 时使用的默认块大小。
    :param max_bytes: 去重后块内容总字节数上限；``None`` 表示无上限
        （精确模式）。``0`` 表示不允许任何非空块，空块（0 字节）仍可写入。
    """

    def __init__(
        self,
        block_size: int = DEFAULT_BLOCK_SIZE,
        max_bytes: Optional[int] = None,
    ) -> None:
        if not isinstance(block_size, int) or block_size <= 0:
            raise ValueError(f"block_size 必须是正整数, 得到: {block_size!r}")
        if max_bytes is not None and (
            not isinstance(max_bytes, int) or max_bytes < 0
        ):
            raise ValueError(
                f"max_bytes 必须是非负整数或 None, 得到: {max_bytes!r}"
            )
        self.block_size: int = block_size
        self.max_bytes: Optional[int] = max_bytes
        self._blocks: Dict[str, bytes] = {}
        self._refs: Dict[str, int] = {}
        self._manifests: Dict[str, Manifest] = {}

    # ------------------------------------------------------------------ #
    # 基本块操作
    # ------------------------------------------------------------------ #
    def put_block(self, data: bytes) -> str:
        """写入一个块并返回块 ID。

        * 内容相同的块物理上只存一份（内容寻址，天然去重）；
        * 每次调用都代表新增一个引用：新块引用计数置 1，重复块计数 +1，
          因此重复写入是幂等的（不会产生第二份数据），计数可通过
          :meth:`ref_count` / :meth:`stats` 查看。
        * 若新块会突破 ``max_bytes``，抛 :class:`StorageLimitError`，
          存储状态保持不变。
        """
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError("put_block 只接受 bytes-like 对象")
        data = bytes(data)
        block_id = hash_bytes(data)
        if block_id in self._blocks:
            self._refs[block_id] += 1
            return block_id
        self._check_capacity(len(data))
        self._blocks[block_id] = data
        self._refs[block_id] = 1
        return block_id

    def get_block(self, block_id: str) -> bytes:
        """返回块内容；不存在时抛 :class:`BlockNotFoundError`。"""
        try:
            return self._blocks[block_id]
        except KeyError:
            raise BlockNotFoundError(block_id) from None

    def has_block(self, block_id: str) -> bool:
        """块是否存在于存储中。"""
        return block_id in self._blocks

    def block_ids(self) -> List[str]:
        """返回当前所有物理块 ID（排序后的新列表）。"""
        return sorted(self._blocks)

    def ref_count(self, block_id: str) -> int:
        """返回块当前引用计数；不存在时抛 :class:`BlockNotFoundError`。"""
        if block_id not in self._refs:
            raise BlockNotFoundError(block_id)
        return self._refs[block_id]

    def add_ref(self, block_id: str) -> int:
        """显式增加一次引用，返回增加后的计数。"""
        if block_id not in self._blocks:
            raise BlockNotFoundError(block_id)
        self._refs[block_id] += 1
        return self._refs[block_id]

    def release_ref(self, block_id: str) -> int:
        """释放一次引用，返回释放后的引用计数（可能为 0）。

        对未知块 ID 抛 :class:`BlockNotFoundError`；计数已经是 0 时
        再释放会抛 :class:`CasError`，不允许出现负引用计数。
        """
        if block_id not in self._blocks:
            raise BlockNotFoundError(block_id)
        current = self._refs[block_id]
        if current <= 0:
            raise CasError(f"块 {block_id} 引用计数已为 0, 不能继续释放")
        self._refs[block_id] = current - 1
        return current - 1

    def gc(self) -> int:
        """清理所有引用计数为 0 的块，返回清理的块数量。"""
        dead = [bid for bid, count in self._refs.items() if count == 0]
        for block_id in dead:
            del self._blocks[block_id]
            del self._refs[block_id]
        return len(dead)

    def stats(self) -> Dict[str, object]:
        """返回存储统计信息。

        键含义：

        * ``block_count``：去重后的物理块数；
        * ``total_bytes``：物理块内容总字节数（实际占用）；
        * ``logical_bytes``：按引用次数累计的逻辑字节数；
        * ``saved_bytes``：去重节省的字节数
          （``logical_bytes - total_bytes``）；
        * ``ref_distribution``：引用计数分布，键为计数（字符串），
          值为该计数下的块数，包含 ``"0"``（待 gc 的块）；
        * ``manifest_count``：当前登记的清单数量。
        """
        total = sum(len(data) for data in self._blocks.values())
        logical = sum(
            len(self._blocks[bid]) * count
            for bid, count in self._refs.items()
        )
        distribution: Dict[str, int] = {}
        for count in self._refs.values():
            key = str(count)
            distribution[key] = distribution.get(key, 0) + 1
        return {
            "block_count": len(self._blocks),
            "total_bytes": total,
            "logical_bytes": logical,
            "saved_bytes": logical - total,
            "ref_distribution": dict(sorted(distribution.items(), key=lambda kv: int(kv[0]))),
            "manifest_count": len(self._manifests),
        }

    # ------------------------------------------------------------------ #
    # 文件与清单
    # ------------------------------------------------------------------ #
    @property
    def manifests(self) -> Dict[str, Manifest]:
        """路径 -> 清单 的只读视图（副本，避免外部就地修改）。"""
        return dict(self._manifests)

    def add_file(self, path: str, data: bytes,
                 block_size: Optional[int] = None) -> Manifest:
        """切块写入存储并登记清单；同路径清单会被整体替换。

        替换是原子的：先完成切块与容量预检（旧清单独占块释放后腾出的
        字节计入可用空间），预检通过后才释放旧引用、写入新块；预检失败
        时存储状态完全不变。旧清单独占且引用计数归零的块会被内部安全
        回收（不影响共享块），保证严格 ``max_bytes`` 下物理占用永不超限。
        """
        bs = block_size if block_size is not None else self.block_size
        chunks = chunk_data(data, bs)
        planned_ids = [hash_bytes(chunk) for chunk in chunks]

        old = self._manifests.get(path)
        # 在“旧独占块被回收、新块已写入”的最终状态上精确计算物理占用，
        # 此刻不改动任何实际状态，预检失败时可以直接返回（原子性）。
        # 旧独占块若新数据仍引用，则保留物理内容、仅重置引用计数。
        old_counts = Counter(old.block_ids) if old is not None else Counter()
        old_exclusive = {
            bid
            for bid, occurrences in old_counts.items()
            if self._refs.get(bid, 0) == occurrences
        }
        size_by_new_id = {bid: len(chunk)
                          for chunk, bid in zip(chunks, planned_ids)}
        to_remove = old_exclusive - set(planned_ids)
        final_ids = (set(self._blocks) - to_remove) | set(planned_ids)
        final_used = sum(
            len(self._blocks[bid]) if bid in self._blocks
            else size_by_new_id[bid]
            for bid in final_ids
        )
        current_used = sum(len(data) for data in self._blocks.values())
        self._check_capacity(final_used - current_used)

        # 释放旧清单引用；仅物理回收“旧独占且新清单不再引用”的块。
        # 新清单仍引用的旧独占块保留物理内容（计数临时为 0），下面
        # put_block 时只增加引用、不会重写。
        if old is not None:
            self._retire_manifest(old, keep_ids=set(planned_ids))
        for chunk in chunks:
            self.put_block(chunk)

        manifest = Manifest(
            path=path,
            length=len(data),
            block_ids=planned_ids,
            content_hash=hash_block_ids(planned_ids),
            block_size=bs,
        )
        self._manifests[path] = manifest
        return manifest

    def add_manifest(self, manifest: Manifest) -> None:
        """登记一份外部构造好的清单（块必须已在存储中）。

        按 ``block_ids`` 出现次数逐次增加引用计数。同路径清单已存在时
        抛 :class:`CasError`，需要替换请用 :meth:`replace_manifest`。
        """
        if manifest.path in self._manifests:
            raise CasError(f"清单路径已存在: {manifest.path!r}")
        self._validate_manifest_blocks(manifest)
        for bid in manifest.block_ids:
            self.add_ref(bid)
        self._manifests[manifest.path] = manifest

    def replace_manifest(self, manifest: Manifest) -> None:
        """登记清单并原子替换同路径的旧清单。

        释放旧引用后，只物理回收“旧清单独占且新清单不再引用”的块；
        新清单仍引用的块（包括 ``apply_diff`` 刚拉来、计数为 0 的块）
        一律保留。共享块引用计数只降不删。
        """
        self._validate_manifest_blocks(manifest)
        old = self._manifests.get(manifest.path)
        if old is not None:
            self._retire_manifest(old, keep_ids=set(manifest.block_ids))
        for bid in manifest.block_ids:
            self.add_ref(bid)
        self._manifests[manifest.path] = manifest

    def remove_manifest(self, path: str) -> None:
        """移除清单并按出现次数释放引用；块本身等显式 ``gc`` 清理。

        与替换路径不同，这里不做内部回收，引用归零的块保留到调用方
        显式执行 :meth:`gc`，便于观察完整的引用计数生命周期。
        """
        try:
            manifest = self._manifests.pop(path)
        except KeyError:
            raise CasError(f"清单路径不存在: {path!r}") from None
        self._release_manifest_refs(manifest)

    def _validate_manifest_blocks(self, manifest: Manifest) -> None:
        missing = [bid for bid in dict.fromkeys(manifest.block_ids)
                   if not self.has_block(bid)]
        if missing:
            raise MissingBlockError(missing)

    def _release_manifest_refs(self, manifest: Manifest) -> None:
        for bid in manifest.block_ids:
            self.release_ref(bid)

    def _retire_manifest(
        self, manifest: Manifest, keep_ids: Optional[Set[str]] = None
    ) -> None:
        """释放旧清单引用并精确回收其独占块。

        减计数前若 ``refs[bid] == 旧清单出现次数``，说明该块全部引用
        都来自旧清单（旧独占块）：减计数后归零。旧独占块且不在
        ``keep_ids`` 中时物理删除；在 ``keep_ids`` 中（新清单仍引用，
        例如 apply_diff 刚拉来的 0 计数块被新版本引用）则保留物理内容、
        计数临时为 0，随后由调用方 add_ref / put_block 接管。
        与本次替换无关的其它 0 计数游离块一律不动。
        """
        keep_ids = keep_ids or set()
        counts = Counter(manifest.block_ids)
        exclusive = {
            bid for bid, occurrences in counts.items()
            if self._refs[bid] == occurrences
        }
        for bid, occurrences in counts.items():
            self._refs[bid] -= occurrences
        for bid in exclusive:
            if bid not in keep_ids:
                del self._blocks[bid]
                del self._refs[bid]

    # ------------------------------------------------------------------ #
    # 差分应用
    # ------------------------------------------------------------------ #
    def apply_diff(
        self, plan: SyncPlan, remote_store: "ContentStore"
    ) -> bytes:
        """按同步计划从远端拉取缺失块并重建远端文件内容。

        * 计划块大小必须与本存储一致，否则抛 :class:`BlockSizeMismatchError`；
        * 仅拉取本存储中尚不存在的块（每个至多调用一次
          ``remote_store.get_block``）；计划引用而远端缺失的块会一次性
          收集后抛 :class:`MissingBlockError`，绝不静默跳过；
        * 同样受 ``max_bytes`` 约束，容量不足时整次应用被拒绝，状态不变；
        * 重建后重算整体内容哈希，与计划不一致抛
          :class:`ContentHashMismatchError`；
        * 返回重建出的文件字节。本方法只搬运数据块、不改动引用计数和
          清单；需要把远端文件登记进来时调用
          :meth:`adopt_remote_manifest` / :meth:`replace_manifest`。
        """
        if plan.block_size != self.block_size:
            raise BlockSizeMismatchError(self.block_size, plan.block_size)

        # 1) 远端缺块检查（本地已有同名块则无需远端提供）。
        missing_remote = [
            bid for bid in dict.fromkeys(plan.fetch_ids)
            if not self.has_block(bid) and not remote_store.has_block(bid)
        ]
        if missing_remote:
            raise MissingBlockError(missing_remote)

        # 2) 只对本地缺失的块发起拉取，get_block 调用次数 == 实际传输块数。
        pending: Dict[str, bytes] = {}
        for bid in dict.fromkeys(plan.fetch_ids):
            if not self.has_block(bid):
                pending[bid] = remote_store.get_block(bid)

        # 3) 所有校验在提交前完成，任何失败都不改变存储状态（原子性）。
        for bid, data in pending.items():
            if hash_bytes(data) != bid:
                raise BlockHashMismatchError(bid, hash_bytes(data))
        missing_rebuild = [
            bid for bid in dict.fromkeys(plan.rebuild_ids)
            if not self.has_block(bid) and bid not in pending
        ]
        if missing_rebuild:
            raise MissingBlockError(missing_rebuild)

        actual_hash = hash_block_ids(plan.rebuild_ids)
        if actual_hash != plan.content_hash:
            raise ContentHashMismatchError(plan.content_hash, actual_hash)

        def block_size_of(bid: str) -> int:
            return len(pending[bid]) if bid in pending else len(self._blocks[bid])

        expected_length = sum(block_size_of(bid) for bid in plan.rebuild_ids)
        if expected_length != plan.remote_length:
            raise CasError(
                f"重建长度不匹配: 期望 {plan.remote_length}, 实际 {expected_length}"
            )

        # 4) 容量预检（只统计真正新增的物理块字节）。
        need = sum(len(data) for bid, data in pending.items())
        self._check_capacity(need)

        # 5) 提交：落盘新块（引用计数保持 0，由后续登记清单接管）。
        for bid, data in pending.items():
            self._blocks[bid] = data
            self._refs[bid] = 0

        # 6) 按重建序列拼装。
        return b"".join(
            pending[bid] if bid in pending else self._blocks[bid]
            for bid in plan.rebuild_ids
        )

    def adopt_remote_manifest(self, plan: SyncPlan) -> Manifest:
        """apply_diff 之后把远端文件登记进本存储并返回其清单。

        同路径旧清单会被替换（其独占块在随后的 ``gc`` 中被清理，
        共享块因引用计数仍 > 0 而保留），等价于计划中 ``delete_ids``
        的安全落地方式。
        """
        manifest = Manifest(
            path=plan.remote_path,
            length=plan.remote_length,
            block_ids=list(plan.rebuild_ids),
            content_hash=plan.content_hash,
            block_size=plan.block_size,
        )
        self.replace_manifest(manifest)
        return manifest

    # ------------------------------------------------------------------ #
    # 容量
    # ------------------------------------------------------------------ #
    def _check_capacity(self, additional: int) -> None:
        """检查当前物理占用 + 净增量是否超 ``max_bytes``。

        ``additional`` 可以为负数（先回收旧块再写新块的场景）。
        """
        if self.max_bytes is None:
            return
        used = sum(len(data) for data in self._blocks.values())
        if used + additional > self.max_bytes:
            raise StorageLimitError(
                max(additional, 0), used, self.max_bytes
            )

    # ------------------------------------------------------------------ #
    # 持久化：JSON 索引 + 块内容独立文件
    # ------------------------------------------------------------------ #
    def save(self, dir_path: str) -> None:
        """把整个存储快照写入目录（目录不存在会创建，已存在则覆盖写）。

        布局::

            dir/
              meta.json          # 版本、块大小、max_bytes
              manifests.json     # 清单列表
              refs.json          # 引用计数表
              blocks/index.json  # 块目录索引（id + 大小）
              blocks/data/<id>   # 按块 ID 命名的块内容文件
        """
        blocks_dir = os.path.join(dir_path, "blocks")
        data_dir = os.path.join(blocks_dir, "data")
        os.makedirs(data_dir, exist_ok=True)

        meta = {
            "version": SNAPSHOT_VERSION,
            "block_size": self.block_size,
            "max_bytes": self.max_bytes,
        }
        manifests_doc = {
            "manifests": [m.to_dict() for m in self._manifests.values()]
        }
        refs_doc = {"refs": dict(sorted(self._refs.items()))}
        index_doc = {
            "blocks": [
                {"id": bid, "size": len(data)}
                for bid, data in sorted(self._blocks.items())
            ]
        }

        _write_json(os.path.join(dir_path, "meta.json"), meta)
        _write_json(os.path.join(dir_path, "manifests.json"), manifests_doc)
        _write_json(os.path.join(dir_path, "refs.json"), refs_doc)
        _write_json(os.path.join(blocks_dir, "index.json"), index_doc)
        for bid, data in self._blocks.items():
            self._write_block_file(os.path.join(data_dir, bid), data)

    @classmethod
    def load(cls, dir_path: str) -> "ContentStore":
        """从快照目录重建存储并做完整一致性校验。

        校验内容：JSON 可解析且必需字段齐全；每个被索引的块都有内容
        文件、大小与索引一致、内容哈希与块 ID 匹配；引用计数非负且与
        块集合一一对应；清单引用的块全部存在、长度与块内容总长一致、
        整体内容哈希与块序列一致。任何异常包装为
        :class:`StoreCorruptionError`，错误信息指出具体文件 / 字段 / 块。
        """
        meta = _read_json(os.path.join(dir_path, "meta.json"), "meta.json")
        for key in ("version", "block_size", "max_bytes"):
            if key not in meta:
                raise StoreCorruptionError(f"meta.json 缺失字段: {key}")
        if meta["version"] != SNAPSHOT_VERSION:
            raise StoreCorruptionError(
                f"不支持的快照版本: {meta['version']}（支持 {SNAPSHOT_VERSION}）"
            )
        try:
            block_size = int(meta["block_size"])
            max_bytes_raw = meta["max_bytes"]
            max_bytes = (
                None if max_bytes_raw is None else int(max_bytes_raw)
            )
        except (TypeError, ValueError) as exc:
            raise StoreCorruptionError(f"meta.json 字段类型错误: {exc}") from exc

        store = cls(block_size=block_size, max_bytes=max_bytes)

        # -- 块目录索引 -------------------------------------------------- #
        blocks_dir = os.path.join(dir_path, "blocks")
        data_dir = os.path.join(blocks_dir, "data")
        index = _read_json(
            os.path.join(blocks_dir, "index.json"), "blocks/index.json"
        )
        if "blocks" not in index or not isinstance(index["blocks"], list):
            raise StoreCorruptionError(
                "blocks/index.json 缺失 blocks 列表或类型错误"
            )
        for entry in index["blocks"]:
            if not isinstance(entry, dict) or "id" not in entry or "size" not in entry:
                raise StoreCorruptionError(
                    "blocks/index.json 存在缺少 id/size 的条目"
                )
            bid = str(entry["id"])
            try:
                expected_size = int(entry["size"])
            except (TypeError, ValueError) as exc:
                raise StoreCorruptionError(
                    f"块 {bid} 的 size 不是整数"
                ) from exc
            path = os.path.join(data_dir, bid)
            if not os.path.isfile(path):
                raise StoreCorruptionError(f"块内容文件缺失: blocks/data/{bid}")
            try:
                with open(path, "rb") as fh:
                    data = fh.read()
            except OSError as exc:
                raise StoreCorruptionError(
                    f"块内容文件无法读取 blocks/data/{bid}: {exc}"
                ) from exc
            if len(data) != expected_size:
                raise StoreCorruptionError(
                    f"块 {bid} 大小与索引不一致: "
                    f"索引 {expected_size}, 实际 {len(data)}"
                )
            actual_id = hash_bytes(data)
            if actual_id != bid:
                raise StoreCorruptionError(
                    f"块 {bid} 内容哈希不匹配, 实际为 {actual_id}（块内容已损坏或文件名错误）"
                )
            store._blocks[bid] = data

        # -- 引用计数表 -------------------------------------------------- #
        refs_doc = _read_json(os.path.join(dir_path, "refs.json"), "refs.json")
        if "refs" not in refs_doc or not isinstance(refs_doc["refs"], dict):
            raise StoreCorruptionError("refs.json 缺失 refs 对象或类型错误")
        for bid, count in refs_doc["refs"].items():
            if bid not in store._blocks:
                raise StoreCorruptionError(
                    f"refs.json 引用了不存在的块: {bid}"
                )
            if not isinstance(count, int) or count < 0:
                raise StoreCorruptionError(
                    f"块 {bid} 引用计数非法（应为非负整数）: {count!r}"
                )
            store._refs[bid] = count
        missing_refs = set(store._blocks) - set(store._refs)
        if missing_refs:
            raise StoreCorruptionError(
                "以下块在 refs.json 中缺少引用计数记录: "
                + ", ".join(sorted(missing_refs))
            )

        # -- 清单 -------------------------------------------------------- #
        manifests_doc = _read_json(
            os.path.join(dir_path, "manifests.json"), "manifests.json"
        )
        if "manifests" not in manifests_doc or not isinstance(
            manifests_doc["manifests"], list
        ):
            raise StoreCorruptionError(
                "manifests.json 缺失 manifests 列表或类型错误"
            )
        seen_paths: Set[str] = set()
        required_refs: Counter = Counter()
        for raw in manifests_doc["manifests"]:
            try:
                manifest = Manifest.from_dict(raw, validate=True)
            except ManifestValidationError as exc:
                raise StoreCorruptionError(str(exc)) from exc
            if manifest.path in seen_paths:
                raise StoreCorruptionError(
                    f"manifests.json 中路径重复: {manifest.path!r}"
                )
            seen_paths.add(manifest.path)

            for bid in manifest.block_ids:
                if bid not in store._blocks:
                    raise StoreCorruptionError(
                        f"清单 {manifest.path!r} 引用的块不存在: {bid}"
                    )
            actual_length = sum(
                len(store._blocks[bid]) for bid in manifest.block_ids
            )
            if actual_length != manifest.length:
                raise StoreCorruptionError(
                    f"清单 {manifest.path!r} 长度与块内容不符: "
                    f"记录 {manifest.length}, 实拼 {actual_length}"
                )
            # 累加该清单（按块出现次数）的引用需求，全部清单读完后统一比较。
            required_refs.update(manifest.block_ids)
            store._manifests[manifest.path] = manifest

        for bid, need in required_refs.items():
            if store._refs[bid] < need:
                raise StoreCorruptionError(
                    f"块 {bid} 引用计数 {store._refs[bid]} "
                    f"小于全部清单所需引用数 {need}"
                )

        return store

    @staticmethod
    def _write_block_file(path: str, data: bytes) -> None:
        with open(path, "wb") as fh:
            fh.write(data)


# --------------------------------------------------------------------------- #
# JSON 文件辅助
# --------------------------------------------------------------------------- #
def _write_json(path: str, doc: object) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, sort_keys=True, indent=2)


def _read_json(path: str, label: str) -> Dict[str, object]:
    if not os.path.isfile(path):
        raise StoreCorruptionError(f"快照缺少文件: {label}")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except json.JSONDecodeError as exc:
        raise StoreCorruptionError(f"{label} JSON 解析失败（文件已损坏）: {exc}") from exc
    except OSError as exc:
        raise StoreCorruptionError(f"{label} 无法读取: {exc}") from exc
    if not isinstance(doc, dict):
        raise StoreCorruptionError(f"{label} 顶层结构必须是 JSON 对象")
    return doc
