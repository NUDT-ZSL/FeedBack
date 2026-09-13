"""离线消息总线命令行入口。

从标准输入逐行读取 JSON 命令，每条命令向标准输出写一行 JSON 结果；
错误也输出为一行 JSON 且包含 ``error`` 字段。空行忽略。

用法::

    python main.py [--overflow reject|drop_lowest]
                   [--unsubscribe drop|transfer]

通用命令格式：``{"cmd": "<命令名>", ...参数}``。支持的命令：

publish       必填 msg_id/topic/priority，可选 payload/produced_at；
              也可用 {"cmd":"publish","message":{...}} 整体传入。
subscribe     必填 sub_id；可选 topics(字符串数组或 null)、min_priority、
              max_inflight、max_queue、ack_timeout、online。
unsubscribe   必填 sub_id；可选 policy(drop|transfer) 覆盖总线默认策略。
deliver       必填 sub_id；可选 max_messages(默认 1)。
ack           必填 sub_id, msg_id。
ack_up_to     必填 sub_id, msg_id。
set_online    必填 sub_id, online。
state         无参数，返回 get_state()。
get           必填 msg_id；不存在时 message 为 null（不算错误）。
list          可选 topic；返回订阅者 id 列表。
save/load     必填 path。
dump          返回内部完整快照字典。
tick          可选 n(默认 1)，推进内部逻辑时钟。
config        可选 overflow / unsubscribe，切换总线策略。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, Iterable, List, Optional

from bus import (
    BusError,
    MessageBus,
    OverflowPolicy,
    UnsubscribePolicy,
)

REQUIRED = object()  # “必填参数”哨兵


def _err(message: str, **extra: Any) -> Dict[str, Any]:
    """构造错误结果字典。"""
    out: Dict[str, Any] = {"ok": False, "error": message}
    out.update(extra)
    return out


def _arg(cmd: Dict[str, Any], name: str, default: Any = REQUIRED) -> Any:
    """从命令字典取参数；缺失且无默认值时抛 BusError。"""
    if name in cmd and cmd[name] is not None:
        return cmd[name]
    if default is REQUIRED:
        raise BusError(f"missing required argument: {name}")
    return default


def _opt_int(cmd: Dict[str, Any], name: str, default: int) -> int:
    val = cmd.get(name, default)
    if not isinstance(val, int) or isinstance(val, bool):
        raise BusError(f"argument {name} must be an integer")
    return val


class BusSession:
    """持有一个总线实例，逐命令执行并返回可 JSON 化的结果字典。"""

    def __init__(self, overflow: str = OverflowPolicy.REJECT.value,
                 unsubscribe: str = UnsubscribePolicy.DROP.value) -> None:
        self.bus = MessageBus(overflow_policy=overflow,
                              unsubscribe_policy=unsubscribe)

    # -- 策略 ----------------------------------------------------------- #
    def configure(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        changed: Dict[str, str] = {}
        try:
            if cmd.get("overflow") is not None:
                policy = OverflowPolicy(cmd["overflow"])
                self.bus.overflow_policy = policy
                changed["overflow"] = policy.value
            if cmd.get("unsubscribe") is not None:
                policy = UnsubscribePolicy(cmd["unsubscribe"])
                self.bus.unsubscribe_policy = policy
                changed["unsubscribe"] = policy.value
        except ValueError as e:
            raise BusError(f"invalid policy: {e}") from None
        return {"ok": True, "changed": changed,
                "overflow": self.bus.overflow_policy.value,
                "unsubscribe": self.bus.unsubscribe_policy.value}

    # -- 命令分发 -------------------------------------------------------- #
    def execute(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        name = cmd.get("cmd")
        if not isinstance(name, str):
            raise BusError("each command must be a JSON object with a string 'cmd' field")
        handler = getattr(self, f"_cmd_{name}", None)
        if handler is None:
            raise BusError(f"unknown command: {name}")
        result = handler(cmd)
        if isinstance(result, dict):
            result.setdefault("ok", True)
            result.setdefault("cmd", name)
        return result

    def _cmd_publish(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        if "message" in cmd and cmd["message"] is not None:
            message = cmd["message"]
        else:
            message = {
                "msg_id": _arg(cmd, "msg_id"),
                "topic": _arg(cmd, "topic"),
                "priority": _arg(cmd, "priority"),
                "payload": cmd.get("payload"),
                "produced_at": cmd.get("produced_at", self.bus.now()),
            }
        return self.bus.publish(message)

    def _cmd_subscribe(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        topics = cmd.get("topics")
        if topics is not None and not isinstance(topics, list):
            raise BusError("argument topics must be a list of strings or null")
        if "online" in cmd and not isinstance(cmd["online"], bool):
            raise BusError("argument online must be true or false")
        return self.bus.subscribe(
            sub_id=_arg(cmd, "sub_id"),
            topics=topics,
            min_priority=_opt_int(cmd, "min_priority", 0),
            max_inflight=_opt_int(cmd, "max_inflight", 100),
            max_queue=_opt_int(cmd, "max_queue", 1000),
            ack_timeout=cmd.get("ack_timeout", None),
            online=cmd.get("online", True),
        )

    def _cmd_unsubscribe(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.bus.unsubscribe(
            sub_id=_arg(cmd, "sub_id"),
            policy=cmd.get("policy"),
        )

    def _cmd_deliver(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.bus.deliver(
            sub_id=_arg(cmd, "sub_id"),
            max_messages=_opt_int(cmd, "max_messages", 1),
        )

    def _cmd_ack(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.bus.ack(_arg(cmd, "sub_id"), _arg(cmd, "msg_id"))

    def _cmd_ack_up_to(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.bus.ack_up_to(_arg(cmd, "sub_id"), _arg(cmd, "msg_id"))

    def _cmd_set_online(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        online = cmd.get("online")
        if not isinstance(online, bool):
            raise BusError("argument online must be true or false")
        return self.bus.set_online(_arg(cmd, "sub_id"), online)

    def _cmd_state(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.bus.get_state()

    def _cmd_get(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        msg_id = _arg(cmd, "msg_id")
        message = self.bus.get_message(msg_id)
        return {"msg_id": msg_id, "exists": message is not None, "message": message}

    def _cmd_list(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        topic = cmd.get("topic")
        return {"topic": topic, "subscribers": self.bus.list_subscriptions(topic)}

    def _cmd_save(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        path = _arg(cmd, "path")
        self.bus.save(path)
        return {"path": path, "saved": True}

    def _cmd_load(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        path = _arg(cmd, "path")
        self.bus = MessageBus.load(path)
        return {"path": path, "loaded": True, "state": self.bus.get_state()}

    def _cmd_dump(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.bus.dump()

    def _cmd_tick(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        n = _opt_int(cmd, "n", 1)
        return {"clock": self.bus.tick(n)}

    def _cmd_config(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        return self.configure(cmd)


def process_lines(lines: Iterable[str],
                  overflow: str = OverflowPolicy.REJECT.value,
                  unsubscribe: str = UnsubscribePolicy.DROP.value) -> List[str]:
    """逐行执行命令，返回与输入（非空行）一一对应的 JSON 结果行。

    供库调用与测试使用；单行命令的错误不会中断后续命令。
    """
    session = BusSession(overflow=overflow, unsubscribe=unsubscribe)
    out: List[str] = []
    for lineno, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            if not isinstance(cmd, dict):
                raise BusError("command must be a JSON object")
            result = session.execute(cmd)
        except BusError as e:
            result = _err(str(e), line=lineno)
        except json.JSONDecodeError as e:
            result = _err(f"invalid JSON at line {lineno} col {e.colno}: {e.msg}",
                          line=lineno)
        out.append(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return out


def main(argv: Optional[List[str]] = None) -> int:
    """命令行入口：stdin 读命令，stdout 写每行一个 JSON 结果。"""
    # Windows 控制台默认可能是 GBK，统一为 UTF-8，避免中文结果行编码失败。
    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Offline message-bus kernel CLI")
    parser.add_argument("--overflow", choices=[p.value for p in OverflowPolicy],
                        default=OverflowPolicy.REJECT.value,
                        help="publish overflow policy when a queue is full "
                             "(default: reject)")
    parser.add_argument("--unsubscribe", choices=[p.value for p in UnsubscribePolicy],
                        default=UnsubscribePolicy.DROP.value,
                        help="message policy when a subscriber unsubscribes "
                             "(default: drop)")
    args = parser.parse_args(argv)

    for line in process_lines(sys.stdin, overflow=args.overflow,
                              unsubscribe=args.unsubscribe):
        sys.stdout.write(line + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
