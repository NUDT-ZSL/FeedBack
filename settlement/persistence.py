"""快照持久化：券、订单行、品类、冲突记录与求解结果的整文件存取。

安全性
------

- 写入是原子的：先写同目录临时文件，再 ``os.replace`` 覆盖，中途失败不会留下半截文件。
- 读取走“另起炉灶”策略：所有内容先在一个临时引擎上严格校验、重算并复核指纹，
  全部通过后才替换目标引擎状态；任何字段缺失/损坏/不自洽都抛
  :class:`SnapshotFormatError`，**原有引擎状态保持不变**。
"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any, Dict, List, Mapping, Tuple

from .errors import SnapshotFormatError, ValidationError
from .fingerprint import fingerprint
from .models import (
    NEUTRAL_PRIORITY,
    Category,
    Coupon,
    CouponSpec,
    CouponStatus,
    Issue,
    OrderLine,
    ConflictRecord,
    spec_signature,
)

SNAPSHOT_VERSION = 1

_REQUIRED_TOP_KEYS = {"format_version", "categories", "lines", "coupons", "conflict_seq"}


def dump_snapshot(engine: "SettlementEngine", path: str, *, include_result: bool = True) -> str:  # noqa: F821
    """把引擎状态写成 JSON 快照，返回写入路径。

    若 ``include_result=True`` 且引擎求解过，结果（含逐行抵扣与指纹）一并写入。
    """
    state = engine._state_for_snapshot()
    payload: Dict[str, Any] = {"format_version": SNAPSHOT_VERSION, **state}
    if include_result and engine.last_result is not None:
        res = engine.last_result
        payload["result"] = {
            "applications": [
                {
                    "coupon_id": a.coupon_id,
                    "total_discount_cents": a.total_discount_cents,
                    "eligible_line_ids": list(a.eligible_line_ids),
                    "eligible_total_cents": a.eligible_total_cents,
                    "allocations": [[x.line_id, x.amount_cents] for x in a.allocations],
                }
                for a in res.applications
            ],
            "rejected": [
                {
                    "coupon_id": r.coupon_id,
                    "reason_code": r.reason_code,
                    "reason": r.reason,
                    "detail": r.detail,
                }
                for r in res.rejected
            ],
            "total_discount_cents": res.total_discount_cents,
            "eligible_coupon_ids": list(res.eligible_coupon_ids),
            "frozen_coupon_ids": list(res.frozen_coupon_ids),
            "fingerprint": res.fingerprint,
            "order_fingerprint": res.order_fingerprint,
            "coupon_fingerprint": res.coupon_fingerprint,
        }

    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".settlement-snap-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return path


# ---------------------------------------------------------------------------
# 载入与严格校验
# ---------------------------------------------------------------------------

def _require_type(obj: Any, typ: type | Tuple[type, ...], what: str, path: str) -> Any:
    if not isinstance(obj, typ):
        name = getattr(typ, "__name__", str(typ))
        raise SnapshotFormatError(f"{what} 类型错误，期望 {name}", path)
    return obj


def _require_str(obj: Any, what: str, path: str, *, allow_empty: bool = False) -> str:
    _require_type(obj, str, what, path)
    if not allow_empty and obj.strip() == "":
        raise SnapshotFormatError(f"{what} 不能为空字符串", path)
    return obj


def _require_positive_int(obj: Any, what: str, path: str) -> int:
    _require_type(obj, int, what, path)
    if isinstance(obj, bool) or obj <= 0:
        raise SnapshotFormatError(f"{what} 必须是正整数", path)
    return obj


def _nonneg_int(obj: Any, what: str, path: str) -> int:
    _require_type(obj, int, what, path)
    if isinstance(obj, bool) or obj < 0:
        raise SnapshotFormatError(f"{what} 必须是非负整数", path)
    return obj


def _parse_spec(row: Any, path: str, known_categories: set) -> CouponSpec:
    _require_type(row, dict, "券参数", path)
    for key in ("coupon_id", "threshold_cents", "discount_cents", "applicable_categories"):
        if key not in row:
            raise SnapshotFormatError(f"缺少字段 {key!r}", f"{path}.{key}")
    cid = _require_str(row["coupon_id"], "券标识", f"{path}.coupon_id")
    threshold = _require_positive_int(row["threshold_cents"], "门槛", f"{path}.threshold_cents")
    discount = _require_positive_int(row["discount_cents"], "额度", f"{path}.discount_cents")
    cats_raw = _require_type(row["applicable_categories"], list, "适用品类", f"{path}.applicable_categories")
    cats: List[str] = []
    for i, c in enumerate(cats_raw):
        c = _require_str(c, "品类标识", f"{path}.applicable_categories[{i}]")
        if c not in known_categories:
            raise SnapshotFormatError(
                f"券 {cid!r} 引用了未登记品类 {c!r}", f"{path}.applicable_categories[{i}]"
            )
        cats.append(c)
    group = row.get("exclusive_group")
    if group is not None:
        group = _require_str(group, "互斥组", f"{path}.exclusive_group")
    priority = row.get("priority", NEUTRAL_PRIORITY)
    _require_type(priority, int, "优先级", f"{path}.priority")
    if isinstance(priority, bool):
        raise SnapshotFormatError("优先级不能是布尔值", f"{path}.priority")
    try:
        return CouponSpec.from_cents(
            coupon_id=cid,
            threshold_cents=threshold,
            discount_cents=discount,
            applicable_categories=cats,
            exclusive_group=group,
            priority=priority,
        )
    except ValidationError as exc:
        raise SnapshotFormatError(str(exc), path) from exc


def _build_engine_from_payload(payload: Mapping[str, Any]) -> "SettlementEngine":  # noqa: F821
    from .engine import SettlementEngine

    _require_type(payload, dict, "快照根对象", "$")
    missing = _REQUIRED_TOP_KEYS - set(payload)
    if missing:
        raise SnapshotFormatError(f"快照缺少顶层字段: {', '.join(sorted(missing))}", "$")
    if payload["format_version"] != SNAPSHOT_VERSION:
        raise SnapshotFormatError(
            f"不支持的快照版本 {payload['format_version']!r}，期望 {SNAPSHOT_VERSION}",
            "format_version",
        )

    engine = SettlementEngine()

    # --- 品类 ---
    cats_raw = _require_type(payload["categories"], list, "品类列表", "categories")
    seen_cats: set = set()
    for i, row in enumerate(cats_raw):
        p = f"categories[{i}]"
        _require_type(row, dict, "品类", p)
        if "category_id" not in row:
            raise SnapshotFormatError("缺少字段 'category_id'", f"{p}.category_id")
        cid = _require_str(row["category_id"], "品类标识", f"{p}.category_id")
        if cid in seen_cats:
            raise SnapshotFormatError(f"品类标识重复: {cid!r}", f"{p}.category_id")
        seen_cats.add(cid)
        name = row.get("name", "")
        _require_type(name, str, "品类名称", f"{p}.name")
        engine._categories[cid] = Category(category_id=cid, name=name)

    # --- 订单行 ---
    lines_raw = _require_type(payload["lines"], list, "订单行列表", "lines")
    seen_lines: set = set()
    for i, row in enumerate(lines_raw):
        p = f"lines[{i}]"
        _require_type(row, dict, "订单行", p)
        for key in ("line_id", "category_id", "unit_price_cents", "quantity"):
            if key not in row:
                raise SnapshotFormatError(f"缺少字段 {key!r}", f"{p}.{key}")
        lid = _require_str(row["line_id"], "商品行标识", f"{p}.line_id")
        if lid in seen_lines:
            raise SnapshotFormatError(f"商品行标识重复: {lid!r}", f"{p}.line_id")
        seen_lines.add(lid)
        cid = _require_str(row["category_id"], "品类标识", f"{p}.category_id")
        if cid not in seen_cats:
            raise SnapshotFormatError(
                f"商品行 {lid!r} 引用了未登记品类 {cid!r}", f"{p}.category_id"
            )
        unit = _require_positive_int(row["unit_price_cents"], "单价(分)", f"{p}.unit_price_cents")
        qty = _require_positive_int(row["quantity"], "数量", f"{p}.quantity")
        total_stored = row.get("line_total_cents", unit * qty)
        _require_type(total_stored, int, "行总额(分)", f"{p}.line_total_cents")
        if isinstance(total_stored, bool) or total_stored <= 0:
            raise SnapshotFormatError("行总额必须是正整数", f"{p}.line_total_cents")
        if total_stored != unit * qty:
            raise SnapshotFormatError(
                f"行总额 {total_stored} 与单价×数量 {unit * qty} 不符", f"{p}.line_total_cents"
            )
        engine._lines[lid] = OrderLine(
            line_id=lid,
            category_id=cid,
            unit_price_cents=unit,
            quantity=qty,
            line_total_cents=total_stored,
        )

    # --- 券与冲突 ---
    coupons_raw = _require_type(payload["coupons"], list, "券列表", "coupons")
    seen_coupons: set = set()
    max_seq = 0
    for i, row in enumerate(coupons_raw):
        p = f"coupons[{i}]"
        _require_type(row, dict, "券", p)
        for key in ("coupon_id", "status", "issues"):
            if key not in row:
                raise SnapshotFormatError(f"缺少字段 {key!r}", f"{p}.{key}")
        cid = _require_str(row["coupon_id"], "券标识", f"{p}.coupon_id")
        if cid in seen_coupons:
            raise SnapshotFormatError(f"券标识重复: {cid!r}", f"{p}.coupon_id")
        seen_coupons.add(cid)

        status_value = _require_str(row["status"], "券状态", f"{p}.status")
        try:
            status = CouponStatus(status_value)
        except ValueError:
            raise SnapshotFormatError(
                f"未知券状态 {status_value!r}（合法值: single/conflicted/resolved）", f"{p}.status"
            )

        issues_raw = _require_type(row["issues"], list, "发放记录", f"{p}.issues")
        if not issues_raw:
            raise SnapshotFormatError(f"券 {cid!r} 至少要有一条发放记录", f"{p}.issues")
        issues: List[Issue] = []
        sources: set = set()
        for j, irow in enumerate(issues_raw):
            ip = f"{p}.issues[{j}]"
            _require_type(irow, dict, "发放记录", ip)
            for key in ("source", "version", "spec"):
                if key not in irow:
                    raise SnapshotFormatError(f"缺少字段 {key!r}", f"{ip}.{key}")
            source = _require_str(irow["source"], "来源", f"{ip}.source")
            if source in sources:
                raise SnapshotFormatError(
                    f"券 {cid!r} 中来源 {source!r} 重复", f"{ip}.source"
                )
            sources.add(source)
            version = _nonneg_int(irow["version"], "版次", f"{ip}.version")
            spec = _parse_spec(irow["spec"], f"{ip}.spec", seen_cats)
            if spec.coupon_id != cid:
                raise SnapshotFormatError(
                    f"发放内券标识 {spec.coupon_id!r} 与聚合标识 {cid!r} 不一致",
                    f"{ip}.spec.coupon_id",
                )
            issues.append(Issue(source=source, version=version, spec=spec))
        issues.sort(key=lambda x: (x.source, x.version))

        sigs = {spec_signature(i.spec) for i in issues}
        crow = row.get("conflict")
        conflict = None
        if crow is not None:
            _require_type(crow, dict, "冲突记录", f"{p}.conflict")
            if "created_at_seq" not in crow:
                raise SnapshotFormatError("缺少字段 'created_at_seq'", f"{p}.conflict.created_at_seq")
            seq = _nonneg_int(crow["created_at_seq"], "冲突序号", f"{p}.conflict.created_at_seq")
            max_seq = max(max_seq, seq)
            resolved_source = crow.get("resolved_source")
            if resolved_source is not None:
                resolved_source = _require_str(
                    resolved_source, "裁决来源", f"{p}.conflict.resolved_source"
                )
                if resolved_source not in sources:
                    raise SnapshotFormatError(
                        f"裁决来源 {resolved_source!r} 不在发放来源中", f"{p}.conflict.resolved_source"
                    )
            conflict = ConflictRecord(
                coupon_id=cid, issues=tuple(issues), created_at_seq=seq, resolved_source=resolved_source
            )

        # 状态与发放/冲突的自洽性复核。
        if len(sigs) == 1:
            if status is not CouponStatus.SINGLE:
                raise SnapshotFormatError(
                    f"券 {cid!r} 各来源参数一致，状态应为 single，实际为 {status_value}", f"{p}.status"
                )
            if conflict is not None:
                raise SnapshotFormatError(
                    f"券 {cid!r} 参数一致却带有冲突记录，互斥/冲突状态不自洽", f"{p}.conflict"
                )
        else:
            if conflict is None:
                raise SnapshotFormatError(
                    f"券 {cid!r} 多来源参数矛盾却缺少冲突记录", f"{p}.conflict"
                )
            if status is CouponStatus.SINGLE:
                raise SnapshotFormatError(
                    f"券 {cid!r} 参数矛盾，状态不能为 single", f"{p}.status"
                )
            if status is CouponStatus.RESOLVED and conflict.resolved_source is None:
                raise SnapshotFormatError(
                    f"券 {cid!r} 状态为 resolved 却没有裁决来源", f"{p}.conflict.resolved_source"
                )
            if status is CouponStatus.CONFLICTED and conflict.resolved_source is not None:
                raise SnapshotFormatError(
                    f"券 {cid!r} 状态为 conflicted 却带有裁决来源", f"{p}.status"
                )

        engine._coupons[cid] = Coupon(
            coupon_id=cid, issues=tuple(issues), status=status, conflict=conflict
        )

    seq = _nonneg_int(payload["conflict_seq"], "冲突序号计数", "conflict_seq")
    if seq < max_seq:
        raise SnapshotFormatError(
            f"conflict_seq={seq} 小于已用最大冲突序号 {max_seq}，不自洽", "conflict_seq"
        )
    engine._conflict_seq = seq

    # --- 求解结果复核（若有）---
    if "result" in payload:
        _verify_result(engine, payload["result"])
        engine.solve()  # 填充分量缓存，载入后行为与会话内求解完全一致
    return engine


def _verify_result(engine: "SettlementEngine", result_raw: Any) -> None:  # noqa: F821
    p = "result"
    _require_type(result_raw, dict, "求解结果", p)
    for key in ("applications", "total_discount_cents", "fingerprint", "order_fingerprint", "coupon_fingerprint"):
        if key not in result_raw:
            raise SnapshotFormatError(f"求解结果缺少字段 {key!r}", f"{p}.{key}")

    recomputed = engine.solve()

    if result_raw["order_fingerprint"] != recomputed.order_fingerprint:
        raise SnapshotFormatError(
            "存储的订单指纹与按订单行重算结果不一致，快照可能已损坏", f"{p}.order_fingerprint"
        )
    if result_raw["coupon_fingerprint"] != recomputed.coupon_fingerprint:
        raise SnapshotFormatError(
            "存储的券面指纹与按券/冲突重算结果不一致，快照可能已损坏", f"{p}.coupon_fingerprint"
        )
    if result_raw["fingerprint"] != recomputed.fingerprint:
        raise SnapshotFormatError(
            "存储的求解结果指纹与重新求解结果不一致，快照可能已损坏", f"{p}.fingerprint"
        )

    stored_total = _require_type(
        result_raw["total_discount_cents"], int, "总优惠", f"{p}.total_discount_cents"
    )
    if isinstance(stored_total, bool) or stored_total < 0:
        raise SnapshotFormatError("总优惠必须是非负整数", f"{p}.total_discount_cents")
    if stored_total != recomputed.total_discount_cents:
        raise SnapshotFormatError(
            f"存储总优惠 {stored_total} 与重算 {recomputed.total_discount_cents} 不一致",
            f"{p}.total_discount_cents",
        )

    apps_raw = _require_type(result_raw["applications"], list, "中选方案", f"{p}.applications")
    stored_apps = {}
    for i, a in enumerate(apps_raw):
        ap = f"{p}.applications[{i}]"
        _require_type(a, dict, "中选券方案", ap)
        for key in ("coupon_id", "allocations", "total_discount_cents"):
            if key not in a:
                raise SnapshotFormatError(f"缺少字段 {key!r}", f"{ap}.{key}")
        aid = _require_str(a["coupon_id"], "券标识", f"{ap}.coupon_id")
        if aid in stored_apps:
            raise SnapshotFormatError(f"中选券 {aid!r} 重复出现", f"{ap}.coupon_id")
        allocs = _require_type(a["allocations"], list, "逐行抵扣", f"{ap}.allocations")
        norm = []
        seen_lines: set = set()
        for j, pair in enumerate(allocs):
            lp = f"{ap}.allocations[{j}]"
            _require_type(pair, list, "抵扣对", lp)
            if len(pair) != 2:
                raise SnapshotFormatError("抵扣对必须是 [行标识, 抵扣分] 两元素", lp)
            lid = _require_str(pair[0], "行标识", f"{lp}[0]")
            amt = _require_type(pair[1], int, "抵扣分", f"{lp}[1]")
            if isinstance(amt, bool) or amt < 0:
                raise SnapshotFormatError("抵扣分必须是非负整数", f"{lp}[1]")
            if lid in seen_lines:
                raise SnapshotFormatError(f"行 {lid!r} 在同一方案中被重复抵扣", lp)
            seen_lines.add(lid)
            norm.append((lid, amt))
        total = _require_type(a["total_discount_cents"], int, "券抵扣合计", f"{ap}.total_discount_cents")
        if total != sum(amt for _, amt in norm):
            raise SnapshotFormatError("券抵扣合计与逐行抵扣之和不符", f"{ap}.total_discount_cents")
        stored_apps[aid] = (tuple(sorted(norm)), total)

    fresh_apps = {
        a.coupon_id: (
            tuple(sorted((x.line_id, x.amount_cents) for x in a.allocations)),
            a.total_discount_cents,
        )
        for a in recomputed.applications
    }
    if set(stored_apps) != set(fresh_apps) or any(stored_apps[k] != fresh_apps[k] for k in stored_apps):
        raise SnapshotFormatError(
            "存储的逐行抵扣方案与重新求解结果不一致", f"{p}.applications"
        )

    # 未选候选（券 + 原因码）与冻结集合也必须能由当前状态复算得到。
    if "rejected" in result_raw:
        stored_rej = _require_type(result_raw["rejected"], list, "未选候选说明", f"{p}.rejected")
        fresh_rej = sorted((r.coupon_id, r.reason_code) for r in recomputed.rejected)
        norm_stored = []
        for i, r in enumerate(stored_rej):
            _require_type(r, dict, "未选候选说明", f"{p}.rejected[{i}]")
            if "coupon_id" not in r or "reason_code" not in r:
                raise SnapshotFormatError("未选候选缺少 coupon_id/reason_code", f"{p}.rejected[{i}]")
            norm_stored.append((str(r["coupon_id"]), str(r["reason_code"])))
        norm_stored.sort()
        if norm_stored != fresh_rej:
            raise SnapshotFormatError(
                "存储的未选候选原因与重新求解结果不一致", f"{p}.rejected"
            )

    stored_frozen = sorted(result_raw.get("frozen_coupon_ids", []))
    if stored_frozen != list(recomputed.frozen_coupon_ids):
        raise SnapshotFormatError("冻结券集合与重新求解结果不一致", f"{p}.frozen_coupon_ids")
    stored_eligible = sorted(result_raw.get("eligible_coupon_ids", []))
    if stored_eligible != list(recomputed.eligible_coupon_ids):
        raise SnapshotFormatError("候选券集合与重新求解结果不一致", f"{p}.eligible_coupon_ids")

    # 指纹一致已经是强校验；再防止指纹字段本身被照抄而内容偷换。
    # 结构必须与 SettlementEngine.solve 中 result_fp 的构造逐字节一致。
    expect_fp = fingerprint(
        "result",
        [
            "result",
            recomputed.order_fingerprint,
            recomputed.coupon_fingerprint,
            [
                [cid, total, [[lid, amt] for lid, amt in allocs]]
                for cid, (allocs, total) in sorted(stored_apps.items())
            ],
            stored_total,
        ],
    )
    if expect_fp != result_raw["fingerprint"]:
        raise SnapshotFormatError("结果指纹无法由存储内容复算得到", f"{p}.fingerprint")


def load_snapshot(path: str) -> "SettlementEngine":  # noqa: F821
    """从快照载入为一个**新**引擎；任何损坏都在抛错前不影响其他对象。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError as exc:
        raise SnapshotFormatError(f"无法读取快照文件: {exc}", path) from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SnapshotFormatError(f"快照不是合法 JSON：{exc.msg}（第 {exc.lineno} 行第 {exc.colno} 列）", path) from exc
    return _build_engine_from_payload(payload)


def load_into(engine: "SettlementEngine", path: str) -> "SettlementEngine":  # noqa: F821
    """把快照载入到**既有**引擎：先在临时引擎上全部校验通过，再整体替换状态。

    失败时原引擎状态逐字段不变。
    """
    candidate = load_snapshot(path)
    # 只有走到这里（全部校验与重算通过）才整体替换内部状态；失败时原引擎不动。
    engine._replace_state(candidate)
    return engine
