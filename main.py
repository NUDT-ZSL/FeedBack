#!/usr/bin/env python3
"""JSON-lines command interface for the FeedDecoder.

Reads one JSON command per line from stdin and writes one JSON result per
line to stdout.  Errors are reported as ``{"ok": false, "error": "..."}``.

Commands:

* ``{"cmd": "feed", "chunk": "<hex>"}``
      Feed bytes; returns the frames decided by this chunk.
* ``{"cmd": "finish"}``
      End of input; returns remaining frames and the incomplete flag.
* ``{"cmd": "encode", "frame_type": 1, "payload": "<hex>"}``
      Encode one frame; returns ``{"ok": true, "chunk": "<hex>"}``.
* ``{"cmd": "encode", "frames": [{"frame_type": 1, "payload": "<hex>"}, ...]}``
      Encode a whole stream at once.
* ``{"cmd": "stats"}``     Decoder health statistics.
* ``{"cmd": "save", "path": "..."}``   Persist decoder state as JSON.
* ``{"cmd": "load", "path": "..."}``   Restore decoder state (replaces the
      current decoder).
* ``{"cmd": "dump"}``      Full internal state (same shape as a snapshot).
* ``{"cmd": "config", "max_payload": N, "max_buffer": M}``
      Reinitialise the decoder with new limits (state is reset).

Initial limits can also be set with ``--max-payload`` / ``--max-buffer``.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, Tuple

from feed_decoder import (
    DEFAULT_MAX_BUFFER,
    DEFAULT_MAX_PAYLOAD,
    FeedDecoder,
    SnapshotError,
    encode_frame,
    encode_stream,
)


def _hex_field(cmd: Dict[str, Any], key: str) -> bytes:
    """Extract a mandatory hex-string field from a command."""
    if key not in cmd:
        raise ValueError(f"missing field {key!r}")
    value = cmd[key]
    if not isinstance(value, str):
        raise ValueError(f"field {key!r} must be a hex string")
    try:
        return bytes.fromhex(value)
    except ValueError:
        raise ValueError(f"field {key!r} is not valid hex: {value!r}") from None


def handle_command(decoder: FeedDecoder,
                   cmd: Dict[str, Any]) -> Tuple[FeedDecoder, Dict[str, Any]]:
    """Execute one command; return the (possibly replaced) decoder and the
    JSON-serialisable response."""
    if not isinstance(cmd, dict):
        return decoder, {"ok": False, "error": "command must be a JSON object"}
    op = cmd.get("cmd")
    try:
        if op == "feed":
            frames = decoder.feed(_hex_field(cmd, "chunk"))
            return decoder, {"ok": True,
                             "frames": [f.to_dict() for f in frames]}
        if op == "finish":
            result = decoder.finish()
            response = {"ok": True}
            response.update(result.to_dict())
            return decoder, response
        if op == "encode":
            if "frames" in cmd:
                items = cmd["frames"]
                if not isinstance(items, list):
                    raise ValueError("'frames' must be a list")
                pairs = []
                for i, item in enumerate(items):
                    if not isinstance(item, dict):
                        raise ValueError(f"frames[{i}] must be an object")
                    if "frame_type" not in item:
                        raise ValueError(f"frames[{i}] missing 'frame_type'")
                    payload = item.get("payload", "")
                    if not isinstance(payload, str):
                        raise ValueError(f"frames[{i}].payload must be hex")
                    try:
                        payload_bytes = bytes.fromhex(payload)
                    except ValueError:
                        raise ValueError(
                            f"frames[{i}].payload is not valid hex") from None
                    pairs.append((item["frame_type"], payload_bytes))
                data = encode_stream(pairs)
                return decoder, {"ok": True, "chunk": data.hex(),
                                 "count": len(pairs)}
            if "frame_type" not in cmd:
                raise ValueError("missing field 'frame_type'")
            payload = _hex_field(cmd, "payload") if "payload" in cmd else b""
            return decoder, {"ok": True,
                             "chunk": encode_frame(cmd["frame_type"],
                                                   payload).hex()}
        if op == "stats":
            return decoder, {"ok": True, "stats": decoder.stats()}
        if op == "save":
            if "path" not in cmd:
                raise ValueError("missing field 'path'")
            decoder.save(cmd["path"])
            return decoder, {"ok": True, "path": cmd["path"]}
        if op == "load":
            if "path" not in cmd:
                raise ValueError("missing field 'path'")
            decoder = FeedDecoder.load(cmd["path"])
            return decoder, {"ok": True, "path": cmd["path"],
                             "stats": decoder.stats()}
        if op == "dump":
            return decoder, {"ok": True, "state": decoder.dump()}
        if op == "config":
            decoder = FeedDecoder(
                max_payload=cmd.get("max_payload", DEFAULT_MAX_PAYLOAD),
                max_buffer=cmd.get("max_buffer", DEFAULT_MAX_BUFFER))
            return decoder, {"ok": True, "stats": decoder.stats()}
        if op is None:
            return decoder, {"ok": False, "error": "missing field 'cmd'"}
        return decoder, {"ok": False, "error": f"unknown command {op!r}"}
    except (ValueError, TypeError, KeyError, SnapshotError, RuntimeError,
            OSError) as exc:
        return decoder, {"ok": False, "error": str(exc)}


def main(argv=None) -> int:
    """Entry point: run the JSON-lines command loop."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--max-payload", type=int, default=DEFAULT_MAX_PAYLOAD,
                        help="maximum payload bytes per frame")
    parser.add_argument("--max-buffer", type=int, default=DEFAULT_MAX_BUFFER,
                        help="maximum pending (undecidable) buffer bytes")
    args = parser.parse_args(argv)

    try:
        decoder = FeedDecoder(max_payload=args.max_payload,
                              max_buffer=args.max_buffer)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            response = {"ok": False, "error": f"invalid JSON: {exc}"}
        else:
            decoder, response = handle_command(decoder, cmd)
        print(json.dumps(response), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
