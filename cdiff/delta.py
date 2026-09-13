"""差分补丁的生成与应用。

补丁是一串只有两种指令的序列：

- ``COPY(offset, length)``：从旧内容的 ``offset`` 处复制 ``length`` 字节；
- ``ADD(data)``：直接插入字面字节 ``data``。

生成策略：对新旧内容分别用**同一套**内容定义分块配置切块并计算块
指纹；新内容中每个块若其强哈希出现在旧内容中就发 ``COPY``（复用旧
块），块之间无法复用的缝隙合并成尽量少的 ``ADD``。由于内容定义分块
的局部性，中间改动只影响一两个块，其余全部复用。

补丁同时记录它所依赖的**旧文件指纹**与目标新文件指纹，应用端先
校验旧指纹，不符直接报错（并给出两个指纹），绝不产出半成品。
"""

from __future__ import annotations

import base64
import struct
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .chunking import ChunkConfig
from .errors import CorruptPatchError, FingerprintMismatchError
from .fingerprint import Fingerprint, fingerprint

#: 指令类型常量。
COPY = "COPY"
ADD = "ADD"

#: 二进制补丁编码的魔数与格式版本。
_MAGIC = b"CDF1"


@dataclass(frozen=True)
class Copy:
    """从旧内容复制的指令。

    :param offset: 旧内容中的字节偏移（非负）。
    :param length: 复制长度（非负）。
    """

    offset: int
    length: int

    def to_dict(self) -> dict:
        """JSON 序列化。"""
        return {"op": COPY, "offset": self.offset, "length": self.length}


@dataclass(frozen=True)
class Add:
    """插入字面字节的指令。

    :param data: 要插入的原始字节。
    """

    data: bytes

    def to_dict(self) -> dict:
        """JSON 序列化（数据以 base64 表示）。"""
        return {"op": ADD, "data_b64": base64.b64encode(self.data).decode("ascii")}


#: 指令联合类型，仅用于类型注解。
Op = object


def _op_from_dict(obj: object, old_size: Optional[int] = None) -> Op:
    """从 JSON 字典重建一条指令并做严格校验。

    :param old_size: 若已知旧内容大小，则顺带校验 COPY 不越界。
    """
    if not isinstance(obj, dict):
        raise CorruptPatchError("each op must be a JSON object")
    kind = obj.get("op")
    if kind == COPY:
        offset = obj.get("offset")
        length = obj.get("length")
        if not isinstance(offset, int) or isinstance(offset, bool):
            raise CorruptPatchError("COPY offset must be an int")
        if not isinstance(length, int) or isinstance(length, bool):
            raise CorruptPatchError("COPY length must be an int")
        if offset < 0 or length < 0:
            raise CorruptPatchError(
                "COPY range must be non-negative: offset=%d length=%d"
                % (offset, length)
            )
        if old_size is not None and offset + length > old_size:
            raise CorruptPatchError(
                "COPY out of range: offset=%d length=%d but old size=%d"
                % (offset, length, old_size)
            )
        return Copy(offset=offset, length=length)
    if kind == ADD:
        raw = obj.get("data_b64")
        if not isinstance(raw, str):
            raise CorruptPatchError("ADD data_b64 must be a base64 string")
        try:
            data = base64.b64decode(raw, validate=True)
        except ValueError as exc:  # binascii.Error 是 ValueError 子类
            raise CorruptPatchError("ADD data is not valid base64: %s" % exc) from exc
        return Add(data=data)
    raise CorruptPatchError("unknown op type: %r (expected COPY or ADD)" % (kind,))


