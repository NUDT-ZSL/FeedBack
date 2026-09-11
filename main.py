"""main.py — 流式 Top-K 内核的命令行入口。

从标准输入逐行读取 JSON 命令，每条命令向标准输出写一行 JSON 结果。
成功返回 ``{"ok": true, "cmd": ..., "result": ...}``；
失败返回 ``{"ok": false, "cmd": ..., "error": ..., "error_type": ...}``。
空行忽略；单行 JSON 解析失败不会中断进程。

支持的命令
==========

init                         初始化（或重置）内核
    {"cmd": "init", "k": 100, "window_size": 10, "exact": false,
     "max_memory_bytes": null, "start_ts": 0}
add                          插入一条记录（record 可嵌套也可平铺）
    {"cmd": "add", "record": {"key": "a", "weight": 1, "ts": 0}}
top                          查询 Top-K
    {"cmd": "top", "k": 10}            # k 可省略，用构造时的 K
estimate                     查询单个 key 的估算
    {"cmd": "estimate", "key": "a"}
heavy                        窗口重频
    {"cmd": "heavy", "threshold": 5}
burst                        突增检测
    {"cmd": "burst", "ratio": 1.0}
merge                        合并另一个 tracker
    {"cmd": "merge", "path": "other.json"}         # 从快照文件
    {"cmd": "merge", "snapshot": {...}}            # 或直接给快照对象
stats                        输出配置与运行统计
    {"cmd": "stats"}
save                         保存快照到文件（原子写）
    {"cmd": "save", "path": "state.json"}
load                         从快照文件载入（替换当前内核）
    {"cmd": "load", "path": "state.json"}
dump                         把完整快照作为结果输出（单行 JSON）
    {"cmd": "dump"}

未执行 init 时，第一条业务命令会按默认配置（k=100, window_size=10）
惰性创建内核。用法示例见 README。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional, Tuple

from topk_kernel import (
    Record,
    TopKError,
    TopKTracker,
)

DEFAULT_K = 100
DEFAULT_WINDOW = 10


def _ok(cmd: Optional[str], result: Any) -> str:
    return json.dumps(
        {"ok": True, "cmd": cmd, "result": result},
        ensure_ascii=False,
        allow_nan=False,
    )


def _err(cmd: Optional[str], exc: BaseException) -> str:
    return json.dumps(
        {
            "ok": False,
            "cmd": cmd,
            "error": str(exc),
            "error_type": type(exc).__name__,
        },
        ensure_ascii=False,
        allow_nan=False,
    )


def _entry_to_dict(e: Any) -> Dict[str, Any]:
    return e.to_dict()


def process_command(
    tracker: Optional[TopKTracker], obj: Any
) -> Tuple[Optional[TopKTracker], Dict[str, Any]]:
    """处理一条已解析的命令，返回 ``(可能新建的 tracker, 响应字典)``。

    响应字典含 ok/cmd/result 或 ok/cmd/error/error_type。
    内核错误以 ok=false 返回而不是抛出，便于逐行服务；编程性错误
    （如命令不是对象）同样以错误响应表达。
    """

    if not isinstance(obj, dict):
        return tracker, {
            "ok": False,
            "cmd": None,
            "error": "命令必须是 JSON 对象",
            "error_type": "InvalidCommand",
        }
    cmd = obj.get("cmd")
    if not isinstance(cmd, str) or not cmd:
        return tracker, {
            "ok": False,
            "cmd": cmd,
            "error": "缺少字符串字段 'cmd'",
            "error_type": "InvalidCommand",
        }

    def fail(exc: BaseException) -> Dict[str, Any]:
        return {
            "ok": False,
            "cmd": cmd,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }

    try:
        if cmd == "init":
            tracker = TopKTracker(
                k=obj.get("k", DEFAULT_K),
                window_size=obj.get("window_size", DEFAULT_WINDOW),
                exact=obj.get("exact", False),
                max_memory_bytes=obj.get("max_memory_bytes", None),
                start_ts=obj.get("start_ts", 0),
            )
            return tracker, {"ok": True, "cmd": cmd, "result": tracker.stats()}

        # 其余命令需要一个内核；惰性创建默认内核
        if tracker is None:
            tracker = TopKTracker(k=DEFAULT_K, window_size=DEFAULT_WINDOW)

        if cmd == "add":
            rec_obj = obj.get("record", obj)
            if not isinstance(rec_obj, dict):
                raise TopKError("record 必须是对象")
            record = Record(
                key=rec_obj["key"],
                weight=rec_obj.get("weight", 1),
                ts=rec_obj.get("ts", 0),
            )
            result = tracker.add(record).to_dict()
            return tracker, {"ok": True, "cmd": cmd, "result": result}

        if cmd == "top":
            k_arg = obj.get("k", None)
            entries = tracker.top(k_arg)
            result = [_entry_to_dict(e) for e in entries]
            return tracker, {"ok": True, "cmd": cmd, "result": result}

        if cmd == "estimate":
            if "key" not in obj:
                raise TopKError("estimate 缺少字段 'key'")
            count, error = tracker.estimate(obj["key"])
            result = {
                "key": obj["key"],
                "estimated_count": count,
                "error_bound": error,
            }
            return tracker, {"ok": True, "cmd": cmd, "result": result}

        if cmd == "heavy":
            if "threshold" not in obj:
                raise TopKError("heavy 缺少字段 'threshold'")
            items = tracker.heavy_hitters(obj["threshold"])
            result = [
                {"key": key, "count": cnt} for key, cnt in items
            ]
            return tracker, {"ok": True, "cmd": cmd, "result": result}

        if cmd == "burst":
            if "ratio" not in obj:
                raise TopKError("burst 缺少字段 'ratio'")
            ratio = obj["ratio"]
            items = tracker.burst_detect(ratio)
            result = [
                {
                    "key": key,
                    "growth": growth,
                    "current_count": cur_c,
                    "previous_count": prev_c,
                }
                for key, growth, cur_c, prev_c in items
            ]
            return tracker, {"ok": True, "cmd": cmd, "result": result}

        if cmd == "merge":
            if "path" in obj:
                other = TopKTracker.load(obj["path"])
            elif "snapshot" in obj:
                other = TopKTracker.from_dict(obj["snapshot"])
            else:
                raise TopKError("merge 需要 'path' 或 'snapshot' 字段")
            tracker.merge(other)
            return tracker, {"ok": True, "cmd": cmd, "result": tracker.stats()}

        if cmd == "stats":
            return tracker, {"ok": True, "cmd": cmd, "result": tracker.stats()}

        if cmd == "save":
            if "path" not in obj:
                raise TopKError("save 缺少字段 'path'")
            tracker.save(obj["path"])
            result = {"path": obj["path"], "slot_count": tracker.slot_count}
            return tracker, {"ok": True, "cmd": cmd, "result": result}

        if cmd == "load":
            if "path" not in obj:
                raise TopKError("load 缺少字段 'path'")
            tracker = TopKTracker.load(obj["path"])
            return tracker, {"ok": True, "cmd": cmd, "result": tracker.stats()}

        if cmd == "dump":
            return tracker, {"ok": True, "cmd": cmd, "result": tracker.to_dict()}

        return tracker, {
            "ok": False,
            "cmd": cmd,
            "error": f"未知命令 {cmd!r}",
            "error_type": "UnknownCommand",
        }
    except TopKError as exc:
        return tracker, fail(exc)
    except KeyError as exc:
        return tracker, {
            "ok": False,
            "cmd": cmd,
            "error": f"缺少字段 {str(exc)}",
            "error_type": "MissingField",
        }
    except (TypeError, ValueError) as exc:
        # json.dump(allow_nan=False) 抛 ValueError 等，统一成错误响应
        return tracker, fail(exc)


def main(argv: Optional[list] = None) -> int:
    """逐行读写主循环。返回进程退出码（始终 0，错误以 JSON 表达）。"""

    tracker: Optional[TopKTracker] = None
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            out.write(
                json.dumps(
                    {
                        "ok": False,
                        "cmd": None,
                        "error": f"输入不是合法 JSON：{exc}",
                        "error_type": "InvalidJSON",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            out.flush()
            continue

        tracker, response = process_command(tracker, obj)
        try:
            out.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
        except ValueError:
            # inf 只会出现在 burst 结果里；回退用字符串表示，保证行仍是合法 JSON
            response = _stringify_inf(response)
            out.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
        out.flush()
    return 0


def _stringify_inf(value: Any) -> Any:
    """把响应里的 float('inf') 转成字符串 'Infinity'，保证 JSON 合法。"""

    if isinstance(value, float) and value == float("inf"):
        return "Infinity"
    if isinstance(value, dict):
        return {k: _stringify_inf(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_stringify_inf(v) for v in value]
    return value


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
