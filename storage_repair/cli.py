"""逐条操作请求命令行接口。

输入为 JSON Lines（每行一个请求对象），每行输出一个响应对象：

请求::

    {"op": "<操作名>", ...参数...}

成功响应::

    {"ok": true, "op": "<操作名>", "result": ...}

失败响应（进程不中断，继续处理后续请求）::

    {"ok": false, "op": "<操作名>", "error": {
        "type": "InvalidPositionError", "message": "[stripe=s][position=3] ..."}}

内容（块/候选）统一用标准 base64 字符串传递，字段名为 ``content_b64``。

支持的操作：

========================= ================================================
``ping``                  连通性检查。
``create_stripe``         参数 ``stripe_id, k, m, data_b64?``。
``list_stripes``          无参，返回条带标识列表。
``write_block``           ``stripe_id, position, content_b64``。
``mark_missing``          ``stripe_id, position``。
``mark_corrupt``          ``stripe_id, position``。
``add_candidate``         ``stripe_id, position, source, content_b64``。
``repair``                ``stripe_id, positions?``；返回修复记录。
``verify``                ``stripe_id``；返回只读验证报告。
``query_position``        ``stripe_id, position``。
``repair_history``        ``stripe_id``。
``internal_state``        无参。
``export``                ``path``：导出 JSON 快照。
``import``                ``path``：导入 JSON 快照（失败不改变状态）。
``help``                  返回操作清单。
========================= ================================================

用法::

    python -m storage_repair.cli < requests.jsonl > responses.jsonl
    python -m storage_repair.cli --file requests.jsonl
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import sys
from typing import Any, Callable, Dict, Optional, TextIO

from .engine import StorageEngine
from .models import StorageRepairError
from . import persistence


def _b64_decode(value: Any, field_name: str) -> bytes:
    """解码请求中的 base64 内容字段。"""
    if not isinstance(value, str):
        raise StorageRepairError(f"{field_name} must be a base64 string")
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (ValueError, UnicodeEncodeError, binascii.Error) as exc:
        raise StorageRepairError(f"{field_name} is not valid base64: {exc}") from exc


class RequestProcessor:
    """把逐条请求字典分派到 :class:`StorageEngine` 方法。"""

    def __init__(self) -> None:
        self.engine = StorageEngine()

    def handle(self, request: Any) -> Dict[str, Any]:
        """处理单个请求字典，返回可 JSON 序列化的响应字典。"""
        if not isinstance(request, dict):
            return self._error(None, StorageRepairError("request must be a JSON object"))
        op = request.get("op")
        if not isinstance(op, str):
            return self._error(None, StorageRepairError("request missing string field 'op'"))
        handler: Optional[Callable[[Dict[str, Any]], Any]] = getattr(
            self, f"_op_{op}", None
        )
        if handler is None:
            return self._error(op, StorageRepairError(f"unknown op {op!r}"))
        try:
            result = handler(request)
            return {"ok": True, "op": op, "result": result}
        except StorageRepairError as exc:
            return self._error(op, exc)

    @staticmethod
    def _error(op: Optional[str], exc: Exception) -> Dict[str, Any]:
        return {
            "ok": False,
            "op": op,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }

    # -- 各操作 -------------------------------------------------------------

    def _op_ping(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return {"pong": True}

    def _op_help(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return {"ops": sorted(
            name[4:] for name in dir(self) if name.startswith("_op_")
        )}

    def _op_create_stripe(self, req: Dict[str, Any]) -> Dict[str, Any]:
        data = None
        if "data_b64" in req and req["data_b64"] is not None:
            raw = req["data_b64"]
            if not isinstance(raw, list):
                raise StorageRepairError("data_b64 must be a list of base64 strings")
            data = [_b64_decode(item, f"data_b64[{i}]") for i, item in enumerate(raw)]
        stripe = self.engine.create_stripe(
            stripe_id=req["stripe_id"], k=req["k"], m=req["m"], data_blocks=data
        )
        return {"stripe_id": stripe.stripe_id, "k": stripe.k, "m": stripe.m,
                "total": stripe.total}

    def _op_list_stripes(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return {"stripes": self.engine.list_stripes()}

    def _op_write_block(self, req: Dict[str, Any]) -> Dict[str, Any]:
        self.engine.write_block(
            req["stripe_id"], req["position"],
            _b64_decode(req.get("content_b64"), "content_b64"),
        )
        return {"written": True}

    def _op_mark_missing(self, req: Dict[str, Any]) -> Dict[str, Any]:
        self.engine.mark_missing(req["stripe_id"], req["position"])
        return {"marked": "missing"}

    def _op_mark_corrupt(self, req: Dict[str, Any]) -> Dict[str, Any]:
        self.engine.mark_corrupt(req["stripe_id"], req["position"])
        return {"marked": "corrupt"}

    def _op_add_candidate(self, req: Dict[str, Any]) -> Dict[str, Any]:
        self.engine.add_candidate(
            req["stripe_id"], req["position"], req["source"],
            _b64_decode(req.get("content_b64"), "content_b64"),
        )
        return {"candidate_registered": True, "source": req["source"]}

    def _op_repair(self, req: Dict[str, Any]) -> Dict[str, Any]:
        record = self.engine.repair_stripe(
            req["stripe_id"], positions=req.get("positions")
        )
        return record.to_dict()

    def _op_verify(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return self.engine.verify_stripe(req["stripe_id"]).to_dict()

    def _op_query_position(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return self.engine.query_position(req["stripe_id"], req["position"])

    def _op_repair_history(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "records": [
                record.to_dict()
                for record in self.engine.repair_history(req["stripe_id"])
            ]
        }

    def _op_internal_state(self, req: Dict[str, Any]) -> Dict[str, Any]:
        return self.engine.internal_state()

    def _op_export(self, req: Dict[str, Any]) -> Dict[str, Any]:
        persistence.export_engine(self.engine, req["path"])
        return {"exported": req["path"]}

    def _op_import(self, req: Dict[str, Any]) -> Dict[str, Any]:
        persistence.import_file(self.engine, req["path"])
        return {"imported": req["path"], "stripes": self.engine.list_stripes()}


def run_stream(inp: TextIO, out: TextIO) -> int:
    """从 ``inp`` 逐行读取请求并把响应逐行写入 ``out``。

    :return: 始终返回 0；单条请求失败只体现在响应的 ``ok=false``。
    """
    processor = RequestProcessor()
    for line_number, line in enumerate(inp, start=1):
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response = {
                "ok": False,
                "op": None,
                "error": {
                    "type": "JSONDecodeError",
                    "message": f"line {line_number}: {exc.msg}",
                },
            }
        else:
            response = processor.handle(request)
        out.write(json.dumps(response, ensure_ascii=False, sort_keys=True) + "\n")
    out.flush()
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    """命令行入口：默认读 stdin，可用 ``--file`` 指定 JSONL 文件。"""
    parser = argparse.ArgumentParser(
        description="Offline storage-repair kernel JSONL interface"
    )
    parser.add_argument(
        "--file", "-f", default=None,
        help="JSON Lines request file (defaults to standard input)",
    )
    args = parser.parse_args(argv)
    if args.file:
        with open(args.file, "r", encoding="utf-8") as handle:
            return run_stream(handle, sys.stdout)
    return run_stream(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
