"""确定性指纹：把结构化数据规范序列化后做 SHA-256。

所有排序均显式给定（绝不依赖集合迭代顺序），保证：

- 同一逻辑状态永远得到同一指纹；
- 跨进程、跨机器、重复求解结果完全一致。

:func:`canonical_json` 接受 tuple/set/frozenset：元组按序转数组，
集合排序后转数组，因此调用方可以直接传入领域模型里的结构化签名。
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


def _normalize(obj: Any) -> Any:
    if isinstance(obj, (set, frozenset)):
        return [_normalize(x) for x in sorted(obj, key=lambda z: json.dumps(_normalize(z), sort_keys=True))]
    if isinstance(obj, tuple):
        return [_normalize(x) for x in obj]
    if isinstance(obj, dict):
        return {str(k): _normalize(v) for k, v in sorted(obj.items(), key=lambda kv: str(kv[0]))}
    if isinstance(obj, list):
        return [_normalize(x) for x in obj]
    return obj


def canonical_json(obj: Any) -> str:
    return json.dumps(_normalize(obj), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(prefix: str, obj: Any) -> str:
    payload = prefix + ":" + canonical_json(obj)
    return prefix + "_" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
