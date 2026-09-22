"""Offline command line entry point: ``python -m binary_codec``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .demo import sample_stream
from .models import StreamEvent
from .stream import decode_chunks


def _event_json(event: StreamEvent) -> dict[str, object]:
    return event.to_dict()


def _print_text(events: list[StreamEvent]) -> None:
    for index, event in enumerate(events, start=1):
        print(f"[{index}] {event.kind.upper()} bytes {event.stream_start}..{event.stream_end}")
        if event.decoded is not None:
            decoded = event.decoded
            message = decoded.message
            print(
                f"    v{decoded.source_version} via {decoded.parser_path}: "
                f"id={message.message_id} sender={message.sender!r} "
                f"event={message.event} timestamp={message.timestamp_ms}"
            )
            print(
                "    extras="
                + json.dumps(
                    {
                        "priority": message.priority,
                        "labels": list(message.labels),
                        "trace_id": message.trace_id,
                        "retry_count": message.retry_count,
                    },
                    ensure_ascii=False,
                )
            )
            for note in decoded.compatibility_notes:
                print(f"    note: {note}")
            if decoded.extensions_ignored:
                print(f"    ignored_tags={list(decoded.extensions_ignored)}")
        if event.diagnostic is not None:
            diagnostic = event.diagnostic
            print(
                f"    {diagnostic.severity} {diagnostic.code}: "
                f"{diagnostic.message}"
            )
            print(
                "    location="
                + json.dumps(
                    {
                        "frame_start": diagnostic.frame_start,
                        "field_start": diagnostic.field_start,
                        "field_end": diagnostic.field_end,
                    },
                    ensure_ascii=False,
                )
            )


def _chunks(data: bytes, chunk_size: int) -> list[bytes]:
    if chunk_size <= 0:
        raise ValueError("chunk size must be positive")
    return [data[index : index + chunk_size] for index in range(0, len(data), chunk_size)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Decode a versioned TLV binary stream with arbitrary chunking."
    )
    parser.add_argument("input", nargs="?", help="raw input file; defaults to built-in demo")
    parser.add_argument(
        "--stdin", action="store_true", help="read the raw binary stream from stdin"
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=7,
        metavar="N",
        help="feed N bytes at a time to prove stream reassembly (default: 7)",
    )
    parser.add_argument(
        "--json", action="store_true", help="emit machine-readable JSON events"
    )
    parser.add_argument(
        "--legacy-parser",
        action="store_true",
        help="parse all frames using an old parser generation (it ignores tags 5+)",
    )
    args = parser.parse_args(argv)

    if args.stdin:
        data = sys.stdin.buffer.read()
    elif args.input:
        data = Path(args.input).read_bytes()
    else:
        data = sample_stream()

    parser_path = "legacy" if args.legacy_parser else "modern"
    events = decode_chunks(_chunks(data, args.chunk_size), parser_path)
    if args.json:
        print(json.dumps([_event_json(event) for event in events], ensure_ascii=False, indent=2))
    else:
        _print_text(events)
        messages = sum(1 for event in events if event.kind == "message")
        diagnostics = sum(1 for event in events if event.kind == "diagnostic")
        print(f"\nSummary: {messages} usable message(s), {diagnostics} diagnostic(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
