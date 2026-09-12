"""滚动哈希分块与差量补丁内核（仅 Python 标准库）。

功能：
  - 内容定义分块（gear 滚动哈希，低 mask_bits 位全 0 时切分）
  - FingerprintIndex：弱哈希筛选 + 强哈希复核的块指纹索引
  - diff(old, new) -> Patch（COPY / INSERT 指令序列）
  - apply(old, patch, out) 边写边校验，失败不留半成品；支持 dry_run

约束：
  - 单次读取缓冲 <= READ_SIZE (4MB)，全程流式，不把整文件读入内存
  - 索引只存 chunk_id 与长度，不存块内容
"""

from __future__ import annotations

import hashlib
import os
import struct
import tempfile
import zlib
from collections import namedtuple
from dataclasses import dataclass

__all__ = [
    "ChunkParams",
    "Copy",
    "Insert",
    "Patch",
    "FingerprintIndex",
    "PatchMismatch",
    "UnsupportedPatch",
    "iter_chunks",
    "diff",
    "apply",
    "READ_SIZE",
    "MAX_INSERT",
]

# 单次读取缓冲上限：4MB
READ_SIZE = 4 * 1024 * 1024
# 单条 INSERT 指令的合并上限（相邻 INSERT 合并，但不超过 4MB）
MAX_INSERT = 4 * 1024 * 1024
# 强哈希：sha256 前 16 字节
STRONG_LEN = 16

PATCH_MAGIC = b"RDPATCH\x00"
PATCH_VERSION = 1

_MASK64 = 0xFFFFFFFFFFFFFFFF


class PatchMismatch(Exception):
    """apply 校验失败：COPY 指令在 old 中重算的强哈希与 chunk_id 不一致。"""


class UnsupportedPatch(Exception):
    """补丁魔数或版本号不认识。"""


# ---------------------------------------------------------------------------
# 滚动哈希（gear hash，FastCDC 风格）
# ---------------------------------------------------------------------------

def _build_gear_table():
    """确定性生成 256 个 64 位随机常数（不依赖 random 模块的版本稳定性）。"""
    table = []
    counter = 0
    while len(table) < 256:
        block = hashlib.sha256(
            b"delta-kernel-gear-v1" + counter.to_bytes(4, "little")
        ).digest()
        for k in range(0, 32, 8):
            table.append(int.from_bytes(block[k:k + 8], "little"))
        counter += 1
    return table


_GEAR = _build_gear_table()


@dataclass(frozen=True)
class ChunkParams:
    """分块参数。mask_bits 决定平均块长（约 2**mask_bits 字节）。"""

    min_size: int = 2048
    max_size: int = 16384
    mask_bits: int = 12

    def __post_init__(self):
        if not (1 <= self.mask_bits <= 63):
            raise ValueError(
                f"mask_bits={self.mask_bits} 越界，合法范围 1..63"
            )
        if self.min_size < 1:
            raise ValueError(f"min_size={self.min_size} 不合法，必须 >= 1")
        if self.min_size > self.max_size:
            raise ValueError(
                f"min_size={self.min_size} > max_size={self.max_size}，"
                "min_size 不能大于 max_size"
            )


# ---------------------------------------------------------------------------
# 流式分块
# ---------------------------------------------------------------------------

def _iter_chunks_stream(f, params):
    """从文件对象流式产出 (offset, chunk_bytes)。

    分块结果只取决于字节流内容，与每次 read 的大小无关。
    单次 read 不超过 READ_SIZE，单个 chunk 不超过 max_size。
    """
    min_size = params.min_size
    max_size = params.max_size
    mask = (1 << params.mask_bits) - 1
    gear = _GEAR
    m64 = _MASK64

    chunk = bytearray()
    h = 0
    base = 0  # 当前 chunk 在流中的起始偏移

    while True:
        buf = f.read(READ_SIZE)
        if not buf:
            break
        i, n = 0, len(buf)
        while i < n:
            # min_size 之前不切：直接填充，不累计哈希
            if len(chunk) < min_size:
                take = min(min_size - len(chunk), n - i)
                chunk += buf[i:i + take]
                i += take
                h = 0
                if len(chunk) < min_size:
                    continue
            # min_size..max_size 区间：逐字节滚动哈希，低 mask_bits 位全 0 即切
            room = max_size - len(chunk)
            end = min(n, i + room)
            j = i
            cut = -1
            while j < end:
                h = ((h << 1) + gear[buf[j]]) & m64
                j += 1
                if (h & mask) == 0:
                    cut = j
                    break
            chunk += buf[i:j]
            i = j
            if cut >= 0 or len(chunk) >= max_size:
                size = len(chunk)
                yield base, bytes(chunk)
                base += size
                chunk.clear()
                h = 0
            # 否则：缓冲区耗尽但块未结束，保留 h 与 chunk 进入下一次 read
    if chunk:
        yield base, bytes(chunk)


