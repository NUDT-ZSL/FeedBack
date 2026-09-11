"""增量式字符串排序与归并内核。

用于日志归并和分片排序场景：上游持续推入一批批字符串条目，内核随时支持
按字典序输出全量有序结果、前缀/范围片段，以及多个内核有序结果的归并。

核心设计：

* 每个来源分片（tag）维护自己的有序块列表。块内按 ``(key, tag, seq)``
  升序；活跃块通过二分插入保持有序，写满后冻结为不可变元组。
* 全量/范围/前缀输出都基于堆的多路归并（:class:`MergeIterator`），
  每次从各块当前头部取最小元素，绝不把全量数据重新排序。
* 字符串比较直接使用 Python ``str`` 序。UTF-8 编码保持码点序，因此
  ``str`` 比较结果与 UTF-8 字节序完全一致，等价于"按 key 字节序"。

仅依赖 Python 标准库，可离线运行。
"""

from __future__ import annotations

import bisect
import heapq
import json
import os
from dataclasses import dataclass
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

__all__ = [
    "Entry",
    "SortMergeKernel",
    "MergeIterator",
    "merge_shards",
    "KernelError",
    "ValidationError",
    "CapacityError",
    "PersistenceError",
    "MAX_KEY_BYTES",
    "DEFAULT_BLOCK_SIZE",
]

#: key 的 UTF-8 编码最大字节数。
MAX_KEY_BYTES = 256

#: 默认块大小（每个有序块最多容纳的条目数）。
DEFAULT_BLOCK_SIZE = 1024

#: 快照文件格式标识与版本。
SNAPSHOT_FORMAT = "sortmerge-snapshot"
SNAPSHOT_VERSION = 1


# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------


class KernelError(Exception):
    """内核所有错误的基类。"""


class ValidationError(KernelError, ValueError):
    """条目或参数校验失败（key 为空、tag 为空、seq 非法等）。"""


class CapacityError(KernelError):
    """插入会超过 max_entries 上限，本次插入被拒绝（内核状态不变）。"""


class PersistenceError(KernelError):
    """快照文件损坏、字段缺失或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 条目
# ---------------------------------------------------------------------------


@dataclass(frozen=True, order=True)
class Entry:
    """一条待排序的字符串条目。

    属性:
        key: 非空字符串，UTF-8 编码后不超过 :data:`MAX_KEY_BYTES` 字节。
        tag: 非空字符串，表示来源分片，便于排查。
        seq: 整数，同一 tag 内单调递增，从 1 开始。

    排序规则为 ``(key, tag, seq)`` 升序（dataclass 字段顺序即比较顺序）。
    相同 key 的不同 tag 条目都会保留，不去重。
    """

    key: str
    tag: str
    seq: int

    def __post_init__(self) -> None:
        if not isinstance(self.key, str) or not self.key:
            raise ValidationError(
                "entry key 必须是非空字符串, 得到 %r" % (self.key,)
            )
        encoded_len = len(self.key.encode("utf-8"))
        if encoded_len > MAX_KEY_BYTES:
            raise ValidationError(
                "entry key 的 UTF-8 编码长度 %d 超过上限 %d 字节"
                % (encoded_len, MAX_KEY_BYTES)
            )
        if not isinstance(self.tag, str) or not self.tag:
            raise ValidationError(
                "entry tag 必须是非空字符串, 得到 %r" % (self.tag,)
            )
        # bool 是 int 的子类，但 True/False 不是合法的 seq。
        if isinstance(self.seq, bool) or not isinstance(self.seq, int):
            raise ValidationError("entry seq 必须是整数, 得到 %r" % (self.seq,))
        if self.seq < 1:
            raise ValidationError(
                "entry seq 必须从 1 开始单调递增, 得到 %d" % self.seq
            )

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 友好的字典。"""
        return {"key": self.key, "tag": self.tag, "seq": self.seq}

    @classmethod
    def from_dict(cls, data: object) -> "Entry":
        """从字典反序列化，字段缺失或类型错误抛出 :class:`ValidationError`。"""
        if not isinstance(data, dict):
            raise ValidationError("条目必须是对象, 得到 %r" % (data,))
        missing = {"key", "tag", "seq"} - set(data)
        if missing:
            raise ValidationError("条目缺少字段: %s" % sorted(missing))
        return cls(key=data["key"], tag=data["tag"], seq=data["seq"])


# ---------------------------------------------------------------------------
# 多路归并迭代器
# ---------------------------------------------------------------------------


