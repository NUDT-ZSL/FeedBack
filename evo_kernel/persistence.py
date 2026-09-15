"""快照导出与重新载入（需求 8）。

导出包是一个 JSON 文档::

    {
      "format": "evo-kernel-bundle",
      "bundle_version": 1,
      "versions": [ ... 版本链与字段规则 ... ],
      "records":  [ ... 已登记的数据及其解析结果 ... ],
      "migrations": [ ... 迁移记录 ... ],
      "checksum_sha256": "<除该字段外全部内容的 SHA-256>"
    }

载入时严格校验：顶层结构、必填字段、类型、引用一致性（迁移记录的版本 /
记录 id 必须存在、版本链可重建），最后比对 SHA-256。任何一步失败都抛出
:class:`BundleError`，载入在一个全新的临时对象上完成，**全部成功后**才
替换调用方的 Kernel 状态——失败不会留下半新半旧的数据。
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any, Dict, Tuple

from .errors import BundleError
from .paths import canonical_bytes, json_dumps_pretty

BUNDLE_FORMAT = "evo-kernel-bundle"
BUNDLE_VERSION = 1

_TOP_FIELDS = {
    "format": str,
    "bundle_version": int,
    "versions": list,
    "records": list,
    "migrations": list,
}


def fingerprint(value: Any) -> str:
    """任意 JSON 值的 SHA-256 指纹（基于规范化字节，可复现）。"""
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def build_bundle(
    versions_snapshot: Dict[str, Any],
    records: Dict[str, Any],
    migrations: Dict[str, Any],
) -> Dict[str, Any]:
    """组装导出包（含校验和）。输入会被深拷贝。"""
    bundle: Dict[str, Any] = {
        "format": BUNDLE_FORMAT,
        "bundle_version": BUNDLE_VERSION,
        "versions": copy.deepcopy(versions_snapshot["versions"]),
        "records": copy.deepcopy(list(records)),
        "migrations": copy.deepcopy(list(migrations)),
    }
    bundle["checksum_sha256"] = _checksum(bundle)
    return bundle


def _checksum(bundle_without_checksum: Dict[str, Any]) -> str:
    payload = {k: v for k, v in bundle_without_checksum.items() if k != "checksum_sha256"}
    return fingerprint(payload)


def dumps(bundle: Dict[str, Any]) -> str:
    """导出包序列化为可读 JSON 文本。"""
    return json_dumps_pretty(bundle)


def loads(text: str) -> Dict[str, Any]:
    """解析 JSON 文本并做完整校验，返回规范化的导出包字典。"""
    if not isinstance(text, str) or not text.strip():
        raise BundleError("导出包为空：期望 JSON 文本")
    try:
        bundle = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BundleError(
            f"导出包不是合法 JSON：第 {exc.lineno} 行第 {exc.colno} 列：{exc.msg}"
        ) from exc
    return validate_bundle(bundle)


def validate_bundle(bundle: Any) -> Dict[str, Any]:
    """对已解析的导出包字典做严格校验，失败抛 :class:`BundleError`。"""
    if not isinstance(bundle, dict):
        raise BundleError(f"导出包顶层必须是对象，实际为 {type(bundle).__name__}")

    missing = [f for f in _TOP_FIELDS if f not in bundle]
    if missing:
        raise BundleError(f"导出包缺少必填字段: {missing}")

    if bundle["format"] != BUNDLE_FORMAT:
        raise BundleError(
            f"format 必须是 {BUNDLE_FORMAT!r}，实际为 {bundle['format']!r}"
        )
    if bundle["bundle_version"] != BUNDLE_VERSION:
        raise BundleError(
            f"bundle_version 不被支持：期望 {BUNDLE_VERSION}，"
            f"实际为 {bundle['bundle_version']!r}"
        )
    for key, want in _TOP_FIELDS.items():
        if not isinstance(bundle[key], want) or (want is int and isinstance(bundle[key], bool)):
            raise BundleError(
                f"字段 {key!r} 类型错误：期望 {want.__name__}，"
                f"实际为 {type(bundle[key]).__name__}"
            )

    checksum = bundle.get("checksum_sha256")
    if not isinstance(checksum, str) or not checksum:
        raise BundleError("缺少 checksum_sha256 校验和")
    actual = _checksum(bundle)
    if actual != checksum:
        raise BundleError(
            f"校验和不匹配：导出包可能已损坏（包内 {checksum}，实际 {actual}）"
        )

    _validate_versions(bundle["versions"])
    _validate_records(bundle["records"], bundle["versions"])
    _validate_migrations(bundle["migrations"], bundle["versions"], bundle["records"])
    return bundle


def _validate_versions(versions: Any) -> None:
    if not versions:
        raise BundleError("versions 为空：至少需要一个格式版本")
    seen = set()
    for i, v in enumerate(versions):
        loc = f"versions[{i}]"
        if not isinstance(v, dict):
            raise BundleError(f"{loc} 必须是对象")
        for key in ("version_id", "parent", "fields", "description"):
            if key not in v:
                raise BundleError(f"{loc} 缺少字段 {key!r}")
        if not isinstance(v["version_id"], str) or not v["version_id"]:
            raise BundleError(f"{loc}.version_id 必须是非空字符串")
        if v["version_id"] in seen:
            raise BundleError(f"{loc}：版本 id {v['version_id']!r} 重复")
        seen.add(v["version_id"])
        if v["parent"] is not None and not isinstance(v["parent"], str):
            raise BundleError(f"{loc}.parent 必须是字符串或 null")
        if not isinstance(v["fields"], list):
            raise BundleError(f"{loc}.fields 必须是数组")
        if not isinstance(v["description"], str):
            raise BundleError(f"{loc}.description 必须是字符串")
    # 父版本引用必须存在，且每个版本的父版本排在它前面（链顺序）。
    by_id = {v["version_id"]: v for v in versions}
    for i, v in enumerate(versions):
        if v["parent"] is None:
            continue
        if v["parent"] not in by_id:
            raise BundleError(
                f"versions[{i}] 的父版本 {v['parent']!r} 在导出包中不存在"
            )
        earlier = [j for j, x in enumerate(versions[:i]) if x["version_id"] == v["parent"]]
        if not earlier:
            raise BundleError(
                f"versions[{i}] 的父版本 {v['parent']!r} 必须排在其前面"
            )


def _validate_records(records: Any, versions: Any) -> None:
    by_id = {v["version_id"] for v in versions}
    seen = set()
    for i, r in enumerate(records):
        loc = f"records[{i}]"
        if not isinstance(r, dict):
            raise BundleError(f"{loc} 必须是对象")
        for key in ("record_id", "version_id", "data", "parse_result"):
            if key not in r:
                raise BundleError(f"{loc} 缺少字段 {key!r}")
        if not isinstance(r["record_id"], str) or not r["record_id"]:
            raise BundleError(f"{loc}.record_id 必须是非空字符串")
        if r["record_id"] in seen:
            raise BundleError(f"{loc}：记录 id {r['record_id']!r} 重复")
        seen.add(r["record_id"])
        if r["version_id"] not in by_id:
            raise BundleError(
                f"{loc}.version_id {r['version_id']!r} 未在 versions 中登记"
            )
        if not isinstance(r["data"], dict):
            raise BundleError(f"{loc}.data 必须是对象")
        pr = r["parse_result"]
        if not isinstance(pr, dict) or "ok" not in pr:
            raise BundleError(f"{loc}.parse_result 必须是含 ok 的对象")


def _validate_migrations(migrations: Any, versions: Any, records: Any) -> None:
    vids = {v["version_id"] for v in versions}
    rids = {r["record_id"] for r in records}
    for i, m in enumerate(migrations):
        loc = f"migrations[{i}]"
        if not isinstance(m, dict):
            raise BundleError(f"{loc} 必须是对象")
        for key in ("migration_id", "record_id", "source_version", "target_version", "result"):
            if key not in m:
                raise BundleError(f"{loc} 缺少字段 {key!r}")
        if not isinstance(m["migration_id"], str) or not m["migration_id"]:
            raise BundleError(f"{loc}.migration_id 必须是非空字符串")
        if m["record_id"] not in rids:
            raise BundleError(f"{loc}.record_id {m['record_id']!r} 在 records 中不存在")
        for key in ("source_version", "target_version"):
            if m[key] not in vids:
                raise BundleError(f"{loc}.{key} {m[key]!r} 未在 versions 中登记")
        result = m["result"]
        if not isinstance(result, dict) or not isinstance(result.get("data"), dict):
            raise BundleError(f"{loc}.result 必须是含 data 的对象")


def restore_from_bundle(bundle: Dict[str, Any]) -> Tuple[Dict[str, Any], list, list]:
    """从已校验的导出包提取 (registry_snapshot, records, migrations)。"""
    registry_snapshot = {"versions": copy.deepcopy(bundle["versions"])}
    records = copy.deepcopy(bundle["records"])
    migrations = copy.deepcopy(bundle["migrations"])
    return registry_snapshot, records, migrations
