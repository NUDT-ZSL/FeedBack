"""列块使用的底层编码原语（全部基于标准库）。

提供三类无依赖的小工具：

1. **VarInt + ZigZag**：把任意带符号 64 位整数编码成变长字节。
   时间戳列先做差分（相邻 ts 之差，可能为负），再用 zigzag 把负数
   映射成无符号数，最后 varint 编码。单调递增的秒级/毫秒级时间戳
   差分通常是小的正数，1~2 个字节即可表示一个差值。
2. **IEEE-754 双精度**：``struct.pack(">d")`` 定长 8 字节存浮点值。
3. **CRC32 校验**：每个列块尾部带 CRC，加载时可发现字节级损坏。
"""

from __future__ import annotations

import struct
from typing import Iterable, List, Tuple


def zigzag_encode(value: int) -> int:
    """带符号整数 -> 无符号整数：``0,-1,1,-2,2 ... -> 0,1,2,3,4 ...``。

    用算术异或 -1 而不是固定移 63 位，兼容任意大小的 Python int。
    """
    return (value << 1) ^ (0 if value >= 0 else -1)


def zigzag_decode(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def encode_varint(value: int) -> bytes:
    """无符号 64 位整数的 LEB128 变长编码。"""
    if value < 0:
        raise ValueError(f"varint 只能编码非负整数，收到 {value}")
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def decode_varint(buf: bytes, pos: int) -> Tuple[int, int]:
    """从 ``buf[pos]`` 解码一个 varint，返回 ``(值, 新位置)``。"""
    result = 0
    shift = 0
    while True:
        if pos >= len(buf):
            raise ValueError("varint 被截断")
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            break
        shift += 7
        if shift > 63:
            raise ValueError("varint 超过 64 位")
    return result, pos


def encode_varint_list(values: Iterable[int]) -> bytes:
    out = bytearray()
    for value in values:
        out.extend(encode_varint(value))
    return bytes(out)


def decode_varint_list(buf: bytes, pos: int, count: int) -> Tuple[List[int], int]:
    """连续解码 ``count`` 个 varint。"""
    result: List[int] = []
    for _ in range(count):
        value, pos = decode_varint(buf, pos)
        result.append(value)
    return result, pos


def encode_signed_varint_list(values: Iterable[int]) -> bytes:
    """整数列表：逐个 zigzag 后 varint（时间差序列用）。"""
    return encode_varint_list(zigzag_encode(v) for v in values)


def decode_signed_varint_list(buf: bytes, pos: int, count: int) -> Tuple[List[int], int]:
    encoded, pos = decode_varint_list(buf, pos, count)
    return [zigzag_decode(v) for v in encoded], pos


def doubles_to_bytes(values: Iterable[float]) -> bytes:
    """浮点序列 -> 大端 IEEE-754 定长字节（每值 8 字节）。"""
    return b"".join(struct.pack(">d", value) for value in values)


def bytes_to_doubles(buf: bytes, pos: int, count: int) -> Tuple[List[float], int]:
    end = pos + count * 8
    if end > len(buf):
        raise ValueError("浮点列被截断")
    return [struct.unpack(">d", buf[pos + i * 8 : pos + (i + 1) * 8])[0]
            for i in range(count)], end


def encode_deltas(timestamps: Iterable[int]) -> bytes:
    """时间戳列差分编码：存第一个 ts + 相邻差值（zigzag-varint）。

    输入会被物化成列表，长度由调用方保证。
    """
    ts = list(timestamps)
    if not ts:
        return b""
    out = bytearray(encode_varint(zigzag_encode(ts[0])))
    out.extend(encode_signed_varint_list(b - a for a, b in zip(ts, ts[1:])))
    return bytes(out)


def decode_deltas(buf: bytes, pos: int, count: int) -> Tuple[List[int], int]:
    """差分时间戳列解码，还原为绝对时间戳列表。"""
    if count == 0:
        return [], pos
    first_encoded, pos = decode_varint(buf, pos)
    timestamps: List[int] = [zigzag_decode(first_encoded)]
    if count > 1:
        deltas, pos = decode_signed_varint_list(buf, pos, count - 1)
        for delta in deltas:
            timestamps.append(timestamps[-1] + delta)
    return timestamps, pos
