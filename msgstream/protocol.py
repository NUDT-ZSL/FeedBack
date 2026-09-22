"""Wire protocol definition shared by the encoder helpers and the decoder.

Frame layout (all integers big-endian)::

    +0  u8    magic 0xA5
    +1  u8    magic 0x5A
    +2  u8    structure version (0x01 = legacy v1, 0x02 = v2)
    +3  u32   payload length in bytes
    +7  ...   payload: sequence of TLV fields

TLV field layout::

    +0  u8    field id
    +1  u8    wire type (1=u32, 2=utf-8 string, 3=bool, 4=raw bytes)
    +2  u16   value length
    +4  ...   value bytes
"""
from __future__ import annotations

import struct

MAGIC = b"\xA5\x5A"
HEADER_SIZE = 7
MAX_PAYLOAD = 1 << 20  # 1 MiB sanity bound for the declared payload length

V1 = 0x01
V2 = 0x02
KNOWN_VERSIONS = (V1, V2)

T_U32 = 1
T_STR = 2
T_BOOL = 3
T_BYTES = 4

F_MSG_ID = 1
F_SENDER = 2
F_BODY = 3
F_PRIORITY = 4  # v2 only, optional, default 0
F_SENT_AT = 5   # v2 only, optional, default 0
EXT_FIELD_MIN = 0x80  # ids >= this are extensions unknown to both versions

V1_FIELDS = {F_MSG_ID: T_U32, F_SENDER: T_STR, F_BODY: T_STR}
V2_FIELDS = dict(V1_FIELDS)
V2_FIELDS.update({F_PRIORITY: T_U32, F_SENT_AT: T_U32})

REQUIRED = (F_MSG_ID, F_SENDER, F_BODY)
DEFAULTS = {F_PRIORITY: 0, F_SENT_AT: 0}


def _field(fid: int, ftype: int, raw: bytes) -> bytes:
    return struct.pack(">BBH", fid, ftype, len(raw)) + raw


def field_u32(fid: int, value: int) -> bytes:
    return _field(fid, T_U32, struct.pack(">I", value))


def field_str(fid: int, text: str) -> bytes:
    return _field(fid, T_STR, text.encode("utf-8"))


def field_bool(fid: int, value: bool) -> bytes:
    return _field(fid, T_BOOL, b"\x01" if value else b"\x00")


def field_bytes(fid: int, raw: bytes) -> bytes:
    return _field(fid, T_BYTES, raw)


def frame(version: int, payload: bytes) -> bytes:
    return MAGIC + struct.pack(">BI", version, len(payload)) + payload


def build_v1(msg_id: int, sender: str, body: str, extra: bytes = b"") -> bytes:
    payload = field_u32(F_MSG_ID, msg_id) + field_str(F_SENDER, sender) + field_str(F_BODY, body) + extra
    return frame(V1, payload)


def build_v2(msg_id: int, sender: str, body: str, priority=None, sent_at=None, extra: bytes = b"") -> bytes:
    payload = field_u32(F_MSG_ID, msg_id) + field_str(F_SENDER, sender) + field_str(F_BODY, body)
    if priority is not None:
        payload += field_u32(F_PRIORITY, priority)
    if sent_at is not None:
        payload += field_u32(F_SENT_AT, sent_at)
    payload += extra
    return frame(V2, payload)