def iter_chunks(path, params=None):
    """对文件做内容定义分块，产出 (offset, chunk_bytes)。流式读取。"""
    if params is None:
        params = ChunkParams()
    if not os.path.isfile(path):
        raise FileNotFoundError(f"文件不存在: {path}")
    with open(path, "rb") as f:
        yield from _iter_chunks_stream(f, params)


# ---------------------------------------------------------------------------
# 指纹索引
# ---------------------------------------------------------------------------

def strong_id(data):
    """强哈希：sha256 前 16 字节。"""
    return hashlib.sha256(data).digest()[:STRONG_LEN]


class FingerprintIndex:
    """块指纹索引：弱哈希(adler32)做候选筛选，强哈希(sha256前16字节)复核。

    只存 chunk_id 与长度，不存块内容。
    """

    def __init__(self):
        # weak32 -> {chunk_id: length}
        self._by_weak = {}

    @staticmethod
    def weak(data):
        return zlib.adler32(data)

    @staticmethod
    def strong(data):
        return strong_id(data)

    def add(self, chunk_id, data):
        sid = strong_id(data)
        if chunk_id != sid:
            raise ValueError(
                "chunk_id 与 data 的强哈希不一致，拒绝入索引"
            )
        w = self.weak(data)
        self._by_weak.setdefault(w, {})[chunk_id] = len(data)

    def lookup(self, data):
        """返回 chunk_id 或 None。弱哈希命中后必须用强哈希复核。"""
        candidates = self._by_weak.get(self.weak(data))
        if not candidates:
            return None
        sid = strong_id(data)
        length = candidates.get(sid)
        if length is not None and length == len(data):
            return sid
        return None

    def __len__(self):
        return sum(len(v) for v in self._by_weak.values())


# ---------------------------------------------------------------------------
# 补丁
# ---------------------------------------------------------------------------

Copy = namedtuple("Copy", ["chunk_id", "offset", "length"])
Insert = namedtuple("Insert", ["data"])

_HEADER = struct.Struct("<8sBIII")   # magic, version, min_size, max_size, mask_bits
_COPY_REC = struct.Struct("<c16sQQ")  # 'C', chunk_id, offset, length
_INS_REC = struct.Struct("<cQ")       # 'I', length


class Patch:
    """COPY(chunk_id, offset, length) 与 INSERT(bytes) 的有序指令列表。"""

    def __init__(self, params=None, instructions=None):
        self.params = params if params is not None else ChunkParams()
        self.instructions = list(instructions) if instructions else []

    def stats(self):
        """返回 (copy_bytes, insert_bytes, instruction_count)。"""
        copy_bytes = 0
        insert_bytes = 0
        for ins in self.instructions:
            if isinstance(ins, Copy):
                copy_bytes += ins.length
            else:
                insert_bytes += len(ins.data)
        return copy_bytes, insert_bytes, len(self.instructions)

    def to_bytes(self):
        p = self.params
        parts = [_HEADER.pack(PATCH_MAGIC, PATCH_VERSION,
                              p.min_size, p.max_size, p.mask_bits)]
        for ins in self.instructions:
            if isinstance(ins, Copy):
                parts.append(_COPY_REC.pack(b"C", ins.chunk_id,
                                            ins.offset, ins.length))
            else:
                parts.append(_INS_REC.pack(b"I", len(ins.data)))
                parts.append(ins.data)
        return b"".join(parts)

    @classmethod
    def from_bytes(cls, blob):
        if len(blob) < _HEADER.size or blob[:8] != PATCH_MAGIC:
            raise UnsupportedPatch("不认识的补丁格式（魔数不匹配）")
        _, version, min_size, max_size, mask_bits = _HEADER.unpack_from(blob, 0)
        if version != PATCH_VERSION:
            raise UnsupportedPatch(
                f"不支持的补丁版本号: {version}（当前支持 {PATCH_VERSION}）"
            )
        params = ChunkParams(min_size=min_size, max_size=max_size,
                             mask_bits=mask_bits)
        instructions = []
        pos = _HEADER.size
        try:
            while pos < len(blob):
                op = blob[pos:pos + 1]
                if op == b"C":
                    _, chunk_id, offset, length = _COPY_REC.unpack_from(blob, pos)
                    instructions.append(Copy(chunk_id, offset, length))
                    pos += _COPY_REC.size
                elif op == b"I":
                    _, length = _INS_REC.unpack_from(blob, pos)
                    pos += _INS_REC.size
                    data = blob[pos:pos + length]
                    if len(data) != length:
                        raise UnsupportedPatch("补丁数据被截断（INSERT 不完整）")
                    instructions.append(Insert(data))
                    pos += length
                else:
                    raise UnsupportedPatch(f"不认识的指令操作码: {op!r}")
        except struct.error as exc:
            raise UnsupportedPatch(f"补丁数据被截断: {exc}") from exc
        return cls(params=params, instructions=instructions)


