"""状态导出与载入（仅标准库 json）。

导出格式为单一 JSON 对象，顶层固定带 ``format_version``。载入分两阶段：

1. **结构校验**：检查 JSON 结构、必填键、基本类型；任何不符抛
   :class:`~device_config.errors.CorruptStateError`，错误中带 JSON 路径。
2. **语义登记**：在一个全新的临时内核里依次登记设备、字段、迁移规则、配置，
   复用内核全部登记校验（标识唯一、版本合法、规则无环、引用字段存在等）；
   随后重算每条适配记录并与存档逐字节比对。

载入始终返回一个**新建内核**，任何阶段失败都不会触碰调用方已有的内核对象，
因此失败后旧状态保持不变。
"""

from __future__ import annotations

import json

from .errors import CorruptStateError, KernelError, VersionError
from .kernel import ConfigKernel

FORMAT_VERSION = "dc-state/1"


# ---------------------------------------------------------------------------
# 导出
# ---------------------------------------------------------------------------


def export_state(kernel: ConfigKernel):
    """把内核全部状态导出为可 JSON 序列化的 dict（键排序，结果确定）。"""
    return {
        "format_version": FORMAT_VERSION,
        "devices": [d.to_dict() for d in kernel.list_devices()],
        "fields": [f.to_dict() for f in kernel.list_fields()],
        "migration_rules": [r.to_dict() for r in kernel.list_migration_rules()],
        "configs": [
            {
                "config_id": c["config_id"],
                "version": c["version"],
                "values": {k: c["values"][k] for k in sorted(c["values"])},
            }
            for c in kernel.list_configs()
        ],
        "adaptations": [
            _export_record(rec) for rec in kernel.list_adaptations()
        ],
    }


def _export_record(record):
    return {
        "record_id": record["record_id"],
        "config_id": record["config_id"],
        "device_id": record["device_id"],
        "config_version": record["config_version"],
        "target_firmware": record["target_firmware"],
        "migration_path": record["migration_path"],
        "effective_config": record["effective_config"],
        "decisions": record["decisions"],
    }


def dump_json(kernel: ConfigKernel, *, indent=2):
    """导出为 JSON 字符串。相同状态永远产出逐字符相同的文本。"""
    return json.dumps(
        export_state(kernel),
        ensure_ascii=False,
        sort_keys=True,
        indent=indent,
        separators=(",", ": ") if indent is not None else (",", ":"),
    )


# ---------------------------------------------------------------------------
# 载入
# ---------------------------------------------------------------------------


def import_state(state) -> ConfigKernel:
    """从 dict 载入状态，返回新内核。任何校验失败都抛错且不产生副作用。"""
    _check_type(state, dict, "$", "状态根对象")
    if state.get("format_version") != FORMAT_VERSION:
        raise CorruptStateError(
            f"$.format_version 不匹配：期望 {FORMAT_VERSION!r}，"
            f"实际 {state.get('format_version')!r}"
        )

    # 五个顶层段必须存在（允许为空列表，但不允许缺字段）
    for key in ("devices", "fields", "migration_rules", "configs", "adaptations"):
        if key not in state:
            raise CorruptStateError(f"$ 缺少顶层字段 {key!r}")

    devices = _check_type(state["devices"], list, "$.devices", "设备列表")
    fields = _check_type(state["fields"], list, "$.fields", "字段定义列表")
    rules = _check_type(
        state["migration_rules"], list, "$.migration_rules", "迁移规则列表"
    )
    configs = _check_type(state["configs"], list, "$.configs", "配置列表")
    records = _check_type(
        state["adaptations"], list, "$.adaptations", "适配记录列表"
    )

    _validate_devices(devices)
    _validate_fields(fields)
    _validate_rules(rules)
    _validate_configs(configs)
    _validate_records(records)

    # 语义阶段：全部登记发生在临时内核上，失败即随临时内核一起丢弃。
    # 结构校验通过后出现的任何领域错误都包装为 CorruptStateError，
    # 保证调用方只需区分"数据损坏"这一类载入失败。
    try:
        kernel = ConfigKernel()
        for d in devices:
            kernel.register_device(
                d["device_id"], d["model"], d["firmware"], list(d["capabilities"])
            )
        for f in fields:
            kernel.register_field(
                f["name"],
                f["type"],
                f["introduced_in"],
                required=f.get("required", True),
                default=f.get("default"),
                has_default=("default" in f),
                required_capabilities=list(f.get("required_capabilities", [])),
            )
        for r in rules:
            kernel.register_migration_rule(
                r["from_version"],
                r["to_version"],
                renames=[(pair["from"], pair["to"]) for pair in r["renames"]],
                type_changes=[
                    (pair["field"], pair["to_type"]) for pair in r["type_changes"]
                ],
            )
        for c in configs:
            kernel.register_config(c["config_id"], c["version"], dict(c["values"]))

        # 重算每条适配记录，与存档逐条比对（含 record_id），确保存档未被篡改或丢失语义
        for rec in records:
            recomputed = kernel.adapt(rec["config_id"], rec["device_id"])
            stored = _export_record(rec)
            if stored != _export_record(recomputed):
                raise CorruptStateError(
                    f"适配记录 {rec.get('record_id')!r} 的存档与重算结果不一致，"
                    "存档可能已损坏"
                )
    except (CorruptStateError, VersionError):
        # 版本号错误自带位置信息，直接透传以保留精确类型
        raise
    except KernelError as exc:
        raise CorruptStateError(f"存档语义校验失败：{exc}") from exc

    return kernel


