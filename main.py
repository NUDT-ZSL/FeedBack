"""命令行入口：从标准输入逐行读取 JSON 命令，每行输出一条 JSON 结果。

用法::

    python main.py < commands.txt          # 从文件
    echo '{"cmd":"state"}' | python main.py  # 管道交互

每条命令是一行 JSON 对象，通用字段是 ``cmd``（也接受 ``command``）。
成功时输出结果对象；失败时输出 ``{"error": "...", "cmd": ...}``，
退出码始终为 0（单行命令错误不中断后续命令；仅在无法读取输入时非零）。
空行会被跳过。

支持的命令
----------

insert        {"cmd":"insert","point":{point_id,series,ts,value}}
insert_many   {"cmd":"insert_many","points":[point, ...]}
query         {"cmd":"query","series":s,"start":a,"end":b}   -> [a,b)
delete        {"cmd":"delete","series":s,"start":a,"end":b}  -> 删除数
snapshot      {"cmd":"snapshot","name":n}
rollback      {"cmd":"rollback","name":n}
state         {"cmd":"state"}
get           {"cmd":"get","point_id":id}
list          {"cmd":"list"}
save          {"cmd":"save","path":p}
load          {"cmd":"load","path":p}                        # 替换当前内存索引
dump          {"cmd":"dump"}                                 # 输出完整 JSON 数据
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Tuple

from timeseries_index import (
    InvalidPointError,
    Point,
    TimeSeriesIndex,
    TimeseriesError,
)

_COMMANDS = frozenset(
    {
        "insert",
        "insert_many",
        "query",
        "delete",
        "snapshot",
        "rollback",
        "state",
        "get",
        "list",
        "save",
        "load",
        "dump",
    }
)


def _point_dict(p: Point) -> Dict[str, Any]:
    return p.to_dict()


def _require(command: Dict[str, Any], key: str) -> Any:
    if key not in command:
        raise TimeseriesError(f"命令缺少参数: {key}")
    return command[key]


def dispatch(
    index: TimeSeriesIndex, command: Dict[str, Any]
) -> Tuple[TimeSeriesIndex, Dict[str, Any]]:
    """执行一条已解析的命令，返回（可能被 load 替换的）索引与结果字典。

    命令语义错误以 :class:`TimeseriesError` 子类抛出，由调用方转成
    ``{"error": ...}``；本函数不做 JSON 解析。
    """
    cmd = command.get("cmd", command.get("command"))
    if cmd == "insert":
        index.insert(_require(command, "point"))
        return index, {"ok": True}

    if cmd == "insert_many":
        points = _require(command, "points")
        if not isinstance(points, list):
            raise InvalidPointError("points 必须是数组")
        count = len(points)
        index.insert_many(points)
        return index, {"ok": True, "inserted": count}

    if cmd == "query":
        series = _require(command, "series")
        start = _require(command, "start")
        end = _require(command, "end")
        found = index.range_query(series, start, end)
        return index, {"points": [_point_dict(p) for p in found]}

    if cmd == "delete":
        series = _require(command, "series")
        start = _require(command, "start")
        end = _require(command, "end")
        return index, {"deleted": index.range_delete(series, start, end)}

    if cmd == "snapshot":
        name = _require(command, "name")
        index.snapshot(name)
        return index, {"ok": True, "name": name}

    if cmd == "rollback":
        name = _require(command, "name")
        index.rollback(name)
        return index, {"ok": True, "name": name}

    if cmd == "state":
        return index, index.get_state()

    if cmd == "get":
        point_id = _require(command, "point_id")
        p = index.get_point(point_id)
        return index, {"point": _point_dict(p) if p is not None else None}

    if cmd == "list":
        return index, {"series": index.list_series()}

    if cmd == "save":
        path = _require(command, "path")
        index.save(path)
        return index, {"ok": True, "path": path}

    if cmd == "load":
        path = _require(command, "path")
        index = TimeSeriesIndex.load(path)
        return index, {"ok": True, "path": path, "state": index.get_state()}

    if cmd == "dump":
        return index, index.to_dict()

    raise TimeseriesError(f"未知命令: {cmd!r}（支持: {', '.join(sorted(_COMMANDS))}）")


def process_line(index: TimeSeriesIndex, line: str) -> Tuple[TimeSeriesIndex, str]:
    """解析并执行一行输入，返回（索引, 输出 JSON 字符串）。

    任何错误（JSON 语法、命令语义）都被转成带 ``error`` 字段的 JSON。
    """
    try:
        command = json.loads(line)
    except json.JSONDecodeError as exc:
        return index, json.dumps(
            {"error": f"不是合法 JSON: {exc}"}, ensure_ascii=False
        )

    if not isinstance(command, dict):
        return index, json.dumps(
            {"error": "命令必须是 JSON 对象"}, ensure_ascii=False
        )

    cmd = command.get("cmd", command.get("command"))
    if not isinstance(cmd, str) or not cmd:
        return index, json.dumps(
            {"error": "缺少字符串类型的 cmd 字段", "cmd": cmd},
            ensure_ascii=False,
        )
    if cmd not in _COMMANDS:
        return index, json.dumps(
            {
                "error": f"未知命令: {cmd!r}（支持: {', '.join(sorted(_COMMANDS))}）",
                "cmd": cmd,
            },
            ensure_ascii=False,
        )

    try:
        index, result = dispatch(index, command)
    except (TimeseriesError, OSError) as exc:
        return index, json.dumps(
            {"error": str(exc), "cmd": cmd}, ensure_ascii=False
        )
    return index, json.dumps(result, ensure_ascii=False, allow_nan=False)


def main(argv: List[str] | None = None) -> int:
    """标准输入驱动的主循环，返回进程退出码。"""
    # 容忍部分编辑器 / Windows 管道在文件头加的 UTF-8 BOM
    try:
        sys.stdin.reconfigure(encoding="utf-8-sig")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass
    index = TimeSeriesIndex()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        index, output = process_line(index, line)
        sys.stdout.write(output + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