# ---------------------------------------------------------------------------
# diff / apply
# ---------------------------------------------------------------------------

def diff(old_path, new_path, params=None):
    """生成 old -> new 的差量补丁。全程流式，单次读取不超过 4MB。"""
    if params is None:
        params = ChunkParams()
    for p in (old_path, new_path):
        if not os.path.isfile(p):
            raise FileNotFoundError(f"文件不存在: {p}")

    # 第一遍：分块 old，建立指纹索引与 chunk_id -> (offset, length) 映射
    index = FingerprintIndex()
    locations = {}
    with open(old_path, "rb") as f:
        for offset, data in _iter_chunks_stream(f, params):
            cid = strong_id(data)
            index.add(cid, data)
            locations.setdefault(cid, (offset, len(data)))

    # 第二遍：分块 new，命中发 COPY，未命中累积 INSERT（相邻合并，上限 4MB）
    instructions = []
    pending = bytearray()

    def flush_insert(force=False):
        while pending and (force or len(pending) >= MAX_INSERT):
            piece = bytes(pending[:MAX_INSERT])
            del pending[:MAX_INSERT]
            instructions.append(Insert(piece))

    with open(new_path, "rb") as f:
        for _offset, data in _iter_chunks_stream(f, params):
            cid = index.lookup(data)
            if cid is None:
                pending += data
                if len(pending) >= MAX_INSERT:
                    flush_insert()
            else:
                flush_insert(force=True)
                old_off, old_len = locations[cid]
                instructions.append(Copy(cid, old_off, old_len))
    flush_insert(force=True)

    return Patch(params=params, instructions=instructions)


def apply(old_path, patch, out_path, dry_run=False):
    """应用补丁。边写边校验每个 COPY 的强哈希；失败时 out_path 不留半成品。

    dry_run=True 时只做校验与统计，不落盘。
    返回 (copy_bytes, insert_bytes, instruction_count)。
    """
    if not os.path.isfile(old_path):
        raise FileNotFoundError(f"文件不存在: {old_path}")

    copy_bytes = 0
    insert_bytes = 0
    tmp_path = None
    out_f = None
    try:
        with open(old_path, "rb") as old:
            if not dry_run:
                out_dir = os.path.dirname(os.path.abspath(out_path))
                fd, tmp_path = tempfile.mkstemp(
                    dir=out_dir, prefix=".patch-tmp-")
                out_f = os.fdopen(fd, "wb")
            for idx, ins in enumerate(patch.instructions):
                if isinstance(ins, Copy):
                    old.seek(ins.offset)
                    remaining = ins.length
                    hasher = hashlib.sha256()
                    while remaining > 0:
                        block = old.read(min(READ_SIZE, remaining))
                        if not block:
                            raise PatchMismatch(
                                f"第 {idx} 条指令：old 文件在 offset="
                                f"{ins.offset} 处长度不足 {ins.length} 字节"
                            )
                        hasher.update(block)
                        if out_f is not None:
                            out_f.write(block)
                        remaining -= len(block)
                    if hasher.digest()[:STRONG_LEN] != ins.chunk_id:
                        raise PatchMismatch(
                            f"第 {idx} 条指令：COPY 强哈希校验失败 "
                            f"(offset={ins.offset}, length={ins.length})"
                        )
                    copy_bytes += ins.length
                else:
                    if out_f is not None:
                        out_f.write(ins.data)
                    insert_bytes += len(ins.data)
        if out_f is not None:
            out_f.close()
            out_f = None
            os.replace(tmp_path, out_path)
            tmp_path = None
    finally:
        if out_f is not None:
            out_f.close()
        if tmp_path is not None and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return copy_bytes, insert_bytes, len(patch.instructions)