def load_json(text) -> ConfigKernel:
    """从 JSON 字符串载入状态。"""
    if isinstance(text, (bytes, bytearray)):
        text = text.decode("utf-8")
    if not isinstance(text, str):
        raise CorruptStateError("载入内容必须是 JSON 字符串")
    try:
        state = json.loads(text)
    except json.JSONDecodeError as exc:
        raise CorruptStateError(
            f"JSON 解析失败（行 {exc.lineno} 列 {exc.colno}）：{exc.msg}"
        ) from exc
    return import_state(state)


# ---------------------------------------------------------------------------
# 结构校验
# ---------------------------------------------------------------------------


def _check_type(value, expected, path, label):
    # bool 是 int 的子类型，需要区分
    if expected is int:
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif expected is str:
        ok = isinstance(value, str) and value != ""
    else:
        ok = isinstance(value, expected)
    if not ok:
        raise CorruptStateError(
            f"{path} 处的{label}类型错误：期望 {expected.__name__}，"
            f"实际 {type(value).__name__}"
        )
    return value


def _check_keys(obj, required, path):
    for key in required:
        if key not in obj:
            raise CorruptStateError(f"{path} 缺少必填字段 {key!r}")


def _validate_devices(devices):
    seen = set()
    for i, d in enumerate(devices):
        path = f"$.devices[{i}]"
        _check_type(d, dict, path, "设备")
        _check_keys(d, ("device_id", "model", "firmware", "capabilities"), path)
        _check_type(d["device_id"], str, f"{path}.device_id", "设备标识")
        _check_type(d["model"], str, f"{path}.model", "型号")
        _check_type(d["firmware"], str, f"{path}.firmware", "固件版本")
        _check_type(d["capabilities"], list, f"{path}.capabilities", "能力标签集合")
        for j, cap in enumerate(d["capabilities"]):
            _check_type(cap, str, f"{path}.capabilities[{j}]", "能力标签")
        if d["device_id"] in seen:
            raise CorruptStateError(f"{path} 设备标识 {d['device_id']!r} 重复")
        seen.add(d["device_id"])


def _validate_fields(fields):
    seen = set()
    allowed_types = {"int", "float", "bool", "string"}
    for i, f in enumerate(fields):
        path = f"$.fields[{i}]"
        _check_type(f, dict, path, "字段定义")
        _check_keys(f, ("name", "type", "introduced_in"), path)
        _check_type(f["name"], str, f"{path}.name", "字段名")
        _check_type(f["type"], str, f"{path}.type", "字段类型")
        if f["type"] not in allowed_types:
            raise CorruptStateError(
                f"{path}.type 非法：{f['type']!r}，允许 {sorted(allowed_types)}"
            )
        _check_type(
            f["introduced_in"], str, f"{path}.introduced_in", "引入版本"
        )
        if "required" in f and not isinstance(f["required"], bool):
            raise CorruptStateError(f"{path}.required 必须是布尔值")
        if "required_capabilities" in f:
            caps = f["required_capabilities"]
            _check_type(caps, list, f"{path}.required_capabilities", "能力要求")
            for j, cap in enumerate(caps):
                _check_type(
                    cap, str, f"{path}.required_capabilities[{j}]", "能力标签"
                )
        if f["name"] in seen:
            raise CorruptStateError(f"{path} 字段名 {f['name']!r} 重复定义")
        seen.add(f["name"])