class MergeIterator:
    """基于堆的 k 路归并迭代器。

    接收若干个各自按 ``(key, tag, seq)`` 升序的可迭代对象，产出全局升序
    序列。每次从堆顶取当前最小条目，并从该条目来源的流中补进下一条，
    复杂度为 O(log k) / 条。相同 key 的条目全部保留，不去重。
    """

    def __init__(self, streams: Iterable[Iterable[Entry]]) -> None:
        self._heap: List[Tuple[Entry, int, Iterator[Entry]]] = []
        self._counter = 0  # 单调递增序号，用于打破堆中条目相等时的平局
        for stream in streams:
            it = iter(stream)
            try:
                first = next(it)
            except StopIteration:
                continue
            # Entry 实现了全序比较；counter 保证永远不会比较到 iterator。
            heapq.heappush(self._heap, (first, self._counter, it))
            self._counter += 1

    def __iter__(self) -> "MergeIterator":
        return self

    def __next__(self) -> Entry:
        if not self._heap:
            raise StopIteration
        entry, _, it = heapq.heappop(self._heap)
        try:
            nxt = next(it)
        except StopIteration:
            pass
        else:
            heapq.heappush(self._heap, (nxt, self._counter, it))
            self._counter += 1
        return entry


def merge_shards(kernels: Iterable["SortMergeKernel"]) -> MergeIterator:
    """把多个内核的有序结果归并成一个迭代器，不修改原内核。

    参数:
        kernels: 若干 :class:`SortMergeKernel` 实例。

    返回:
        按 ``(key, tag, seq)`` 升序产出全部条目的迭代器。
    """
    streams: List[Iterable[Entry]] = []
    for kernel in kernels:
        if not isinstance(kernel, SortMergeKernel):
            raise ValidationError(
                "merge_shards 只接受 SortMergeKernel 实例, 得到 %r" % (kernel,)
            )
        streams.extend(kernel._sorted_streams())
    return MergeIterator(streams)


# ---------------------------------------------------------------------------
# 内部工具：二分定位与前缀上界
# ---------------------------------------------------------------------------


def _bisect_left_key(block: Sequence[Entry], key: str) -> int:
    """在按 (key, tag, seq) 升序的块内，定位第一个 key >= 给定 key 的下标。"""
    lo, hi = 0, len(block)
    while lo < hi:
        mid = (lo + hi) // 2
        if block[mid].key < key:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _prefix_upper_bound(prefix: str) -> Optional[str]:
    """返回大于所有以 prefix 开头的字符串的最小字符串。

    若不存在这样的字符串（前缀由若干 U+10FFFF 组成），返回 None，
    表示前缀匹配范围一直延伸到字符串空间的末尾。
    """
    chars = list(prefix)
    while chars:
        if chars[-1] == "\U0010ffff":
            chars.pop()
        else:
            chars[-1] = chr(ord(chars[-1]) + 1)
            return "".join(chars)
    return None


# ---------------------------------------------------------------------------
# 分片状态
# ---------------------------------------------------------------------------


class _Shard:
    """单个 tag 的有序缓冲：若干冻结块（不可变元组）+ 一个活跃块（有序列表）。"""

    __slots__ = ("blocks", "active")

    def __init__(self) -> None:
        self.blocks: List[Tuple[Entry, ...]] = []  # 已冻结块，各自有序
        self.active: List[Entry] = []  # 活跃块，通过二分插入保持有序

    @property
    def size(self) -> int:
        return sum(len(b) for b in self.blocks) + len(self.active)

    def streams(self) -> List[Iterable[Entry]]:
        """返回该分片全部有序流（冻结块 + 非空活跃块）。"""
        out: List[Iterable[Entry]] = list(self.blocks)
        if self.active:
            out.append(self.active)
        return out


# ---------------------------------------------------------------------------
# 内核
# ---------------------------------------------------------------------------


