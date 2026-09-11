"""stream_aligner 的命令行入口。

从标准输入逐行读取 JSON 命令，每行输出一条 JSON 结果（成功带
``"ok": true``，失败带 ``"ok": false`` 与 ``error`` 字段），适合离线
管道式驱动，不访问网络。

协议示例（每行一条命令）::

    {"cmd": "new", "name_a": "mic", "name_b": "ref", "metric": "abs", "band": 3}
    {"cmd": "append", "series": "mic", "value": 0.5}
    {"cmd": "append", "series": "ref", "value": 0.4}
    {"cmd": "align"}
    {"cmd": "state"}
    {"cmd": "save", "path": "state.json"}
    {"cmd": "load", "path": "state.json"}
    {"cmd": "dump"}

字段说明：

* ``new``：在当前进程内创建一个会话。参数 ``name_a``、``name_b`` 必填，
  可选 ``metric``（默认 ``abs``）、``band``（默认 4096）、``max_cells``
  （默认 ``null``，即精确无上限模式）。重复 ``new`` 会重置会话。
* ``append``：``series`` 为 ``new`` 时声明的序列名之一，``value`` 为数值。
* ``align`` / ``state``：无额外参数。
* ``save`` / ``load``：``path`` 为 JSON 快照文件路径；``load`` 会用文件
  内容替换当前会话。
* ``dump``：返回当前会话的完整快照字典。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional

from stream_aligner import (
    AlignmentError,
    StreamAligner,
)

_CMD = "cmd"


def _ok(cmd: str, extra: Optional[Dict[str, Any]] = None) -> str:
    """构造成功响应的一行 JSON。"""
    payload: Dict[str, Any] = {"ok": True, "cmd": cmd}
    if extra:
        payload.update(extra)
    return json.dumps(payload, ensure_ascii=False, allow_nan=False)


def _err(cmd: Optional[str], exc: BaseException) -> str:
    """构造错误响应的一行 JSON（始终包含 error 字段）。"""
    return json.dumps(
        {
            "ok": False,
            "cmd": cmd,
            "error": str(exc) or exc.__class__.__name__,
            "error_type": exc.__class__.__name__,
        },
        ensure_ascii=False,
        allow_nan=False,
    )


def _require_object(obj: Any, cmd: str) -> Dict[str, Any]:
    """校验一条命令是 JSON 对象。"""
    if not isinstance(obj, dict):
        raise AlignmentError(f"command must be a JSON object, got {type(obj).__name__}")
    if not isinstance(obj.get(_CMD), str):
        raise AlignmentError("command object must contain a string field 'cmd'")
    return obj


def _require(cmd_obj: Dict[str, Any], key: str, expected: type) -> Any:
    """读取必填参数并做类型检查（int 拒绝 bool）。"""
    if key not in cmd_obj:
        raise AlignmentError(f"command {cmd_obj[_CMD]!r} requires field {key!r}")
    value = cmd_obj[key]
    if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
        raise AlignmentError(
            f"field {key!r} must be {expected.__name__}, got {type(value).__name__}"
        )
    return value


def _optional_int(cmd_obj: Dict[str, Any], key: str, default: Optional[int]) -> Optional[int]:
    """读取可选整数参数（允许显式 null）。"""
    if key not in cmd_obj or cmd_obj[key] is None:
        return default
    value = cmd_obj[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise AlignmentError(f"field {key!r} must be an int or null")
    return value


class Session:
    """持有当前进程内唯一的 :class:`StreamAligner`。"""

    def __init__(self) -> None:
        self._aligner: Optional[StreamAligner] = None

    @property
    def aligner(self) -> StreamAligner:
        """返回当前 aligner，未初始化时报错。"""
        if self._aligner is None:
            raise AlignmentError(
                "no active session; send a 'new' or 'load' command first"
            )
        return self._aligner

    def handle(self, cmd_obj: Dict[str, Any]) -> str:
        """分派并执行一条已解析的命令，返回一行 JSON 响应。"""
        cmd = cmd_obj[_CMD]
        if cmd == "new":
            return self._new(cmd_obj)
        if cmd == "append":
            return self._append(cmd_obj)
        if cmd == "align":
            return _ok(cmd, {"result": self.aligner.align().to_dict()})
        if cmd == "state":
            return _ok(cmd, {"state": self.aligner.get_state().to_dict()})
        if cmd == "save":
            path = _require(cmd_obj, "path", str)
            self.aligner.save(path)
            return _ok(cmd, {"path": path})
        if cmd == "load":
            path = _require(cmd_obj, "path", str)
            self._aligner = StreamAligner.load(path)
            return _ok(cmd, {"path": path, "state": self._aligner.get_state().to_dict()})
        if cmd == "dump":
            return _ok(cmd, {"snapshot": self.aligner.to_snapshot()})
        raise AlignmentError(
            f"unknown command {cmd!r}; expected one of: "
            "new, append, align, state, save, load, dump"
        )

    def _new(self, cmd_obj: Dict[str, Any]) -> str:
        """处理 new 命令。"""
        name_a = _require(cmd_obj, "name_a", str)
        name_b = _require(cmd_obj, "name_b", str)
        metric = cmd_obj.get("metric", "abs")
        if not isinstance(metric, str):
            raise AlignmentError("field 'metric' must be a string")
        band = _optional_int(cmd_obj, "band", 4096)
        max_cells = _optional_int(cmd_obj, "max_cells", None)
        self._aligner = StreamAligner(
            name_a=name_a,
            name_b=name_b,
            metric=metric,
            band=4096 if band is None else band,
            max_cells=max_cells,
        )
        return _ok("new", {"state": self._aligner.get_state().to_dict()})

    def _append(self, cmd_obj: Dict[str, Any]) -> str:
        """处理 append 命令。"""
        series = _require(cmd_obj, "series", str)
        value = cmd_obj.get("value")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise AlignmentError("field 'value' must be a finite number")
        result = self.aligner.append(series, float(value))
        return _ok(
            "append",
            {
                "name": result.name,
                "new_length": result.new_length,
                "recomputed": result.recomputed,
                "distance": result.distance,
            },
        )


def process_line(session: Session, line: str) -> Optional[str]:
    """解析并处理一行原始输入；空行返回 ``None``（不产生输出）。

    :param session: 当前会话。
    :param line: 不含换行符的一行文本。
    :return: 一行 JSON 字符串，或 ``None`` 表示跳过空行。
    """
    stripped = line.strip()
    if not stripped:
        return None
    obj: Any = None
    try:
        obj = json.loads(stripped)
        cmd_obj = _require_object(obj, "<stdin>")
        cmd = cmd_obj[_CMD]
        return session.handle(cmd_obj)
    except Exception as exc:  # 所有错误都以 JSON 返回，绝不中断流
        cmd_name = obj.get(_CMD) if isinstance(obj, dict) else None
        return _err(cmd_name, exc)


def main(argv: Optional[list] = None) -> int:
    """主循环：逐行读 stdin、逐行写 stdout。

    :return: 进程退出码（始终为 0；单条命令失败只体现在 JSON 响应里）。
    """
    session = Session()
    for line in sys.stdin:
        response = process_line(session, line)
        if response is not None:
            sys.stdout.write(response + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
