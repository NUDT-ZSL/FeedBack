"""列式列块：一个列块 = 一个 shard 内一个 series 的一个字段的一批点。

磁盘/内存二进制布局（大端）::

    magic   4B  b"TSDB"
    version 1B  当前 1
    enc_ts  1B  时间戳列编码，当前固定 ENC_TS_DELTA_VARINT = 1
    enc_val 1B  数值列编码，当前固定 ENC_VALUE_F64 = 2
    flags   1B  保留，0
    count   u32 点数
    min_ts  i64 最小时间戳
    max_ts  i64 最大时间戳
    ts_payload  时间戳列（首 ts zigzag-varint + 相邻差分 zigzag-varint）
    val_payload IEEE-754 大端双精度，count * 8 字节
    crc32   u32 对以上全部字节的 CRC32

设计取舍（详见 README）：

* 时间戳列采用 **差分 + zigzag + varint**。乱序回填产生的列块内部
  仍是排序去重后的点，正常追加场景差分恒正且很小（秒级采样 1~2 字节/点），
  相对裸 i64 通常有 4~8 倍压缩；varint 自描述长度，解码简单且无需额外字典。
* 数值列采用 **定长 IEEE-754 双精度**。指标数值基数高、字典编码命中率低，
  字典反而要付出索引开销；定长 8 字节支持 ``struct`` 批量解包、随机访问，
  压缩率就是 8 字节/点，CPU 开销最低。作为对比，``array('d')`` 裸存也是
  8 字节/点，这里额外得到了 CRC 保护与自描述格式。

列块对象持有原始字节，时间戳/数值在首次访问时懒解码并缓存——查询裁剪时
只读 16 字节的头部元信息，不碰 payload。
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from . import encoding
from .errors import BlockFormatError

MAGIC = b"TSDB"
VERSION = 1
ENC_TS_DELTA_VARINT = 1
ENC_VALUE_F64 = 2

_HEADER = struct.Struct(">4sBBBBqqI")  # magic,ver,enc_ts,enc_val,flags,min_ts,max_ts,count
_HEADER_SIZE = _HEADER.size
_CRC_SIZE = 4
# 头部之后、payload 之前的固定部分就是 _HEADER；payload 布局见模块 docstring。


@dataclass
class ColumnBlock:
    """一个字段列块。

    通常通过 :meth:`from_points`（写入路径）或 :meth:`from_bytes`
    （加载路径）构造，不要直接填字段。
    """

    series_id: str
    field_name: str
    min_ts: int
    max_ts: int
    count: int
    enc_ts: int = ENC_TS_DELTA_VARINT
    enc_value: int = ENC_VALUE_F64
    payload: bytes = b""
    _timestamps: Optional[List[int]] = field(default=None, repr=False, compare=False)
    _values: Optional[List[float]] = field(default=None, repr=False, compare=False)

    # ---- 构造 ----------------------------------------------------------

    @classmethod
    def from_points(
        cls,
        series_id: str,
        field_name: str,
        timestamps: Sequence[int],
        values: Sequence[float],
    ) -> "ColumnBlock":
        """由等长的 ts/value 序列构造列块。

        要求 ``timestamps`` 已按升序排列（引擎负责排序与去重），且非空。
        """
        if len(timestamps) == 0:
            raise BlockFormatError("空列块不应被创建")
        if len(timestamps) != len(values):
            raise BlockFormatError("时间戳列与数值列长度不一致")
        count = len(timestamps)
        ts_bytes = encoding.encode_deltas(timestamps)
        val_bytes = encoding.doubles_to_bytes(values)
        body = bytearray()
        body.extend(_HEADER.pack(
            MAGIC, VERSION, ENC_TS_DELTA_VARINT, ENC_VALUE_F64, 0,
            timestamps[0], timestamps[-1], count,
        ))
        body.extend(struct.pack(">I", len(ts_bytes)))
        body.extend(ts_bytes)
        body.extend(val_bytes)
        crc = zlib.crc32(bytes(body)) & 0xFFFFFFFF
        body.extend(struct.pack(">I", crc))
        block = cls(
            series_id=series_id,
            field_name=field_name,
            min_ts=timestamps[0],
            max_ts=timestamps[-1],
            count=count,
            payload=bytes(body),
        )
        block._timestamps = list(timestamps)
        block._values = [float(v) for v in values]
        return block

    @classmethod
    def from_bytes(cls, series_id: str, field_name: str, raw: bytes) -> "ColumnBlock":
        """解析列块字节，校验魔数、版本、长度与 CRC；payload 保持懒解码。"""
        if len(raw) < _HEADER_SIZE + 4 + _CRC_SIZE:
            raise BlockFormatError("列块字节过短")
        try:
            magic, version, enc_ts, enc_value, flags, min_ts, max_ts, count = \
                _HEADER.unpack_from(raw, 0)
        except struct.error as exc:
            raise BlockFormatError(f"列块头部解析失败: {exc}") from None
        if magic != MAGIC:
            raise BlockFormatError(f"列块魔数错误: {magic!r}")
        if version != VERSION:
            raise BlockFormatError(f"不支持的列块版本: {version}")
        if enc_ts != ENC_TS_DELTA_VARINT:
            raise BlockFormatError(f"未知时间戳编码: {enc_ts}")
        if enc_value != ENC_VALUE_F64:
            raise BlockFormatError(f"未知数值编码: {enc_value}")
        if count <= 0:
            raise BlockFormatError(f"列块点数非法: {count}")
        if min_ts > max_ts:
            raise BlockFormatError(f"列块 min_ts({min_ts}) > max_ts({max_ts})")
        # CRC 校验
        stored_crc = struct.unpack_from(">I", raw, len(raw) - _CRC_SIZE)[0]
        actual_crc = zlib.crc32(raw[:-_CRC_SIZE]) & 0xFFFFFFFF
        if stored_crc != actual_crc:
            raise BlockFormatError("列块 CRC32 校验失败，数据可能已损坏")
        pos = _HEADER_SIZE
        (ts_len,) = struct.unpack_from(">I", raw, pos)
        pos += 4
        expected_len = pos + ts_len + count * 8 + _CRC_SIZE
        if expected_len != len(raw):
            raise BlockFormatError(
                f"列块长度不一致: 声明 {expected_len} 字节，实际 {len(raw)} 字节"
            )
        return cls(
            series_id=series_id,
            field_name=field_name,
            min_ts=min_ts,
            max_ts=max_ts,
            count=count,
            enc_ts=enc_ts,
            enc_value=enc_value,
            payload=raw,
        )

    # ---- 访问 ----------------------------------------------------------

    def to_bytes(self) -> bytes:
        """返回可落盘的原始字节。"""
        return self.payload

    def _decode(self) -> None:
        if self._timestamps is not None and self._values is not None:
            return
        raw = self.payload
        pos = _HEADER_SIZE
        (ts_len,) = struct.unpack_from(">I", raw, pos)
        pos += 4
        timestamps, pos = encoding.decode_deltas(raw, pos, self.count)
        values, _ = encoding.bytes_to_doubles(raw, pos, self.count)
        if len(timestamps) != self.count:
            raise BlockFormatError("解码出的时间戳数量与头部不一致")
        self._timestamps = timestamps
        self._values = values

    @property
    def timestamps(self) -> List[int]:
        self._decode()
        return self._timestamps  # type: ignore[return-value]

    @property
    def values(self) -> List[float]:
        self._decode()
        return self._values  # type: ignore[return-value]

    def overlaps(self, start: int, end: int) -> bool:
        """列块时间范围是否与左闭右开区间 ``[start, end)`` 相交。"""
        return self.min_ts < end and self.max_ts >= start

    def read_range(self, start: int, end: int) -> Tuple[List[int], List[float]]:
        """只取出落在 ``[start, end)`` 内的点（列块内 ts 已升序、唯一）。"""
        self._decode()
        ts = self._timestamps  # type: ignore[assignment]
        vals = self._values  # type: ignore[assignment]
        # 二分边界，避免整块扫描
        lo = _lower_bound(ts, start)
        hi = _lower_bound(ts, end)
        return ts[lo:hi], vals[lo:hi]

    def size_bytes(self) -> int:
        """列块占用的压缩后字节数。"""
        return len(self.payload)


def _lower_bound(sorted_values: Sequence[int], target: int) -> int:
    """bisect_left 的本地实现（避免在热路径上重复 import，语义一致）。"""
    lo, hi = 0, len(sorted_values)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_values[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo


def merge_block_series(
    blocks: Sequence[ColumnBlock],
    start: int,
    end: int,
) -> Tuple[List[int], List[float]]:
    """把同一 (shard, series, field) 的多个列块合并成按 ts 升序的唯一点序列。

    合并语义（重要）：

    * 列块按 **写入顺序** 排列；不同列块中出现相同 ts 时，
      **后写入列块的值覆盖先写入列块的值**（last-write-wins）。
    * 实现上先让每个列块裁剪到 ``[start, end)``，再把较晚列块的点
      依次写入 ``ts -> value`` 字典，最后按键排序。列块数量通常很少
      （只有乱序回填/覆盖才会产生多个列块），直接合并简单可靠。

    返回 ``(timestamps, values)``，长度相同且 timestamps 严格升序。
    """
    merged: Dict[int, float] = {}
    for block in blocks:  # 顺序即写入顺序，后写的天然覆盖先写的
        if not block.overlaps(start, end):
            continue
        ts_slice, val_slice = block.read_range(start, end)
        for ts, value in zip(ts_slice, val_slice):
            merged[ts] = value
    timestamps = sorted(merged)
    return timestamps, [merged[ts] for ts in timestamps]