@dataclass(frozen=True)
class Delta:
    """差分补丁。

    :param ops: 指令序列（:class:`Copy` / :class:`Add`）。
    :param old_fingerprint: 补丁依赖的旧内容整文件指纹。
    :param new_fingerprint: 补丁还原出的目标新内容整文件指纹。
    """

    ops: Tuple[Op, ...]
    old_fingerprint: Fingerprint
    new_fingerprint: Fingerprint

    @property
    def config(self) -> ChunkConfig:
        """补丁使用的分块配置（取自旧指纹）。"""
        return self.old_fingerprint.config

    def stats(self) -> dict:
        """统计：补丁字节数、各指令数、复用/新增字节数。"""
        copy_ops = sum(1 for o in self.ops if isinstance(o, Copy))
        add_ops = sum(1 for o in self.ops if isinstance(o, Add))
        copied = sum(o.length for o in self.ops if isinstance(o, Copy))
        added = sum(len(o.data) for o in self.ops if isinstance(o, Add))
        return {
            "patch_size": patch_size(self),
            "copy_ops": copy_ops,
            "add_ops": add_ops,
            "copied_bytes": copied,
            "added_bytes": added,
            "old_size": self.old_fingerprint.size,
            "new_size": self.new_fingerprint.size,
        }

    def to_dict(self) -> dict:
        """序列化为 JSON 友好的字典。"""
        return {
            "format": "cdiff-delta",
            "version": 1,
            "ops": [o.to_dict() for o in self.ops],
            "old_fingerprint": self.old_fingerprint.to_dict(),
            "new_fingerprint": self.new_fingerprint.to_dict(),
            "config": self.config.to_dict(),
            "stats": self.stats(),
        }

    @classmethod
    def from_dict(cls, obj: object) -> "Delta":
        """从字典重建补丁并校验一致性。

        校验内容：顶层结构、指令类型合法、COPY 非负且不超出旧内容、
        ADD 的 base64 可解码、新旧指纹格式合法且配置一致、统计与
        指令自洽。任何一项不满足都抛 :class:`CorruptPatchError`。
        """
        if not isinstance(obj, dict):
            raise CorruptPatchError("delta must be a JSON object")
        if "old_fingerprint" not in obj:
            raise CorruptPatchError("missing old_fingerprint")
        if "new_fingerprint" not in obj:
            raise CorruptPatchError("missing new_fingerprint")
        if "ops" not in obj:
            raise CorruptPatchError("missing ops")
        try:
            old_fp = Fingerprint.from_dict(obj["old_fingerprint"])
            new_fp = Fingerprint.from_dict(obj["new_fingerprint"])
        except ValueError as exc:
            raise CorruptPatchError("invalid fingerprint in patch: %s" % exc) from exc

        ops_raw = obj["ops"]
        if not isinstance(ops_raw, list):
            raise CorruptPatchError("ops must be a list")
        ops = tuple(_op_from_dict(o, old_size=old_fp.size) for o in ops_raw)

        if "config" in obj:
            try:
                cfg = ChunkConfig.from_dict(obj["config"])
            except ValueError as exc:
                raise CorruptPatchError(str(exc)) from exc
            if cfg != old_fp.config:
                raise CorruptPatchError(
                    "patch config does not match old fingerprint config"
                )

        delta = cls(ops=ops, old_fingerprint=old_fp, new_fingerprint=new_fp)

        # 统计自洽性：拼出的总长度必须等于新文件大小。
        total = sum(
            o.length if isinstance(o, Copy) else len(o.data) for o in ops
        )
        if total != new_fp.size:
            raise CorruptPatchError(
                "ops produce %d bytes but new_fingerprint size is %d"
                % (total, new_fp.size)
            )

        stats_raw = obj.get("stats")
        if isinstance(stats_raw, dict) and "patch_size" in stats_raw:
            saved_size = stats_raw["patch_size"]
            actual_size = patch_size(delta)
            if saved_size != actual_size:
                raise CorruptPatchError(
                    "patch_size mismatch: recorded %d but encoded patch is %d bytes"
                    % (saved_size, actual_size)
                )
        return delta

    # -- 紧凑二进制编码 -------------------------------------------------

    def encode(self) -> bytes:
        """把指令序列编码为紧凑二进制格式。

        布局：魔数 ``CDF1`` 后逐条拼接指令：

        - COPY：``0x01`` + offset(uint64 BE) + length(uint64 BE)；
        - ADD ：``0x02`` + length(uint64 BE) + 原始字节。
        """
        out = [_MAGIC]
        for op in self.ops:
            if isinstance(op, Copy):
                out.append(b"\x01")
                out.append(struct.pack(">QQ", op.offset, op.length))
            else:
                assert isinstance(op, Add)
                out.append(b"\x02")
                out.append(struct.pack(">Q", len(op.data)))
                out.append(op.data)
        return b"".join(out)

    @classmethod
    def decode_ops(cls, blob: bytes) -> Tuple[Op, ...]:
        """解码 :meth:`encode` 的指令字节流，截断/非法时抛错。"""
        stream = bytes(blob)
        if len(stream) < 4 or stream[:4] != _MAGIC:
            raise CorruptPatchError("binary patch has bad magic or is truncated")
        pos = 4
        ops: List[Op] = []
        n = len(stream)
        while pos < n:
            tag = stream[pos]
            pos += 1
            if tag == 0x01:
                if pos + 16 > n:
                    raise CorruptPatchError("truncated COPY op in binary patch")
                offset, length = struct.unpack(">QQ", stream[pos : pos + 16])
                pos += 16
                ops.append(Copy(offset=offset, length=length))
            elif tag == 0x02:
                if pos + 8 > n:
                    raise CorruptPatchError("truncated ADD header in binary patch")
                (length,) = struct.unpack(">Q", stream[pos : pos + 8])
                pos += 8
                if pos + length > n:
                    raise CorruptPatchError("truncated ADD data in binary patch")
                ops.append(Add(data=stream[pos : pos + length]))
                pos += length
            else:
                raise CorruptPatchError(
                    "unknown binary op tag: 0x%02x" % tag
                )
        return tuple(ops)