def _validate_rules(rules):
    seen_from = set()
    for i, r in enumerate(rules):
        path = f"$.migration_rules[{i}]"
        _check_type(r, dict, path, "迁移规则")
        _check_keys(r, ("from_version", "to_version", "renames", "type_changes"), path)
        _check_type(r["from_version"], str, f"{path}.from_version", "起始版本")
        _check_type(r["to_version"], str, f"{path}.to_version", "目标版本")
        _check_type(r["renames"], list, f"{path}.renames", "改名列表")
        _check_type(r["type_changes"], list, f"{path}.type_changes", "类型变更列表")
        if r["from_version"] in seen_from:
            raise CorruptStateError(
                f"{path} 起始版本 {r['from_version']!r} 存在多条迁出规则（分叉）"
            )
        seen_from.add(r["from_version"])
        for j, pair in enumerate(r["renames"]):
            ppath = f"{path}.renames[{j}]"
            _check_type(pair, dict, ppath, "改名项")
            _check_keys(pair, ("from", "to"), ppath)
            _check_type(pair["from"], str, f"{ppath}.from", "旧字段名")
            _check_type(pair["to"], str, f"{ppath}.to", "新字段名")
        for j, pair in enumerate(r["type_changes"]):
            ppath = f"{path}.type_changes[{j}]"
            _check_type(pair, dict, ppath, "类型变更项")
            _check_keys(pair, ("field", "to_type"), ppath)
            _check_type(pair["field"], str, f"{ppath}.field", "字段名")
            _check_type(pair["to_type"], str, f"{ppath}.to_type", "目标类型")


def _validate_configs(configs):
    seen = set()
    for i, c in enumerate(configs):
        path = f"$.configs[{i}]"
        _check_type(c, dict, path, "配置")
        _check_keys(c, ("config_id", "version", "values"), path)
        _check_type(c["config_id"], str, f"{path}.config_id", "配置标识")
        _check_type(c["version"], str, f"{path}.version", "配置版本")
        _check_type(c["values"], dict, f"{path}.values", "字段集合")
        for key in c["values"]:
            if not isinstance(key, str) or not key:
                raise CorruptStateError(f"{path}.values 中存在非法字段名 {key!r}")
        if c["config_id"] in seen:
            raise CorruptStateError(f"{path} 配置标识 {c['config_id']!r} 重复")
        seen.add(c["config_id"])


def _validate_records(records):
    required = (
        "record_id",
        "config_id",
        "device_id",
        "config_version",
        "target_firmware",
        "migration_path",
        "effective_config",
        "decisions",
    )
    seen = set()
    for i, rec in enumerate(records):
        path = f"$.adaptations[{i}]"
        _check_type(rec, dict, path, "适配记录")
        _check_keys(rec, required, path)
        _check_type(rec["record_id"], str, f"{path}.record_id", "记录标识")
        _check_type(rec["config_id"], str, f"{path}.config_id", "配置标识")
        _check_type(rec["device_id"], str, f"{path}.device_id", "设备标识")
        _check_type(
            rec["config_version"], str, f"{path}.config_version", "配置版本"
        )
        _check_type(
            rec["target_firmware"], str, f"{path}.target_firmware", "固件版本"
        )
        _check_type(
            rec["migration_path"], list, f"{path}.migration_path", "迁移路径"
        )
        _check_type(
            rec["effective_config"], dict, f"{path}.effective_config", "生效配置"
        )
        _check_type(rec["decisions"], list, f"{path}.decisions", "取舍记录")
        if rec["record_id"] in seen:
            raise CorruptStateError(f"{path} 适配记录标识 {rec['record_id']!r} 重复")
        seen.add(rec["record_id"])
        for j, d in enumerate(rec["decisions"]):
            dpath = f"{path}.decisions[{j}]"
            _check_type(d, dict, dpath, "取舍项")
            _check_keys(
                d, ("field", "kept", "reason", "detail", "source", "value"), dpath
            )
            _check_type(d["field"], str, f"{dpath}.field", "字段名")
            if not isinstance(d["kept"], bool):
                raise CorruptStateError(f"{dpath}.kept 必须是布尔值")
            _check_type(d["reason"], str, f"{dpath}.reason", "裁剪原因")
            _check_type(d["detail"], str, f"{dpath}.detail", "原因说明")
            _check_type(d["source"], str, f"{dpath}.source", "取值来源")