class SortMergeKernel:
    """分片式有序缓冲内核。

    参数:
        block_size: 每个有序块的最大条目数（默认 1024）。活跃块写满后
            冻结为不可变块，冻结时做一次内部排序确认。
        max_entries: 总条目数上限。``None`` 表示精确模式（无上限）。
            插入会使总数超过上限时，抛出 :class:`CapacityError` 拒绝
            本次插入，内核状态保持不变（不静默丢弃任何数据）。
    """

    def __init__(
        self,
        block_size: int = DEFAULT_BLOCK_SIZE,
        max_entries: Optional[int] = None,
    ) -> None:
        if isinstance(block_size, bool) or not isinstance(block_size, int) or block_size < 1:
            raise ValidationError("block_size 必须是 >= 1 的整数, 得到 %r" % (block_size,))
        if max_entries is not None:
            if isinstance(max_entries, bool) or not isinstance(max_entries, int) or max_entries < 0:
                raise ValidationError(
                    "max_entries 必须是 >= 0 的整数或 None, 得到 %r" % (max_entries,)
                )
        self._block_size = block_size
        self._max_entries = max_entries
        self._shards: Dict[str, _Shard] = {}
        self._total = 0

    # -- 基本属性 ---------------------------------------------------------

    @property
    def block_size(self) -> int:
        """配置的块大小。"""
        return self._block_size

    @property
    def max_entries(self) -> Optional[int]:
        """配置的条目数上限，None 表示无上限（精确模式）。"""
        return self._max_entries

    def __len__(self) -> int:
        return self._total

    # -- 写入 -------------------------------------------------------------

    def insert(self, entry: Entry) -> None:
        """插入一条条目。

        条目先进入对应 tag 的活跃块（二分插入保持块内有序）；活跃块写满
        ``block_size`` 条后冻结为不可变元组，冻结时做一次内部排序确认。

        若插入会超过 ``max_entries``，抛出 :class:`CapacityError`，
        本次插入被拒绝，内核状态不变。
        """
        if not isinstance(entry, Entry):
            raise ValidationError("insert 只接受 Entry 实例, 得到 %r" % (entry,))
        if self._max_entries is not None and self._total >= self._max_entries:
            raise CapacityError(
                "条目总数已达上限 max_entries=%d, 拒绝插入 key=%r tag=%r"
                % (self._max_entries, entry.key, entry.tag)
            )
        shard = self._shards.get(entry.tag)
        if shard is None:
            shard = self._shards[entry.tag] = _Shard()
        bisect.insort(shard.active, entry)
        self._total += 1
        if len(shard.active) >= self._block_size:
            self._freeze(shard)

    @staticmethod
    def _freeze(shard: _Shard) -> None:
        """把活跃块冻结为不可变块。冻结时做一次内部排序确认。"""
        shard.active.sort()  # 活跃块平时即有序，此处为冻结时的排序确认
        shard.blocks.append(tuple(shard.active))
        shard.active = []

    # -- 删除 -------------------------------------------------------------

    def delete(self, key: str, tag: str) -> int:
        """精确移除该 tag 下该 key 的所有条目，返回移除的条数。

        组合不存在时返回 0（明确结果，不静默成功）。删除后该分片的
        剩余条目重新分块，后续查询不会再返回被删条目。
        """
        if not isinstance(key, str) or not key:
            raise ValidationError("delete 的 key 必须是非空字符串, 得到 %r" % (key,))
        if not isinstance(tag, str) or not tag:
            raise ValidationError("delete 的 tag 必须是非空字符串, 得到 %r" % (tag,))
        shard = self._shards.get(tag)
        if shard is None:
            return 0
        kept = [
            e
            for block in shard.blocks
            for e in block
            if e.key != key
        ]
        kept.extend(e for e in shard.active if e.key != key)
        removed = shard.size - len(kept)
        if removed == 0:
            return 0
        # 各块只是各自有序、块间并无范围划分，重新分块前必须先整体排序
        # （Timsort 对若干有序段的拼接接近线性，代价可接受）。
        kept.sort()
        # 重新分块：前面的块填满 block_size，尾部余量进入活跃块。
        shard.blocks = []
        pos = 0
        while pos + self._block_size <= len(kept):
            shard.blocks.append(tuple(kept[pos : pos + self._block_size]))
            pos += self._block_size
        shard.active = kept[pos:]
        self._total -= removed
        if not shard.blocks and not shard.active:
            del self._shards[tag]
        return removed

    # -- 查询 -------------------------------------------------------------

    def _sorted_streams(self) -> List[Iterable[Entry]]:
        """全部有序流（每个分片的每个块一个流）。"""
        streams: List[Iterable[Entry]] = []
        for shard in self._shards.values():
            streams.extend(shard.streams())
        return streams

    def iter_sorted(self) -> MergeIterator:
        """全量有序输出：按 (key, tag, seq) 升序的堆式多路归并迭代器。"""
        return MergeIterator(self._sorted_streams())

    def dump(self) -> List[Entry]:
        """全量有序输出的列表形式。"""
        return list(self.iter_sorted())

    def range_scan(self, start_key: str, end_key: str) -> List[Entry]:
        """返回 [start_key, end_key) 范围内按 (key, tag, seq) 升序的条目。

        利用块内有序做二分定位起点，再顺序扫描到 end_key 边界；
        ``start_key >= end_key`` 时返回空列表。
        """
        if not isinstance(start_key, str) or not isinstance(end_key, str):
            raise ValidationError("range_scan 的边界必须是字符串")
        if start_key >= end_key:
            return []
        slices: List[Iterable[Entry]] = []
        for shard in self._shards.values():
            for block in shard.streams():
                i = _bisect_left_key(block, start_key)
                j = i
                while j < len(block) and block[j].key < end_key:
                    j += 1
                if j > i:
                    slices.append(block[i:j])
        return list(MergeIterator(slices))

    def prefix_scan(self, prefix: str) -> List[Entry]:
        """返回所有 key 以 prefix 开头的条目，按 (key, tag, seq) 升序。

        利用块内有序二分定位前缀起点，再顺序扫描到前缀边界，不做全量
        扫描。prefix 为空字符串时返回全部条目。
        """
        if not isinstance(prefix, str):
            raise ValidationError("prefix 必须是字符串, 得到 %r" % (prefix,))
        if prefix == "":
            return self.dump()
        upper = _prefix_upper_bound(prefix)
        slices: List[Iterable[Entry]] = []
        for shard in self._shards.values():
            for block in shard.streams():
                i = _bisect_left_key(block, prefix)
                j = i
                if upper is None:
                    j = len(block)
                else:
                    while j < len(block) and block[j].key < upper:
                        j += 1
                if j > i:
                    slices.append(block[i:j])
        return list(MergeIterator(slices))

    def top(self, k: int) -> List[Entry]:
        """返回最小的 k 个条目（按 (key, tag, seq) 升序）。k <= 0 返回空。"""
        if isinstance(k, bool) or not isinstance(k, int):
            raise ValidationError("top 的 k 必须是整数, 得到 %r" % (k,))
        if k <= 0:
            return []
        out: List[Entry] = []
        for entry in self.iter_sorted():
            out.append(entry)
            if len(out) >= k:
                break
        return out

    # -- 统计 -------------------------------------------------------------

    def stats(self) -> Dict[str, object]:
        """返回内核统计信息。"""
        num_blocks = sum(len(s.blocks) for s in self._shards.values())
        active_entries = sum(len(s.active) for s in self._shards.values())
        remaining = (
            None if self._max_entries is None else self._max_entries - self._total
        )
        return {
            "total_entries": self._total,
            "num_tags": len(self._shards),
            "num_frozen_blocks": num_blocks,
            "active_entries": active_entries,
            "block_size": self._block_size,
            "max_entries": self._max_entries,
            "capacity_remaining": remaining,
        }

    # -- 持久化 -----------------------------------------------------------

    def save(self, path: str) -> None:
        """把各 tag 的块列表、块边界和统计计数写入 JSON 快照文件。

        先写临时文件再原子替换，避免写一半留下损坏文件。
        """
        shards_doc = {}
        for tag, shard in self._shards.items():
            shards_doc[tag] = {
                "blocks": [[e.to_dict() for e in block] for block in shard.blocks],
                "active": [e.to_dict() for e in shard.active],
            }
        doc = {
            "format": SNAPSHOT_FORMAT,
            "version": SNAPSHOT_VERSION,
            "config": {
                "block_size": self._block_size,
                "max_entries": self._max_entries,
            },
            "shards": shards_doc,
            "stats": {
                "total_entries": self._total,
                "num_tags": len(self._shards),
                "num_frozen_blocks": sum(len(s.blocks) for s in self._shards.values()),
            },
        }
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)

    @classmethod
    def load(cls, path: str) -> "SortMergeKernel":
        """从 JSON 快照重建内核，并做一致性校验。

        校验内容：文件可解析且格式/版本匹配；每个块内按 (key, tag, seq)
        升序；块大小不超过配置；tag 非空；seq >= 1；统计计数非负且
        total_entries 与实际条目数一致。任何一项不满足都抛出
        :class:`PersistenceError`，绝不静默吞掉。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError as exc:
            raise PersistenceError("无法读取快照文件 %r: %s" % (path, exc)) from exc
        try:
            doc = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PersistenceError(
                "快照文件 %r 不是合法 JSON: %s" % (path, exc)
            ) from exc
        if not isinstance(doc, dict):
            raise PersistenceError("快照文件 %r 顶层必须是 JSON 对象" % path)
        if doc.get("format") != SNAPSHOT_FORMAT:
            raise PersistenceError(
                "快照文件 %r 格式标识缺失或不匹配 (期望 %r)" % (path, SNAPSHOT_FORMAT)
            )
        if doc.get("version") != SNAPSHOT_VERSION:
            raise PersistenceError(
                "快照文件 %r 版本 %r 不受支持 (期望 %d)"
                % (path, doc.get("version"), SNAPSHOT_VERSION)
            )

        config = doc.get("config")
        if not isinstance(config, dict):
            raise PersistenceError("快照文件 %r 缺少 config 对象" % path)
        if "block_size" not in config or "max_entries" not in config:
            raise PersistenceError("快照文件 %r 的 config 缺少 block_size/max_entries" % path)
        try:
            kernel = cls(
                block_size=config["block_size"], max_entries=config["max_entries"]
            )
        except ValidationError as exc:
            raise PersistenceError("快照文件 %r 配置非法: %s" % (path, exc)) from exc

        shards_doc = doc.get("shards")
        if not isinstance(shards_doc, dict):
            raise PersistenceError("快照文件 %r 缺少 shards 对象" % path)

        total = 0
        for tag, shard_doc in shards_doc.items():
            if not isinstance(tag, str) or not tag:
                raise PersistenceError("快照文件 %r 中存在空 tag" % path)
            if not isinstance(shard_doc, dict):
                raise PersistenceError("快照文件 %r 中 tag %r 的数据必须是对象" % (path, tag))
            if "blocks" not in shard_doc or "active" not in shard_doc:
                raise PersistenceError(
                    "快照文件 %r 中 tag %r 缺少 blocks/active 字段" % (path, tag)
                )
            shard = _Shard()
            blocks_doc = shard_doc["blocks"]
            if not isinstance(blocks_doc, list):
                raise PersistenceError(
                    "快照文件 %r 中 tag %r 的 blocks 必须是数组" % (path, tag)
                )
            for i, block_doc in enumerate(blocks_doc):
                entries = cls._load_block(
                    path, tag, "blocks[%d]" % i, block_doc, kernel._block_size
                )
                shard.blocks.append(tuple(entries))
                total += len(entries)
            shard.active = cls._load_block(
                path, tag, "active", shard_doc["active"], kernel._block_size
            )
            total += len(shard.active)
            kernel._shards[tag] = shard

        stats = doc.get("stats")
        if not isinstance(stats, dict):
            raise PersistenceError("快照文件 %r 缺少 stats 对象" % path)
        for field in ("total_entries", "num_tags", "num_frozen_blocks"):
            value = stats.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise PersistenceError(
                    "快照文件 %r 的 stats.%s 必须是非负整数, 得到 %r"
                    % (path, field, value)
                )
        if stats["total_entries"] != total:
            raise PersistenceError(
                "快照文件 %r 的 stats.total_entries=%d 与实际条目数 %d 不一致"
                % (path, stats["total_entries"], total)
            )
        kernel._total = total
        return kernel

    @staticmethod
    def _load_block(
        path: str, tag: str, where: str, block_doc: object, block_size: int
    ) -> List[Entry]:
        """解析并校验快照中的一个块，返回条目列表。"""
        if not isinstance(block_doc, list):
            raise PersistenceError(
                "快照文件 %r 中 tag %r 的 %s 必须是数组" % (path, tag, where)
            )
        if len(block_doc) > block_size:
            raise PersistenceError(
                "快照文件 %r 中 tag %r 的 %s 含 %d 条, 超过块大小上限 %d"
                % (path, tag, where, len(block_doc), block_size)
            )
        entries: List[Entry] = []
        for item in block_doc:
            try:
                entry = Entry.from_dict(item)
            except ValidationError as exc:
                raise PersistenceError(
                    "快照文件 %r 中 tag %r 的 %s 含非法条目: %s" % (path, tag, where, exc)
                ) from exc
            if entry.tag != tag:
                raise PersistenceError(
                    "快照文件 %r 中 tag %r 的 %s 含 tag 为 %r 的条目"
                    % (path, tag, where, entry.tag)
                )
            entries.append(entry)
        for i in range(1, len(entries)):
            if entries[i] < entries[i - 1]:
                raise PersistenceError(
                    "快照文件 %r 中 tag %r 的 %s 未按 (key, tag, seq) 升序排列"
                    % (path, tag, where)
                )
        return entries

    # -- 归并 -------------------------------------------------------------

    @staticmethod
    def merge_shards(kernels: Iterable["SortMergeKernel"]) -> MergeIterator:
        """把多个内核的有序结果归并成一个迭代器，不修改原内核。"""
        return merge_shards(kernels)
