"""Offline demo: build a mixed v1/v2 byte stream, feed it in random chunks,
and print every decoded message, compatibility note and diagnostic.

Usage:
    python -m msgstream            # run the demo
    python -m msgstream --seed 7   # reproducible chunking
"""
from __future__ import annotations

import argparse
import random
import struct

from .decoder import DecodedMessage, Diagnostic, StreamDecoder
from . import protocol as p


def build_demo_stream() -> bytes:
    parts = []
    parts.append(p.build_v1(1, "alice", "hello from legacy"))
    parts.append(p.build_v2(2, "bob", "full v2", priority=5, sent_at=1727000000))
    parts.append(p.build_v2(3, "carol", "v2 without optionals"))  # defaults filled
    # v2 frame carrying an unknown extension field (id 0x80)
    parts.append(p.build_v2(4, "dave", "v2 with extension",
                            priority=1, extra=p.field_bytes(0x80, b"\xde\xad")))
    # v1 frame whose payload actually carries v2-only fields (structure mismatch)
    parts.append(p.build_v1(5, "erin", "v1 header, v2 extras",
                            extra=p.field_u32(p.F_PRIORITY, 9)))
    # unknown structure version
    parts.append(p.frame(0x09, p.field_u32(p.F_MSG_ID, 6)))
    # duplicate field -> message unusable
    dup = (p.field_u32(p.F_MSG_ID, 7) + p.field_u32(p.F_MSG_ID, 7)
           + p.field_str(p.F_SENDER, "fred") + p.field_str(p.F_BODY, "dup"))
    parts.append(p.frame(p.V2, dup))
    # truncated field: declares 100 bytes, carries 2
    bad = p.field_u32(p.F_MSG_ID, 8) + struct.pack(">BBH", p.F_SENDER, p.T_STR, 100) + b"hi"
    parts.append(p.frame(p.V1, bad))
    # garbage between frames
    parts.append(b"\x00\x11\x22garbage")
    # illegal declared length, then a valid frame to prove resync
    parts.append(p.MAGIC + struct.pack(">BI", p.V1, p.MAX_PAYLOAD + 1) + b"junk")
    parts.append(p.build_v2(9, "gina", "back in sync", priority=2))
    return b"".join(parts)


def run_demo(seed: int) -> None:
    stream = build_demo_stream()
    print(f"demo stream: {len(stream)} bytes, fed in random chunks (seed={seed})")
    print("-" * 72)
    decoder = StreamDecoder()
    rng = random.Random(seed)
    pos = 0
    events = []
    while pos < len(stream):
        n = rng.randint(1, 17)
        chunk = stream[pos:pos + n]
        pos += n
        events.extend(decoder.feed(chunk))
    events.extend(decoder.finish())
    ok = bad = 0
    for ev in events:
        if isinstance(ev, DecodedMessage):
            ok += 1
            m = ev.message
            print(f"MESSAGE  @byte {ev.offset:<4} v{ev.version} -> {m!r}")
            for note in ev.notes:
                print(f"         compat: {note}")
        elif isinstance(ev, Diagnostic):
            bad += 1
            print(f"DIAG     {ev}")
    print("-" * 72)
    print(f"summary: {ok} message(s) decoded, {bad} diagnostic(s) raised, "
          f"{decoder.buffered} byte(s) left buffered")


def main() -> None:
    ap = argparse.ArgumentParser(prog="msgstream")
    ap.add_argument("--seed", type=int, default=42, help="chunking random seed")
    args = ap.parse_args()
    run_demo(args.seed)


if __name__ == "__main__":
    main()
