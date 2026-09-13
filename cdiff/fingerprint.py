"""块指纹与整文件指纹。

- 每个内容定义块用 SHA-256 计算强哈希作为**块指纹**（hashes 唯一的
  黑盒就是标准库 ``hashlib``，分块算法本身在 :mod:`cdiff.chunking` 中
  手写实现）；
- **整文件指纹**把块指纹按顺序滚动合并：维护一个 SHA-256 上下文，
  依次喂入每块的强哈希，并在块数、文件总长度上做最终化，得到一个
  单一的十六进制摘要。

局部性：内容中间改动一个字节，滚动哈希只会重切它所在的那一块，
前面的块指纹完全不变，后面的块指纹也整体平移不变；只有受影响块的
块指纹和最终整文件指纹发生变化。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import List, Optional

from .chunking import ChunkConfig, content_defined_chunks

#: 整文件指纹输出格式版本，将来算法变更可借此区分。
FINGERPRINT_VERSION = 1

#: 强哈希算法名。
STRONG_HASH = "sha256"

#: 强哈希十六进制摘要长度。
HEX_LEN = 64


@dataclass(frozen=True)
class ChunkFingerprint:
    """单个内容定义块的指纹。

    :param offset: 块在原内容中的字节偏移。
    :param length: 块长度（字节）。
    :param digest: 块内容的 SHA-256 十六进制摘要。
    """

    offset: int
    length: int
    digest: str

    def to_dict(self) -> dict:
        """序列化为 JSON 友好的字典。"""
        return {"offset": self.offset, "length": self.length, "digest": self.digest}

    @classmethod
    def from_dict(cls, obj: object) -> "ChunkFingerprint":
        """从字典重建并校验字段类型与摘要格式。"""
        if not isinstance(obj, dict):
            raise ValueError("chunk fingerprint must be a JSON object")
        try:
            offset = obj["offset"]
            length = obj["length"]
            digest = obj["digest"]
        except KeyError as exc:
            raise ValueError("missing chunk fingerprint field: %s" % exc) from exc
        if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            raise ValueError("chunk offset must be a non-negative int")
        if (
            not isinstance(length, int)
            or isinstance(length, bool)
            or length < 0
        ):
            raise ValueError("chunk length must be a non-negative int")
        if not isinstance(digest, str) or not _is_sha256_hex(digest):
            raise ValueError("chunk digest must be 64 hex chars")
        return cls(offset=offset, length=length, digest=digest)


def _is_sha256_hex(s: str) -> bool:
    """判断字符串是否为合法的 SHA-256 十六进制摘要。"""
    if len(s) != HEX_LEN:
        return False
    try:
        int(s, 16)
    except ValueError:
        return False
    return True


def _strong_hash(data: bytes) -> str:
    """计算字节内容的 SHA-256 十六进制摘要。"""
    return hashlib.sha256(data).hexdigest()


def merge_chunk_digests(digests: List[str], total_length: int) -> str:
    """把块指纹按顺序滚动合并成整文件指纹。

    合并方式（确定性）：在一个 SHA-256 上下文里依次写入

    1. 每块摘要的十六进制 ASCII 字节；
    2. 块数的 8 字节大端表示；
    3. 总长度的 8 字节大端表示。

    空内容（没有任何块）合并结果为空内容的固定摘要，因此空内容也有
    稳定、可比较的整文件指纹。

    :param digests: 按内容顺序排列的块摘要。
    :param total_length: 内容总字节数。
    """
    ctx = hashlib.sha256()
    for d in digests:
        ctx.update(d.encode("ascii"))
    ctx.update(len(digests).to_bytes(8, "big"))
    ctx.update(total_length.to_bytes(8, "big"))
    return ctx.hexdigest()


@dataclass(frozen=True)
class Fingerprint:
    """整文件指纹结果。

    :param digest: 整文件指纹（块指纹滚动合并后的 SHA-256 十六进制值）。
    :param size: 内容总字节数。
    :param chunk_count: 块数量。
    :param chunk_sizes: 各块长度，顺序与 ``chunks`` 一致。
    :param chunks: 各块的块指纹（偏移、长度、摘要）。
    :param config: 分块配置。
    """

    digest: str
    size: int
    chunk_count: int
    chunk_sizes: List[int] = field(default_factory=list)
    chunks: List[ChunkFingerprint] = field(default_factory=list)
    config: ChunkConfig = field(default_factory=ChunkConfig)

    def __str__(self) -> str:
        return self.digest

    def __eq__(self, other: object) -> bool:  # noqa: D401 - dataclass 语义足够
        if not isinstance(other, Fingerprint):
            return NotImplemented
        return self.digest == other.digest

    def __hash__(self) -> int:
        return hash(self.digest)

    def to_dict(self) -> dict:
        """序列化为 JSON 友好的字典。"""
        return {
            "version": FINGERPRINT_VERSION,
            "algorithm": STRONG_HASH,
            "digest": self.digest,
            "size": self.size,
            "chunk_count": self.chunk_count,
            "chunk_sizes": list(self.chunk_sizes),
            "chunks": [c.to_dict() for c in self.chunks],
            "config": self.config.to_dict(),
        }

    @classmethod
    def from_dict(cls, obj: object) -> "Fingerprint":
        """从字典重建指纹并校验格式（摘要、块结构、配置）。"""
        if not isinstance(obj, dict):
            raise ValueError("fingerprint must be a JSON object")
        digest = obj.get("digest")
        if not isinstance(digest, str) or not _is_sha256_hex(digest):
            raise ValueError("invalid file digest: must be 64 hex chars")
        size = obj.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError("invalid fingerprint size")
        chunks_raw = obj.get("chunks")
        if not isinstance(chunks_raw, list):
            raise ValueError("fingerprint chunks must be a list")
        chunks = [ChunkFingerprint.from_dict(c) for c in chunks_raw]
        sizes_raw = obj.get("chunk_sizes")
        if not isinstance(sizes_raw, list) or not all(
            isinstance(x, int) and not isinstance(x, bool) and x >= 0
            for x in sizes_raw
        ):
            raise ValueError("fingerprint chunk_sizes must be a list of ints")
        if len(sizes_raw) != len(chunks):
            raise ValueError("chunk_sizes length does not match chunks")
        if [c.length for c in chunks] != sizes_raw:
            raise ValueError("chunk_sizes do not match chunk lengths")
        if sum(sizes_raw) != size:
            raise ValueError("chunk sizes do not sum to total size")
        # 偏移必须从 0 连续拼接。
        offset = 0
        for c in chunks:
            if c.offset != offset:
                raise ValueError("chunk offsets are not contiguous")
            offset += c.length
        count = obj.get("chunk_count")
        if count != len(chunks):
            raise ValueError("chunk_count does not match chunks")
        # 强一致性：整文件指纹必须能由块指纹重新合并出来，
        # 任何被篡改/损坏的摘要都过不了这一关。
        recomputed = merge_chunk_digests([c.digest for c in chunks], size)
        if recomputed != digest:
            raise ValueError(
                "file digest does not match the merge of chunk digests: "
                "recorded=%s recomputed=%s" % (digest, recomputed)
            )
        config = ChunkConfig.from_dict(obj.get("config", {}))
        return cls(
            digest=digest,
            size=size,
            chunk_count=len(chunks),
            chunk_sizes=list(sizes_raw),
            chunks=chunks,
            config=config,
        )


def fingerprint(
    data: bytes, config: Optional[ChunkConfig] = None
) -> Fingerprint:
    """计算字节内容的整文件指纹与分块统计。

    :param data: 任意字节内容（包括空内容）。
    :param config: 内容定义分块配置；缺省使用 :class:`ChunkConfig` 默认值。
    :returns: :class:`Fingerprint`，其中

        - ``digest`` 为整文件指纹（十六进制字符串）；
        - ``chunk_sizes`` / ``chunk_count`` 为分块统计；
        - ``chunks`` 为带偏移的块指纹列表。

    同一内容在同一配置下必定得到完全相同的结果。
    """
    cfg = config or ChunkConfig()
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("data must be bytes-like")
    data = bytes(data)

    chunk_fps: List[ChunkFingerprint] = []
    sizes: List[int] = []
    digests: List[str] = []
    for offset, length, chunk_bytes in content_defined_chunks(data, cfg):
        digest = _strong_hash(chunk_bytes)
        chunk_fps.append(
            ChunkFingerprint(offset=offset, length=length, digest=digest)
        )
        sizes.append(length)
        digests.append(digest)

    return Fingerprint(
        digest=merge_chunk_digests(digests, len(data)),
        size=len(data),
        chunk_count=len(chunk_fps),
        chunk_sizes=sizes,
        chunks=chunk_fps,
        config=cfg,
    )
