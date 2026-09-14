"""JSON 快照导出 / 导入。

快照是一个 UTF-8 编码的 JSON 文件，结构为：

================== ======================================================
字段               含义
================== ======================================================
``format``         固定 ``"storage-repair-snapshot"``
``format_version`` 目前为 ``1``
``coding``         校验配置（GF(256)、多项式 0x11B、Cauchy 系统型）
``stripes``        条带列表（结构、块内容/缺失标记、候选、块长、补零）
``repair_history`` 条带标识 -> 修复记录列表
``verification_reports`` 条带标识 -> 导出当时的只读验证报告
================== ======================================================

导入时执行严格校验：顶层字段、格式名与版本、条带标识唯一、k/m 合法、
块数量等于 k+m、位置编号连续、状态枚举合法、内容与候选均可被 base64
解码（候选还要复核指纹）、补零长度自洽、修复历史与验证报告引用的
条带必须存在、修复序号从 1 连续且其中的位置编号都在范围内。任何
错误抛 :class:`~storage_repair.models.SerializationError`，错误信息
尽量定位到条带与位置；**先在局部变量中完成全部构建，成功后才替换
引擎状态**，因此失败时引擎内存状态保持不变。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from .coding import GF_GENERATOR, GF_POLY
from .engine import StorageEngine
from .models import (
    BlockStatus,
    RepairRecord,
    SerializationError,
    Stripe,
    VerificationReport,
)
FORMAT_NAME = "storage-repair-snapshot"
FORMAT_VERSION = 1


# --- 导出 -------------------------------------------------------------------


def export_engine_to_dict(engine: StorageEngine) -> Dict[str, Any]:
    """生成引擎的完整快照字典（键顺序确定）。

    验证报告在导出时按只读方式重新生成；由于验证是确定性纯读，
    其结果与此前对同一状态执行验证的结果逐字段一致。
    """
    stripe_ids = engine.list_stripes()
    stripes: List[Dict[str, Any]] = []
    histories: Dict[str, Any] = {}
    reports: Dict[str, Any] = {}
    for stripe_id in stripe_ids:
        stripes.append(engine.get_stripe(stripe_id).to_dict())
        histories[stripe_id] = [
            record.to_dict() for record in engine.repair_history(stripe_id)
        ]
        reports[stripe_id] = engine.verify_stripe(stripe_id).to_dict()
    return {
        "format": FORMAT_NAME,
        "format_version": FORMAT_VERSION,
        "coding": {
            "field": "GF(256)",
            "primitive_polynomial": f"0x{GF_POLY:03X}",
            "generator": GF_GENERATOR,
            "construction": "cauchy-systematic",
            "guarantee": "any k of k+m columns are linearly independent (MDS)",
        },
        "stripes": stripes,
        "repair_history": histories,
        "verification_reports": reports,
    }


def export_engine(engine: StorageEngine, path: str) -> None:
    """把引擎快照以确定的字节布局写入 ``path``（UTF-8、缩进、键排序）。"""
    snapshot = export_engine_to_dict(engine)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


# --- 导入 -------------------------------------------------------------------


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SerializationError(message)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_stripe_object(raw: Any, index: int) -> Stripe:
    """校验并反序列化单个条带对象。"""
    if not isinstance(raw, dict):
        raise SerializationError(f"stripes[{index}] must be an object")
    try:
        stripe = Stripe.from_dict(raw)
    except SerializationError:
        raise
    block_length = stripe.block_length
    for block in stripe.blocks:
        prefix = f"stripe {stripe.stripe_id!r} position {block.position}"
        _require(
            0 <= block.pad_length <= block_length,
            f"{prefix}: pad_length {block.pad_length} outside [0, {block_length}]",
        )
        if block.content is not None:
            _require(
                len(block.content) <= block_length,
                f"{prefix}: logical content length {len(block.content)} exceeds "
                f"block_length {block_length}",
            )
            expected_pad = block_length - len(block.content)
            _require(
                block.pad_length == expected_pad,
                f"{prefix}: pad_length {block.pad_length} inconsistent with "
                f"content/block_length (expected {expected_pad})",
            )
        # 缺失块也保留 pad_length：重建短数据块后要靠它截回逻辑长度。
        if block.status == BlockStatus.INTACT:
            _require(
                block.content is not None,
                f"{prefix}: status 'intact' requires content",
            )
        if block.status == BlockStatus.MISSING:
            _require(
                block.content is None,
                f"{prefix}: status 'missing' requires null content",
            )
        seen_sources: Dict[str, str] = {}
        for candidate in block.candidates:
            fp = candidate.fingerprint()
            if candidate.source in seen_sources:
                raise SerializationError(
                    f"{prefix}: duplicate candidate source {candidate.source!r}"
                )
            seen_sources[candidate.source] = fp
            _require(
                len(candidate.content) <= block_length,
                f"{prefix}: candidate from {candidate.source!r} longer than "
                f"block_length {block_length}",
            )
    return stripe


def _validate_history(
    stripe: Stripe, raw_history: Any
) -> List[RepairRecord]:
    """校验某条带的修复历史。"""
    sid = stripe.stripe_id
    if not isinstance(raw_history, list):
        raise SerializationError(f"repair_history[{sid!r}] must be a list")
    records: List[RepairRecord] = []
    for index, raw in enumerate(raw_history):
        if not isinstance(raw, dict):
            raise SerializationError(
                f"repair_history[{sid!r}][{index}] must be an object"
            )
        record = RepairRecord.from_dict(raw)
        _require(
            record.sequence == index + 1,
            f"repair_history[{sid!r}][{index}]: sequence must be contiguous "
            f"from 1, got {record.sequence}",
        )
        _require(isinstance(record.success, bool), "success must be boolean")
        for name, values in (
            ("target_positions", record.target_positions),
            ("used_positions", record.used_positions),
        ):
            for pos in values:
                _require(
                    _is_int(pos) and 0 <= pos < stripe.total,
                    f"repair_history[{sid!r}] #{record.sequence}: {name} "
                    f"references out-of-range position {pos}",
                )
        for pos in record.adopted_fingerprints:
            _require(
                _is_int(pos) and 0 <= pos < stripe.total,
                f"repair_history[{sid!r}] #{record.sequence}: fingerprint "
                f"references out-of-range position {pos}",
            )
            _require(
                len(record.adopted_fingerprints[pos]) == 64,
                f"repair_history[{sid!r}] #{record.sequence}: fingerprint at "
                f"position {pos} is not a 64-char SHA-256 hex digest",
            )
        for combo in record.inconsistent_positions:
            for pos in combo:
                _require(
                    _is_int(pos) and 0 <= pos < stripe.total,
                    f"repair_history[{sid!r}] #{record.sequence}: inconsistent "
                    f"combo references out-of-range position {pos}",
                )
        if not record.success:
            _require(
                record.reason is not None,
                f"repair_history[{sid!r}] #{record.sequence}: failed record "
                "must carry a reason",
            )
        records.append(record)
    return records


def _validate_report(stripe: Stripe, raw_report: Any) -> VerificationReport:
    """校验某条带的验证报告并返回其对象形式。"""
    sid = stripe.stripe_id
    if not isinstance(raw_report, dict):
        raise SerializationError(f"verification_reports[{sid!r}] must be an object")
    for field_name in ("stripe_id", "reconstructable", "positions",
                       "inconsistent_positions", "detail"):
        if field_name not in raw_report:
            raise SerializationError(
                f"verification_reports[{sid!r}]: missing field {field_name!r}"
            )
    _require(
        raw_report["stripe_id"] == sid,
        f"verification_reports[{sid!r}]: stripe_id mismatch "
        f"({raw_report['stripe_id']!r})",
    )
    _require(
        isinstance(raw_report["reconstructable"], bool),
        f"verification_reports[{sid!r}]: reconstructable must be boolean",
    )
    positions = raw_report["positions"]
    if not isinstance(positions, dict):
        raise SerializationError(
            f"verification_reports[{sid!r}]: positions must be an object"
        )
    for key, value in positions.items():
        if not (isinstance(key, str) and key.isdigit()):
            raise SerializationError(
                f"verification_reports[{sid!r}]: position key {key!r} "
                "must be an integer string"
            )
        pos = int(key)
        _require(0 <= pos < stripe.total, f"report position key {pos} out of range")
        try:
            BlockStatus(value)
        except ValueError:
            raise SerializationError(
                f"verification_reports[{sid!r}]: unknown status {value!r}"
            ) from None
    combos = raw_report["inconsistent_positions"]
    if not isinstance(combos, list):
        raise SerializationError(
            f"verification_reports[{sid!r}]: inconsistent_positions must be a list"
        )
    for combo in combos:
        if not isinstance(combo, list) or not all(
            _is_int(pos) and 0 <= pos < stripe.total for pos in combo
        ):
            raise SerializationError(
                f"verification_reports[{sid!r}]: combo must be a list of in-range "
                "integer positions"
            )
    try:
        return VerificationReport.from_dict(raw_report)
    except SerializationError:
        raise


def parse_snapshot(
    snapshot: Any,
) -> Tuple[List[Stripe], Dict[str, List[RepairRecord]],
           Dict[str, VerificationReport]]:
    """校验快照字典并构建出新的条带、历史与报告。

    本函数不触碰任何引擎状态，全部成功后调用方才进行替换，因此
    解析失败时原引擎内存状态保持不变。

    :return: ``(stripes, histories, reports)``。
    :raises SerializationError: 任何结构、编码或交叉引用错误。
    """
    if not isinstance(snapshot, dict):
        raise SerializationError("snapshot root must be a JSON object")
    for field_name in ("format", "format_version", "stripes"):
        if field_name not in snapshot:
            raise SerializationError(f"snapshot missing top-level field {field_name!r}")
    _require(
        snapshot["format"] == FORMAT_NAME,
        f"unsupported snapshot format {snapshot['format']!r}; expected "
        f"{FORMAT_NAME!r}",
    )
    _require(
        snapshot.get("format_version") == FORMAT_VERSION,
        f"unsupported snapshot version {snapshot.get('format_version')!r}; "
        f"expected {FORMAT_VERSION}",
    )
    raw_stripes = snapshot["stripes"]
    if not isinstance(raw_stripes, list):
        raise SerializationError("'stripes' must be a list")

    stripes: List[Stripe] = []
    seen_ids: Dict[str, None] = {}
    for index, raw in enumerate(raw_stripes):
        if not isinstance(raw, dict) or "stripe_id" not in raw:
            raise SerializationError(f"stripes[{index}] must be an object with stripe_id")
        sid = raw["stripe_id"]
        if not isinstance(sid, str) or not sid:
            raise SerializationError(f"stripes[{index}]: stripe_id must be non-empty string")
        if sid in seen_ids:
            raise SerializationError(f"duplicate stripe id {sid!r}")
        seen_ids[sid] = None
        stripes.append(_validate_stripe_object(raw, index))

    raw_history = snapshot.get("repair_history", {})
    raw_reports = snapshot.get("verification_reports", {})
    if not isinstance(raw_history, dict):
        raise SerializationError("'repair_history' must be an object")
    if not isinstance(raw_reports, dict):
        raise SerializationError("'verification_reports' must be an object")

    # 修复历史 / 验证报告引用的条带必须存在（不许多余键，也不许漏键）。
    for sid in raw_history:
        if sid not in seen_ids:
            raise SerializationError(
                f"repair_history references unknown stripe {sid!r}"
            )
    for sid in raw_reports:
        if sid not in seen_ids:
            raise SerializationError(
                f"verification_reports references unknown stripe {sid!r}"
            )

    by_id = {stripe.stripe_id: stripe for stripe in stripes}
    histories: Dict[str, List[RepairRecord]] = {}
    reports: Dict[str, Dict[str, Any]] = {}
    for stripe in stripes:
        histories[stripe.stripe_id] = _validate_history(
            stripe, raw_history.get(stripe.stripe_id, [])
        )
        if stripe.stripe_id in raw_reports:
            reports[stripe.stripe_id] = _validate_report(
                stripe, raw_reports[stripe.stripe_id]
            )
    return stripes, histories, reports


def install_snapshot(
    engine: StorageEngine,
    stripes: List[Stripe],
    histories: Dict[str, List[RepairRecord]],
    reports: Dict[str, VerificationReport],
) -> None:
    """把已校验的构建结果整体替换进引擎（由 :func:`load_snapshot` 调用）。"""
    from .coding import ReedSolomonCodec

    new_stripes = {stripe.stripe_id: stripe for stripe in stripes}
    new_histories = {sid: list(records) for sid, records in histories.items()}
    new_codecs = {
        stripe.stripe_id: ReedSolomonCodec(stripe.k, stripe.m) for stripe in stripes
    }
    # 全部新对象就绪后一次性替换引用，失败路径不会执行到这里。
    engine._stripes = new_stripes  # noqa: SLF001
    engine._histories = new_histories  # noqa: SLF001
    engine._codecs = new_codecs  # noqa: SLF001
    engine._imported_reports = dict(reports)  # noqa: SLF001


def load_snapshot(engine: StorageEngine, snapshot: Any) -> None:
    """校验并整体载入快照；失败时引擎状态保持不变。"""
    stripes, histories, reports = parse_snapshot(snapshot)
    install_snapshot(engine, stripes, histories, reports)


def import_file(engine: StorageEngine, path: str) -> None:
    """从 JSON 文件载入快照；文件损坏或字段缺失抛
    :class:`SerializationError`，引擎状态保持不变。
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        raise SerializationError(f"cannot read snapshot file {path!r}: {exc}") from exc
    try:
        snapshot = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SerializationError(
            f"snapshot file {path!r} is not valid JSON: {exc.msg} "
            f"(line {exc.lineno}, column {exc.colno})"
        ) from exc
    load_snapshot(engine, snapshot)
