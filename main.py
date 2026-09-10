# -*- coding: utf-8 -*-
"""流式区间聚合引擎的命令行入口。

从标准输入逐行读取 JSON 命令，每条命令输出一行 JSON 结果。

启动时可通过命令行参数指定窗口配置（默认 window_size=1, slide=1），
也可以在流中用 ``config`` 命令重建空引擎；``load`` 会用快照中的配置
替换当前引擎：

    python main.py --window-size 10 --slide 5 --default-agg sum

支持的命令（每行一个 JSON 对象）：

* ``config``  —— {"cmd":"config","window_size":10,"slide":5,"default_agg":"sum"}
* ``ingest``  —— {"cmd":"ingest","event":{...Event...}}
* ``retract`` —— {"cmd":"retract","event":{...}}（op 强制为 retract）
* ``query``   —— {"cmd":"query","key":"k","start":0,"end":20,"agg":"sum"}
* ``query_all`` —— {"cmd":"query_all","start":0,"end":20,"agg":"sum"}
* ``watermark`` —— {"cmd":"watermark","t":15}
* ``state``   —— {"cmd":"state"}
* ``save``    —— {"cmd":"save","path":"snap.json"}
* ``load``    —— {"cmd":"load","path":"snap.json"}
* ``dump``    —— {"cmd":"dump"}（输出完整快照 JSON）

命令本身处理失败时输出 {"ok": false, "error": "...", "error_kind": ...}；
非法事件被引擎拒绝时输出 {"ok": true, "accepted": false, ...}。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

from aggregator import (
    AGGREGATORS,
    SnapshotError,
    WindowAggregator,
)


def _err(message: str, kind: str = "command_error", **extra: Any) -> Dict[str, Any]:
    resp: Dict[str, Any] = {"ok": False, "error": message, "error_kind": kind}
    resp.update(extra)
    return resp


def handle_command(
    engine: WindowAggregator, obj: Any
) -> Tuple[WindowAggregator, Dict[str, Any]]:
    """处理一条命令字典，返回 ``(可能被替换的引擎, 响应字典)``。"""
    if not isinstance(obj, dict):
        return engine, _err("命令必须是 JSON 对象", "bad_command")
    cmd = obj.get("cmd")
    if not isinstance(cmd, str):
        return engine, _err("缺少字符串字段 cmd", "bad_command")

    if cmd == "config":
        try:
            engine = WindowAggregator(
                window_size=obj["window_size"],
                slide=obj["slide"],
                default_agg=obj.get("default_agg", "sum"),
            )
        except KeyError as exc:
            return engine, _err(f"config 缺少字段 {exc.args[0]!r}", "bad_config")
        except (ValueError, TypeError) as exc:
            return engine, _err(f"config 非法: {exc}", "bad_config")
        return engine, {"ok": True, "cmd": "config", **engine.get_state()}

    if cmd == "ingest" or cmd == "retract":
        data = obj.get("event")
        if data is None:
            # 也允许把事件字段直接平铺在命令对象里。
            data = {k: v for k, v in obj.items() if k != "cmd"}
        if not isinstance(data, dict):
            return engine, _err("event 必须是 JSON 对象", "bad_event")
        if cmd == "retract":
            # retract 命令强制 op，不修改调用方的原字典。
            data = {**data, "op": "retract"}
        # 直接走字典路径：非法事件由引擎计入非法数并返回 accepted=False，
        # 而不是在 CLI 层抛错——与库 API 的行为保持一致。
        result = engine.ingest(data)
        resp = result.to_dict()
        resp["ok"] = True
        resp["cmd"] = cmd
        return engine, resp

    if cmd == "query":
        for name in ("key", "start", "end"):
            if name not in obj:
                return engine, _err(f"query 缺少字段 {name!r}", "bad_command")
        try:
            rows = engine.query(
                key=obj["key"],
                start=obj["start"],
                end=obj["end"],
                agg=obj.get("agg"),
            )
        except (ValueError, TypeError) as exc:
            return engine, _err(str(exc), "bad_query")
        return engine, {
            "ok": True,
            "cmd": "query",
            "results": [r.to_dict() for r in rows],
        }

    if cmd == "query_all":
        for name in ("start", "end"):
            if name not in obj:
                return engine, _err(f"query_all 缺少字段 {name!r}", "bad_command")
        try:
            rows = engine.query_all(
                start=obj["start"], end=obj["end"], agg=obj.get("agg")
            )
        except (ValueError, TypeError) as exc:
            return engine, _err(str(exc), "bad_query")
        return engine, {
            "ok": True,
            "cmd": "query_all",
            "results": [r.to_dict() for r in rows],
        }

    if cmd == "watermark":
        if "t" not in obj:
            return engine, _err("watermark 缺少字段 't'", "bad_command")
        try:
            wm = engine.advance_watermark(obj["t"])
        except (ValueError, TypeError) as exc:
            return engine, _err(str(exc), "bad_watermark")
        return engine, {"ok": True, "cmd": "watermark", "watermark": wm}

    if cmd == "state":
        return engine, {"ok": True, "cmd": "state", "state": engine.get_state()}

    if cmd == "save":
        path = obj.get("path")
        if not isinstance(path, str) or not path:
            return engine, _err("save 缺少非空字符串字段 'path'", "bad_command")
        try:
            engine.save(path)
        except OSError as exc:
            return engine, _err(f"写入快照失败: {exc}", "io_error")
        except (TypeError, ValueError) as exc:  # allow_nan 等序列化问题
            return engine, _err(f"快照序列化失败: {exc}", "snapshot_error")
        return engine, {"ok": True, "cmd": "save", "path": path}

    if cmd == "load":
        path = obj.get("path")
        if not isinstance(path, str) or not path:
            return engine, _err("load 缺少非空字符串字段 'path'", "bad_command")
        try:
            engine = WindowAggregator.load(path)
        except SnapshotError as exc:
            return engine, _err(str(exc), "snapshot_error")
        except OSError as exc:
            return engine, _err(f"读取快照失败: {exc}", "io_error")
        return engine, {"ok": True, "cmd": "load", "state": engine.get_state()}

    if cmd == "dump":
        return engine, {"ok": True, "cmd": "dump", "snapshot": engine.to_snapshot()}

    return engine, _err(
        f"未知命令 {cmd!r}，支持: config, ingest, retract, query, "
        "query_all, watermark, state, save, load, dump",
        "unknown_command",
    )


def run(argv: Optional[List[str]] = None) -> int:
    """主循环：读 stdin、逐行处理、写 stdout。返回进程退出码。"""
    parser = argparse.ArgumentParser(description="流式区间聚合引擎")
    parser.add_argument("--window-size", type=int, default=1)
    parser.add_argument("--slide", type=int, default=1)
    parser.add_argument("--default-agg", choices=AGGREGATORS, default="sum")
    args = parser.parse_args(argv)

    try:
        engine = WindowAggregator(
            window_size=args.window_size,
            slide=args.slide,
            default_agg=args.default_agg,
        )
    except ValueError as exc:
        sys.stderr.write(f"启动参数非法: {exc}\n")
        return 2

    for line_no, line in enumerate(sys.stdin, start=1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            response = _err(
                f"第 {line_no} 行不是合法 JSON: {exc}", "bad_json", line_no=line_no
            )
        else:
            try:
                engine, response = handle_command(engine, obj)
            except Exception as exc:  # 兜底：单行异常不能杀死整个流
                response = _err(
                    f"命令处理时发生未预期错误: {type(exc).__name__}: {exc}",
                    "internal_error",
                )
        sys.stdout.write(json.dumps(response, ensure_ascii=False, allow_nan=False))
        sys.stdout.write("\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
