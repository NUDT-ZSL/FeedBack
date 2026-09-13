"""基于内容定义的分块（Content-Defined Chunking, CDC）。

使用经典的 buzhash（32 位循环滚动哈希）：

- 维护固定大小（``WINDOW_SIZE`` 字节）滑动窗口的哈希
  ``h = XOR_j ROTL^(W-1-j)(table[b_j])``；
- 窗口滑入 b_in、滑出 b_out 时只需
  ``h = ROTL32(h, 1) XOR table[b_out] XOR table[b_in]``；
- 当 ``h & mask == 0`` 时找到一个内容定义边界。

边界只取决于窗口内的字节内容、与绝对位置无关，因此在数据中间插入或
删除一个字节，只会改变它所在的那一块，其后的块边界整体平移、
保持不变 —— 这正是差分能够大量复用旧块的基础。

为避免极端大小的块，边界还受 ``min_size`` / ``max_size`` 约束：
块长不足 min_size 不切；达到 max_size 强制切。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, List

from .errors import InvalidConfigError

#: 滚动哈希使用的 32 位 GF(2) 多项式（生成字节置换表用）。
POLY: int = 0x3DA3358B

#: 滚动窗口大小（字节）。buzhash 要求窗口不超过 32，
#: 这样旧字节的移出项 ROTL(table[b], W) 恰好等于 table[b] 本身。
WINDOW_SIZE: int = 32

_MASK32 = 0xFFFFFFFF


def _rotl32(h: int, n: int) -> int:
    """32 位循环左移。"""
    n &= 31
    return ((h << n) & _MASK32) | (h >> (32 - n))


def _build_buztable() -> List[int]:
    """生成确定性的 256 项 32 位字节置换表。

    每个字节经 32 轮 GF(2) 多项式移位（相当于乘以 x^32 模 POLY），
    输入取 ``b + 1`` 以保证字节 0 也映射到非零值。该映射是双射，
    256 个值两两不同且非零，无需任何随机种子，跨进程稳定。
    """
    table: List[int] = []
    for b in range(256):
        h = b + 1
        for _ in range(32):
            h <<= 1
            if h & 0x100000000:
                h = (h ^ POLY) & _MASK32
            else:
                h &= _MASK32
        table.append(h)
    return table


#: 模块级查表，分块时复用。
BUZ_TABLE: List[int] = _build_buztable()


@dataclass(frozen=True)
class ChunkConfig:
    """内容定义分块的配置。

    :param avg_size: 平均目标块大小（字节），必须 >= 1。
        掩码取 ``2^ceil(log2(avg_size)) - 1``，边界命中率约为
        ``1/2^ceil(log2(avg_size))``，平均块长落在该量级。
    :param min_size: 最小块大小（字节），小于该长度绝不切块。
    :param max_size: 最大块大小（字节），达到该长度强制切块。
    """

    avg_size: int = 1024
    min_size: int = 256
    max_size: int = 4096

    def __post_init__(self) -> None:
        if not isinstance(self.avg_size, int) or isinstance(self.avg_size, bool):
            raise InvalidConfigError("avg_size must be an int")
        if not isinstance(self.min_size, int) or isinstance(self.min_size, bool):
            raise InvalidConfigError("min_size must be an int")
        if not isinstance(self.max_size, int) or isinstance(self.max_size, bool):
            raise InvalidConfigError("max_size must be an int")
        if self.avg_size <= 0:
            raise InvalidConfigError("avg_size must be > 0, got %r" % self.avg_size)
        if self.min_size < 0:
            raise InvalidConfigError("min_size must be >= 0, got %r" % self.min_size)
        if self.max_size <= 0:
            raise InvalidConfigError("max_size must be > 0, got %r" % self.max_size)
        if self.min_size > self.max_size:
            raise InvalidConfigError(
                "min_size (%d) must not exceed max_size (%d)"
                % (self.min_size, self.max_size)
            )

    @property
    def boundary_mask(self) -> int:
        """滚动哈希低位掩码；``h & mask == 0`` 即命中边界。"""
        # avg_size=1024 -> bits=10 -> mask=1023，平均约每 1024 字节命中。
        bits = max(1, self.avg_size - 1).bit_length()
        return (1 << bits) - 1

    def to_dict(self) -> dict:
        """序列化为 JSON 友好的字典。"""
        return {
            "avg_size": self.avg_size,
            "min_size": self.min_size,
            "max_size": self.max_size,
        }

    @classmethod
    def from_dict(cls, obj: object) -> "ChunkConfig":
        """从字典重建配置，缺字段或类型错误时抛 :class:`InvalidConfigError`。"""
        if not isinstance(obj, dict):
            raise InvalidConfigError("chunk config must be a JSON object")
        try:
            return cls(
                avg_size=obj["avg_size"],
                min_size=obj["min_size"],
                max_size=obj["max_size"],
            )
        except KeyError as exc:
            raise InvalidConfigError("missing chunk config field: %s" % exc) from exc
        except TypeError as exc:
            raise InvalidConfigError("invalid chunk config: %s" % exc) from exc


def content_defined_chunks(
    data: bytes, config: ChunkConfig | None = None
) -> Iterator[tuple]:
    """对 ``data`` 做内容定义分块，惰性产出 ``(offset, length, chunk_bytes)``。

    切分规则：

    - 每个块从起点开始重新累计窗口哈希，窗口（``WINDOW_SIZE`` 字节）
      填满之前不判定边界；
    - 块长在 ``min_size``..``max_size`` 之间且窗口哈希命中
      ``h & mask == 0`` 时切块；
    - 块长达到 ``max_size`` 时强制切块；
    - 数据耗尽时收尾，最后一块允许短于 ``min_size``；
    - 空数据不产出任何块。
    """
    cfg = config or ChunkConfig()
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("data must be bytes-like")
    data = bytes(data)

    n = len(data)
    if n == 0:
        return

    mask = cfg.boundary_mask
    min_size = cfg.min_size
    max_size = cfg.max_size

    start = 0
    h = 0
    i = 0
    while i < n:
        b_in = data[i]
        if i - start < WINDOW_SIZE:
            # 窗口尚未在当前块内填满：只做 ROTL + 滑入。
            h = _rotl32(h, 1) ^ BUZ_TABLE[b_in]
        else:
            # 完整窗口：滑入新字节、滑出 start 方向上最旧的字节。
            b_out = data[i - WINDOW_SIZE]
            h = _rotl32(h, 1) ^ BUZ_TABLE[b_out] ^ BUZ_TABLE[b_in]

        length = i - start + 1
        if length >= max_size:
            yield start, length, data[start : i + 1]
            start = i + 1
            h = 0
        elif (
            length >= min_size
            and length > WINDOW_SIZE
            and (h & mask) == 0
        ):
            yield start, length, data[start : i + 1]
            start = i + 1
            h = 0
        i += 1

    if start < n:
        yield start, n - start, data[start:]


def chunk_data(data: bytes, config: ChunkConfig | None = None) -> List[tuple]:
    """立即收集版的 :func:`content_defined_chunks`，便于测试和统计。"""
    return list(content_defined_chunks(data, config))
