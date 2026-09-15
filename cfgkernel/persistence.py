"""JSON 持久化：整体快照落盘 / 重载。

设计要点：

- **原子写**：先写同目录临时文件再 ``os.replace``，崩溃只会留下临时文件，
  不会产生半个 JSON；
- **校验和**：文件内嵌 ``meta.checksum``（对 payload 的 SHA-256），载入时
  先验 JSON 合法性，再验结构完整性，最后验校验和；
- **失败不变**：:func:`load_kernel` 先在一个全新内核上重建，全部成功才返回，
  调用方已有的内核状态不会被部分污染；
- **清晰报错**：JSON 语法错误 / 顶层结构错误 / 缺字段 / 校验和不符分别给出
  不同的 :class:`LoadError` 信息。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from typing import Any, Dict, Optional

from .config import Config
from .errors import LoadError
from .kernel import ConfigKernel
from .migrate import (
    MigrationRecord,
    RollbackRecord,
)
from .model import Capability, DeviceModel
from .schema import FieldSpec

_CHECKSUM_KEYS = (
    "format",
    "capabilities",
    "models",
    "fields",
    "migration_steps",
    "configs",
    "migration_records",
    "rollback_records",
)


def _checksum(payload: Dict[str, Any]) -> str:
    body = json.dumps(
        {k: payload.get(k) for k in _CHECKSUM_KEYS},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def save_kernel(kernel: ConfigKernel, path: str) -> str:
    """把整个内核状态写成单个 JSON 文件，返回文件绝对路径。"""
    payload = kernel.to_payload()
    envelope = {
        "meta": {
            "format": ConfigKernel.FORMAT,
            "checksum": _checksum(payload),
        },
        "payload": payload,
    }
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=".cfgkernel-", suffix=".tmp", dir=directory
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(envelope, fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return os.path.abspath(path)


def load_kernel(path: str) -> ConfigKernel:
    """从 JSON 文件重建内核；任何损坏 / 缺失都抛 :class:`LoadError`。"""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw_text = fh.read()
    except FileNotFoundError:
        raise LoadError(f"状态文件不存在：{path}") from None
    except OSError as exc:
        raise LoadError(f"状态文件无法读取：{path}：{exc}") from None

    if not raw_text.strip():
        raise LoadError(f"状态文件为空：{path}")

    try:
        envelope = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise LoadError(
            f"状态文件 JSON 损坏（第 {exc.lineno} 行第 {exc.colno} 列）："
            f"{exc.msg}；内核状态保持不变"
        ) from None

    if not isinstance(envelope, dict):
        raise LoadError(
            f"状态文件顶层结构必须是对象，实际为 {type(envelope).__name__}；"
            "内核状态保持不变"
        )
    for key in ("meta", "payload"):
        if key not in envelope:
            raise LoadError(
                f"状态文件缺少顶层字段 {key!r}；内核状态保持不变"
            )
    meta = envelope["meta"]
    payload = envelope["payload"]
    if not isinstance(meta, dict) or not isinstance(payload, dict):
        raise LoadError(
            "状态文件的 'meta' / 'payload' 必须都是对象；内核状态保持不变"
        )

    if meta.get("format") != ConfigKernel.FORMAT:
        raise LoadError(
            f"状态文件格式 {meta.get('format')!r} 与当前内核 "
            f"{ConfigKernel.FORMAT!r} 不匹配；内核状态保持不变"
        )

    expected_sum = meta.get("checksum")
    if not isinstance(expected_sum, str):
        raise LoadError("状态文件 meta.checksum 缺失或不是字符串；状态保持不变")
    actual_sum = _checksum(payload)
    if expected_sum != actual_sum:
        raise LoadError(
            "状态文件校验和不符：文件可能被手工修改或写入不完整"
            f"（期望 {expected_sum[:16]}…，实际 {actual_sum[:16]}…）；"
            "内核状态保持不变"
        )

    # 在全新内核上重建；任何一步抛错都不会影响调用方已有状态
    try:
        return _build_kernel(payload)
    except LoadError:
        raise
    except KeyError as exc:
        raise LoadError(
            f"状态文件缺少必需字段 {exc}；内核状态保持不变"
        ) from None
    except Exception as exc:
        raise LoadError(
            f"状态文件内容无法重建内核：{type(exc).__name__}: {exc}；"
            "内核状态保持不变"
        ) from exc


def _build_kernel(payload: dict) -> ConfigKernel:
    kernel = ConfigKernel()

    for item in _require_list(payload, "capabilities"):
        _require_type(item, dict, "capabilities[]")
        cap = Capability.from_json(item)
        if cap.name in kernel.capabilities:
            raise LoadError(f"能力 {cap.name!r} 在文件中重复出现")
        kernel.capabilities[cap.name] = cap

    for item in _require_list(payload, "models"):
        _require_type(item, dict, "models[]")
        name = item["name"]
        if name in kernel.models:
            raise LoadError(f"型号 {name!r} 在文件中重复出现")
        kernel.models[name] = DeviceModel.from_json(item, kernel.capabilities)

    for item in _require_list(payload, "fields"):
        _require_type(item, dict, "fields[]")
        spec = FieldSpec.from_json(item)
        if spec.path in kernel.fields:
            raise LoadError(f"字段 {spec.path!r} 在文件中重复出现")
        kernel.fields[spec.path] = spec

    # 迁移边：反序列化后直接装入（登记时的链一致性已保证），但再校验一遍相接
    from .migrate import MigrationStep

    for item in _require_list(payload, "migration_steps"):
        _require_type(item, dict, "migration_steps[]")
        step = MigrationStep.from_json(item)
        if step.edge in kernel._steps:
            raise LoadError(f"迁移边 {step.label()} 在文件中重复出现")
        kernel._steps[step.edge] = step

    for item in _require_list(payload, "configs"):
        _require_type(item, dict, "configs[]")
        cfg = Config.from_json(item)
        if not cfg.name:
            raise LoadError("持久化的配置必须带有非空 name")
        if cfg.name in kernel.configs:
            raise LoadError(f"配置 {cfg.name!r} 在文件中重复出现")
        kernel.configs[cfg.name] = cfg

    for item in _require_list(payload, "migration_records"):
        _require_type(item, dict, "migration_records[]")
        kernel.migration_records.append(MigrationRecord.from_json(item))

    for item in _require_list(payload, "rollback_records"):
        _require_type(item, dict, "rollback_records[]")
        kernel.rollback_records.append(RollbackRecord.from_json(item))

    # 重建完成后再做一次跨部分一致性检查
    _cross_validate(kernel)
    return kernel


def _cross_validate(kernel: ConfigKernel) -> None:
    # 迁移边必须首尾相接成一条不分叉的链
    edges = sorted(kernel._steps, key=lambda e: e[0])
    for (a, b), (c, d) in zip(edges, edges[1:]):
        if b != c:
            raise LoadError(
                f"演进链断裂：边 {a} -> {b} 的终点与下一条边 {c} -> {d} 的起点不一致"
            )
    # 字段引用的能力必须存在；字段在其每个规则版本上的默认值都必须合法
    for path, spec in kernel.fields.items():
        cap = spec.required_capability
        if cap is not None and cap not in kernel.capabilities:
            raise LoadError(f"字段 '{path}' 引用了文件中不存在的能力 '{cap}'")
        versions = [spec.introduced] + spec.change_versions()
        for ver in versions:
            rf = spec.resolve_at(ver)
            if rf is None:
                continue
            problems = rf.validate_value(rf.default)
            if problems:
                raise LoadError(
                    f"字段 '{path}' 在版本 {ver} 的默认值非法："
                    f"{problems[0].message}")
    # 配置引用的字段路径 / 版本必须能解析
    for name, cfg in kernel.configs.items():
        for src in cfg.sources.values():
            if src.path not in kernel.fields and src.path not in cfg.extras:
                raise LoadError(
                    f"配置 '{name}' 的来源字段 '{src.path}' 既未登记也不在忽略清单"
                )
        for path in cfg.values:
            if path not in kernel.fields:
                raise LoadError(
                    f"配置 '{name}' 含有文件中未登记的活动字段 '{path}'"
                )


def _require_list(payload: dict, key: str) -> list:
    if key not in payload:
        raise LoadError(f"状态文件 payload 缺少必需字段 {key!r}；状态保持不变")
    value = payload[key]
    if not isinstance(value, list):
        raise LoadError(
            f"状态文件字段 {key!r} 必须是数组，实际为 {type(value).__name__}"
        )
    return value


def _require_type(value: Any, typ: type, where: str) -> None:
    if not isinstance(value, typ):
        raise LoadError(
            f"状态文件 {where} 必须是 {typ.__name__}，实际为 "
            f"{type(value).__name__}；状态保持不变"
        )