def _normalize_ops(ops: List[Op]) -> Tuple[Op, ...]:
    """合并相邻同类型指令：丢弃零长指令，连续 ADD 合并、连续且引用
    旧内容相邻区间的 COPY 合并，使补丁更短。"""
    merged: List[Op] = []
    for op in ops:
        if isinstance(op, Copy):
            if op.length == 0:
                continue
            if (
                merged
                and isinstance(merged[-1], Copy)
                and merged[-1].offset + merged[-1].length == op.offset
            ):
                merged[-1] = Copy(
                    offset=merged[-1].offset,
                    length=merged[-1].length + op.length,
                )
            else:
                merged.append(op)
        else:
            assert isinstance(op, Add)
            if not op.data:
                continue
            if merged and isinstance(merged[-1], Add):
                merged[-1] = Add(data=merged[-1].data + op.data)
            else:
                merged.append(op)
    return tuple(merged)


def diff(old: bytes, new: bytes, config: Optional[ChunkConfig] = None) -> Delta:
    """生成把 ``old`` 变成 ``new`` 的差分补丁。

    :param old: 旧内容字节。
    :param new: 新内容字节。
    :param config: 分块配置，新旧内容使用同一配置。
    :returns: :class:`Delta`；完全相同的内容得到只含 COPY 的补丁，
        空内容/单字节等边界情况同样适用。
    """
    if not isinstance(old, (bytes, bytearray, memoryview)):
        raise TypeError("old must be bytes-like")
    if not isinstance(new, (bytes, bytearray, memoryview)):
        raise TypeError("new must be bytes-like")
    old = bytes(old)
    new = bytes(new)
    cfg = config or ChunkConfig()

    fp_old = fingerprint(old, cfg)
    fp_new = fingerprint(new, cfg)

    # 块摘要 -> 旧内容中出现的偏移列表；每复用一次就弹出一个，
    # 保证重复块的复用次数不超过旧内容中的实际份数。
    locations: Dict[str, List[int]] = {}
    for cf in fp_old.chunks:
        locations.setdefault(cf.digest, []).append(cf.offset)

    ops: List[Op] = []
    cursor = 0  # 新内容中尚未被指令覆盖的位置
    for cf in fp_new.chunks:
        candidates = locations.get(cf.digest)
        if candidates:
            old_offset = candidates.pop(0)
            gap = new[cursor : cf.offset]
            if gap:
                ops.append(Add(data=gap))
            ops.append(Copy(offset=old_offset, length=cf.length))
            cursor = cf.offset + cf.length
    tail = new[cursor:]
    if tail:
        ops.append(Add(data=tail))

    return Delta(
        ops=_normalize_ops(ops),
        old_fingerprint=fp_old,
        new_fingerprint=fp_new,
    )


def patch(old: bytes, delta: Delta) -> bytes:
    """仅凭旧内容和补丁还原新内容。

    :param old: 旧内容字节。
    :param delta: :func:`diff` 生成或 :func:`cdiff.load_delta` 读回的补丁。
    :raises FingerprintMismatchError: 旧内容指纹与补丁记录不一致，
        错误对象上带有 ``expected`` / ``actual`` 两个指纹。
    :raises CorruptPatchError: 指令非法、COPY 越界等。
    """
    if not isinstance(old, (bytes, bytearray, memoryview)):
        raise TypeError("old must be bytes-like")
    old = bytes(old)
    if not isinstance(delta, Delta):
        raise CorruptPatchError("patch() expects a Delta object")

    # 1) 版本校验：先算指纹再做任何拼接，不符直接失败。
    actual_fp = fingerprint(old, delta.old_fingerprint.config)
    if actual_fp.digest != delta.old_fingerprint.digest:
        raise FingerprintMismatchError(
            expected=delta.old_fingerprint.digest,
            actual=actual_fp.digest,
        )

    # 2) 先整体校验所有指令，确保绝不返回半成品。
    parts: List[bytes] = []
    for op in delta.ops:
        if isinstance(op, Copy):
            end = op.offset + op.length
            if op.offset < 0 or op.length < 0 or end > len(old):
                raise CorruptPatchError(
                    "COPY out of range: offset=%d length=%d old_size=%d"
                    % (op.offset, op.length, len(old))
                )
            parts.append(old[op.offset:end])
        elif isinstance(op, Add):
            parts.append(op.data)
        else:
            raise CorruptPatchError("invalid op object: %r" % (op,))

    result = b"".join(parts)

    # 3) 还原结果必须与补丁记录的新指纹一致，防止补丁本身损坏。
    if fingerprint(result, delta.new_fingerprint.config).digest != (
        delta.new_fingerprint.digest
    ):
        raise CorruptPatchError(
            "rebuilt data does not match the new fingerprint recorded in patch"
        )
    return result


def patch_size(delta: Delta) -> int:
    """返回补丁的紧凑二进制编码字节数，用于衡量补丁大小。"""
    return len(delta.encode())
