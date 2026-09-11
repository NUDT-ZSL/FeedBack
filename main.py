"""命令行入口：从标准输入逐行读取 JSON 命令，逐行输出 JSON 结果。

每行一个命令对象，必须包含 "cmd" 字段。支持的命令：

  compile        {"cmd":"compile","pattern_id":"p1","pattern_text":"INFO {msg:*}"}
  match          {"cmd":"match","text":"..."}
  match_all      {"cmd":"match_all","text":"..."}
  extract        {"cmd":"extract","pattern_id":"p1","text":"..."}
  explain        {"cmd":"explain","pattern_id":"p1","text":"..."}
  stream_feed    {"cmd":"stream_feed","chunk":"...","pattern_id":"p1","max_buffer":1024}
                 （首个 stream_feed 创建流，pattern_id/max_buffer 仅此时生效）
  stream_finish  {"cmd":"stream_finish"}
  stats          {"cmd":"stats"}
  save           {"cmd":"save","path":"snapshot.json"}
  load           {"cmd":"load","path":"snapshot.json"}
  dump           {"cmd":"dump"}

每条命令输出一行 JSON；成功时含 "ok": true，失败时含 "ok": false、
"error" 与 "error_type"（pattern_id 冲突时另含 "conflict_id"）。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional

from pattern_kernel import (
    PatternConflictError,
    PatternSet,
    StreamExtractor,
    StreamStateError,
)


def _require(req: Dict[str, Any], key: str) -> Any:
    """取必填参数，缺失时抛出带清晰信息的错误。"""
    if key not in req:
        raise ValueError(f"missing required field {key!r}")
    return req[key]


def main() -> None:
    """REPL 主循环：逐行读命令，逐行写结果。"""
    # 容忍 UTF-8 BOM（某些 shell 管道会注入），输出统一 UTF-8
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8-sig", errors="replace")
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ps = PatternSet()
    stream: Optional[StreamExtractor] = None

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            if not isinstance(req, dict):
                raise ValueError("command must be a JSON object")
            cmd = req.get("cmd")

            if cmd == "compile":
                report = ps.compile(
                    _require(req, "pattern_id"), _require(req, "pattern_text")
                )
                out = {"ok": True, "report": report}
            elif cmd == "match":
                out = {"ok": True, "match": ps.match(_require(req, "text"))}
            elif cmd == "match_all":
                out = {"ok": True, "matches": ps.match_all(_require(req, "text"))}
            elif cmd == "extract":
                fields = ps.extract(
                    _require(req, "text"), _require(req, "pattern_id")
                )
                out = {"ok": True, "matched": fields is not None, "fields": fields}
            elif cmd == "explain":
                out = {
                    "ok": True,
                    "explanation": ps.explain(
                        _require(req, "text"), _require(req, "pattern_id")
                    ),
                }
            elif cmd == "stream_feed":
                if stream is None or stream.done:
                    stream = StreamExtractor(
                        ps,
                        _require(req, "pattern_id"),
                        max_buffer=req.get("max_buffer"),
                    )
                out = {"ok": True, "stream": stream.feed(_require(req, "chunk"))}
            elif cmd == "stream_finish":
                if stream is None:
                    raise StreamStateError("no active stream; send stream_feed first")
                out = {"ok": True, "stream": stream.finish()}
            elif cmd == "stats":
                out = {"ok": True, "stats": ps.stats()}
            elif cmd == "save":
                path = _require(req, "path")
                ps.save(path)
                out = {"ok": True, "saved": path}
            elif cmd == "load":
                path = _require(req, "path")
                ps.load(path)
                out = {"ok": True, "loaded": path}
            elif cmd == "dump":
                out = {"ok": True, "dump": ps.dump()}
            else:
                raise ValueError(f"unknown command {cmd!r}")
        except PatternConflictError as exc:
            out = {
                "ok": False,
                "error": str(exc),
                "error_type": type(exc).__name__,
                "conflict_id": exc.conflict_id,
            }
        except Exception as exc:  # noqa: BLE001 - REPL 边界，统一转 JSON 错误
            out = {"ok": False, "error": str(exc), "error_type": type(exc).__name__}

        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
