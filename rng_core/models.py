"""实验模型与声明期校验。

所有"非法配置"在注册/载入阶段就被拒绝，错误带有精确定位路径，例如::

    experiments[3].steps[2].draws[1].count: 必须为正整数，得到 -2
    experiments[0].steps[1].params.p: 引用了不存在的参数 $params.missing
    experiments[0].steps[3]: 引用了后续步骤 $steps.b（步骤只能引用更早的步骤）

引用语法
--------
* ``$params.<参数名>``        实验参数
* ``$seed``                    当前运行使用的种子（整数）
* ``$steps.<步骤id>.<字段>``   更早步骤的输出字段（不写字段则取整个输出对象）

步骤按列表顺序编号，只能引用编号更早的步骤，因此依赖图始终是 DAG。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

_ID_RE = re.compile(r"^[A-Za-z0-9_\-.]+$")
REF_RE = re.compile(r"^\$[A-Za-z_][A-Za-z0-9_.]*$")

PARAM_TYPES = ("int", "float", "bool", "string", "enum")


class ValidationError(ValueError):
    """带定位路径的配置错误。``path`` 为定位片段列表。"""

    def __init__(self, message: str, path: Optional[List[str]] = None):
        self.path = list(path or [])
        loc = ".".join(self.path) if self.path else "<root>"
        super().__init__(f"{loc}: {message}" if self.path else message)


def _is_ref(v: Any) -> bool:
    return isinstance(v, str) and v.startswith("$")


# --------------------------------------------------------------------------- #
# 规格数据类
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ParamSpec:
    name: str
    ptype: str
    required: bool = True
    default: Any = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    choices: Optional[List[Any]] = None
    description: str = ""


@dataclass(frozen=True)
class DrawSpec:
    """步骤消耗的一类随机量的声明。

    count 可以是正整数，也可以是 ``$params.n`` 形式的引用（运行时解析为正整数）。
    draw_params 是该随机类型的分布参数（uniform 的 low/high 等），同样支持引用。
    """

    rtype: str
    count: Any
    draw_id: str = "main"
    draw_params: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrySpec:
    max_attempts: int = 1          # 含首次执行；1 表示不重试
    retry_on: Tuple[str, ...] = ("value_error", "overflow")


@dataclass(frozen=True)
class StepSpec:
    sid: str
    handler: str
    draws: Tuple[DrawSpec, ...] = ()
    params: Dict[str, Any] = field(default_factory=dict)
    retry: RetrySpec = RetrySpec()
    # 显式依赖的步骤 id；即使输出未被引用也可声明（用于并行分层）。
    depends_on: Tuple[str, ...] = ()


@dataclass(frozen=True)
class SeedPolicy:
    mode: str                      # fixed | list | derive
    values: Tuple[int, ...] = ()
    base: int = 0
    count: int = 1

    def seeds(self, experiment_id: str) -> List[int]:
        if self.mode == "fixed":
            return [self.base]
        if self.mode == "list":
            return list(self.values)
        # derive：由 (实验id, base, i) 确定性派生，排序稳定、与机器无关。
        import hashlib
        out = []
        for i in range(self.count):
            h = hashlib.sha256(
                f"seed|{experiment_id}|base={self.base}|i={i}".encode("utf-8")
            ).digest()
            import struct
            out.append(self.base + struct.unpack("<I", h[:4])[0])
        return sorted(set(out))


@dataclass(frozen=True)
class ExperimentSpec:
    eid: str
    params: Tuple[ParamSpec, ...]
    steps: Tuple[StepSpec, ...]
    seed_policy: SeedPolicy
    source: str = "default"
    description: str = ""


# --------------------------------------------------------------------------- #
# 解析与校验
# --------------------------------------------------------------------------- #

def _require(mapping: Dict[str, Any], key: str, path: List[str], typ: type = str):
    if key not in mapping:
        raise ValidationError(f"缺少必填字段 {key!r}", path)
    val = mapping[key]
    if not isinstance(val, typ):
        name = typ.__name__ if isinstance(typ, type) else str(typ)
        raise ValidationError(f"字段 {key!r} 应为 {name}，得到 {type(val).__name__}", path)
    return val


def _check_id(value: str, what: str, path: List[str]) -> str:
    if not isinstance(value, str) or not value:
        raise ValidationError(f"{what}必须是非空字符串", path)
    if not _ID_RE.match(value):
        raise ValidationError(
            f"{what} {value!r} 只能包含字母、数字、下划线、短横线、点", path
        )
    return value


def parse_param(raw: Dict[str, Any], path: List[str]) -> ParamSpec:
    name = _require(raw, "name", path)
    _check_id(name, "参数名", path)
    ptype = _require(raw, "type", path)
    if ptype not in PARAM_TYPES:
        raise ValidationError(
            f"参数类型 {ptype!r} 不支持，可选：{', '.join(PARAM_TYPES)}", path
        )
    kwargs: Dict[str, Any] = {
        "description": raw.get("description", ""),
        "min_value": raw.get("min"),
        "max_value": raw.get("max"),
        "choices": tuple(raw["choices"]) if raw.get("choices") is not None else None,
    }
    required = bool(raw.get("required", "default" not in raw))
    kwargs["required"] = required
    kwargs["default"] = raw.get("default")
    spec = ParamSpec(name=name, ptype=ptype, **kwargs)
    if spec.choices is not None and not spec.choices:
        raise ValidationError("choices 不能为空列表", path)
    if spec.min_value is not None and spec.max_value is not None \
            and spec.max_value < spec.min_value:
        raise ValidationError(f"min {spec.min_value} 大于 max {spec.max_value}", path)
    if spec.default is not None and not _is_ref(spec.default):
        validate_param_value(spec, spec.default, path + ["default"])
    return spec


def coerce_param_value(spec: ParamSpec, value: Any, path: List[str]) -> Any:
    if spec.ptype == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationError(f"参数 {spec.name!r} 需要 int，得到 {type(value).__name__}", path)
        return value
    if spec.ptype == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError(f"参数 {spec.name!r} 需要数值，得到 {type(value).__name__}", path)
        return float(value)
    if spec.ptype == "bool":
        if not isinstance(value, bool):
            raise ValidationError(f"参数 {spec.name!r} 需要 bool，得到 {type(value).__name__}", path)
        return value
    if spec.ptype in ("string", "enum"):
        if not isinstance(value, str):
            raise ValidationError(f"参数 {spec.name!r} 需要字符串，得到 {type(value).__name__}", path)
        return value
    raise ValidationError(f"未知参数类型 {spec.ptype}", path)  # pragma: no cover


def validate_param_value(spec: ParamSpec, value: Any, path: List[str]) -> Any:
    """运行期参数校验（值已经解析为具体字面量、不再是引用）。"""
    value = coerce_param_value(spec, value, path)
    if spec.choices is not None and value not in spec.choices:
        raise ValidationError(
            f"参数 {spec.name!r}={value!r} 不在允许值 {list(spec.choices)} 中", path
        )
    if spec.ptype in ("int", "float"):
        if spec.min_value is not None and value < spec.min_value:
            raise ValidationError(
                f"参数 {spec.name!r}={value} 小于下限 {spec.min_value}", path
            )
        if spec.max_value is not None and value > spec.max_value:
            raise ValidationError(
                f"参数 {spec.name!r}={value} 大于上限 {spec.max_value}", path
            )
    return value


def parse_draw(raw: Dict[str, Any], path: List[str]) -> DrawSpec:
    from .rng import normalize_type, SUPPORTED_TYPES

    rtype = _require(raw, "type", path)
    try:
        rtype = normalize_type(rtype)
    except Exception as exc:  # 统一成带路径的 ValidationError
        raise ValidationError(str(exc), path) from None
    if "count" not in raw:
        raise ValidationError("缺少必填字段 'count'", path)
    count = raw["count"]
    if isinstance(count, bool) or (not isinstance(count, int) and not _is_ref(count)):
        raise ValidationError(f"count 必须为正整数或参数引用，得到 {count!r}", path)
    if isinstance(count, int) and count < 1:
        raise ValidationError(f"count 必须为正整数，得到 {count}", path)
    draw_id = str(raw.get("id", "main"))
    _check_id(draw_id, "抽签id", path)
    draw_params = dict(raw.get("params", {}))
    # 分布参数的静态检查：字面值立刻检查，引用留给运行期。
    for k, v in draw_params.items():
        if _is_ref(v):
            continue
        try:
            if rtype == "bernoulli" and k == "p" and not 0.0 <= float(v) <= 1.0:
                raise ValueError(f"p={v} 超出 [0,1]")
            if rtype == "gaussian" and k == "sigma" and float(v) < 0:
                raise ValueError(f"sigma={v} 不能为负")
            if k in ("low", "high", "mu", "sigma", "p"):
                float(v)
            if rtype == "integer" and k in ("low", "high"):
                if isinstance(v, bool) or not isinstance(v, int):
                    raise ValueError("integer 的 low/high 必须是整数")
        except (TypeError, ValueError) as exc:
            raise ValidationError(f"分布参数 {k}={v!r} 非法：{exc}", path) from None
    if rtype != "uniform" and any(k in draw_params for k in ("low", "high")) and rtype != "integer":
        raise ValidationError(f"{rtype} 不接受 low/high 参数", path)
    return DrawSpec(rtype=rtype, count=count, draw_id=draw_id,
                    draw_params=draw_params)


def parse_step(raw: Dict[str, Any], index: int) -> StepSpec:
    path = ["steps", f"[{index}]"]
    sid = _require(raw, "id", path)
    _check_id(sid, "步骤id", path)
    handler = _require(raw, "handler", path)

    draws: List[DrawSpec] = []
    seen_draw_ids: set = set()
    for j, draw_raw in enumerate(raw.get("draws", [])):
        if not isinstance(draw_raw, dict):
            raise ValidationError("抽签声明必须是对象", path + ["draws", f"[{j}]"])
        ds = parse_draw(draw_raw, path + ["draws", f"[{j}]"])
        if ds.draw_id in seen_draw_ids:
            raise ValidationError(f"抽签id {ds.draw_id!r} 在同一步骤内重复",
                                  path + ["draws", f"[{j}]"])
        seen_draw_ids.add(ds.draw_id)
        draws.append(ds)

    sparams = dict(raw.get("params", {}))
    retry_raw = raw.get("retry", {}) or {}
    max_attempts = int(retry_raw.get("max_attempts", 1))
    if max_attempts < 1:
        raise ValidationError(f"retry.max_attempts 必须 >= 1，得到 {max_attempts}",
                              path + ["retry"])
    retry_on = tuple(retry_raw.get("retry_on", ("value_error", "overflow")))
    depends_on = tuple(raw.get("depends_on", ()))

    return StepSpec(
        sid=sid, handler=handler, draws=tuple(draws), params=sparams,
        retry=RetrySpec(max_attempts, retry_on), depends_on=depends_on,
    )


def parse_seed_policy(raw: Dict[str, Any], path: List[str]) -> SeedPolicy:
    mode = _require(raw, "mode", path)
    if mode not in ("fixed", "list", "derive"):
        raise ValidationError(
            f"种子策略 mode 必须是 fixed|list|derive，得到 {mode!r}", path
        )
    if mode == "fixed":
        if "seed" not in raw:
            raise ValidationError("fixed 模式需要 'seed' 字段", path)
        seed = raw["seed"]
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValidationError("seed 必须是整数", path)
        return SeedPolicy(mode="fixed", base=seed)
    if mode == "list":
        values = raw.get("seeds")
        if not isinstance(values, list) or not values:
            raise ValidationError("list 模式需要非空 'seeds' 整数列表", path)
        for i, v in enumerate(values):
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValidationError(f"种子必须是整数，得到 {v!r}", path + ["seeds", f"[{i}]"])
        if len(set(values)) != len(values):
            raise ValidationError("seeds 中存在重复种子", path)
        return SeedPolicy(mode="list", values=tuple(values))
    base = int(raw.get("base_seed", 0))
    count = int(raw.get("count", 1))
    if count < 1:
        raise ValidationError(f"derive.count 必须 >= 1，得到 {count}", path)
    return SeedPolicy(mode="derive", base=base, count=count)


def parse_experiment(raw: Dict[str, Any], path: Optional[List[str]] = None) -> ExperimentSpec:
    path = path or []
    eid = _require(raw, "id", path)
    _check_id(eid, "实验id", path)

    params: List[ParamSpec] = []
    seen_params: set = set()
    for i, praw in enumerate(raw.get("params", [])):
        ps = parse_param(praw, path + ["params", f"[{i}]"])
        if ps.name in seen_params:
            raise ValidationError(f"参数名 {ps.name!r} 重复", path + ["params", f"[{i}]"])
        seen_params.add(ps.name)
        params.append(ps)
    param_map = {p.name: p for p in params}

    steps: List[StepSpec] = []
    seen_steps: set = set()
    for i, sraw in enumerate(raw.get("steps", [])):
        if not isinstance(sraw, dict):
            raise ValidationError("步骤声明必须是对象", path + ["steps", f"[{i}]"])
        ss = parse_step(sraw, i)
        if ss.sid in seen_steps:
            raise ValidationError(f"步骤id {ss.sid!r} 重复", path + ["steps", f"[{i}]"])
        seen_steps.add(ss.sid)
        steps.append(ss)
    if not steps:
        raise ValidationError("实验至少需要一个步骤", path + ["steps"])

    # ---- 引用合法性（此处决定"步骤引用不存在的参数要拒绝并指出位置"）----
    step_index = {s.sid: i for i, s in enumerate(steps)}
    for i, ss in enumerate(steps):
        spath = path + ["steps", f"[{i}]"]
        for dep in ss.depends_on:
            if dep not in step_index:
                raise ValidationError(
                    f"depends_on 引用了不存在的步骤 {dep!r}", spath)
            if step_index[dep] >= i:
                raise ValidationError(
                    f"depends_on 引用了后续步骤 ${dep}（步骤只能引用更早的步骤）", spath)
        for pname, pval in ss.params.items():
            if _is_ref(pval):
                _validate_ref(pval, param_map, step_index, i, spath + ["params", pname])
        for j, ds in enumerate(ss.draws):
            if _is_ref(ds.count):
                _validate_ref(ds.count, param_map, step_index, i,
                              spath + ["draws", f"[{j}]", "count"])
            for pk, pv in ds.draw_params.items():
                if _is_ref(pv):
                    _validate_ref(pv, param_map, step_index, i,
                                  spath + ["draws", f"[{j}]", "params", pk])

    policy = parse_seed_policy(_require(raw, "seed_policy", path, dict),
                               path + ["seed_policy"])
    return ExperimentSpec(
        eid=eid, params=tuple(params), steps=tuple(steps),
        seed_policy=policy, source=str(raw.get("source", "default")),
        description=str(raw.get("description", "")),
    )


def _validate_ref(ref: str, param_map: Dict[str, ParamSpec],
                  step_index: Dict[str, int], current_step: int,
                  path: List[str]) -> None:
    if not REF_RE.match(ref):
        raise ValidationError(f"引用 {ref!r} 语法非法（应为 $params.x / $seed / $steps.s.field）", path)
    parts = ref[1:].split(".")
    head = parts[0]
    if head == "params":
        if len(parts) != 2 or parts[1] not in param_map:
            raise ValidationError(f"引用了不存在的参数 {ref}", path)
    elif head == "seed":
        if len(parts) != 1:
            raise ValidationError("$seed 不支持子字段", path)
    elif head == "steps":
        if len(parts) < 2:
            raise ValidationError("$steps 后必须给出步骤id", path)
        target = parts[1]
        if target not in step_index:
            raise ValidationError(f"引用了不存在的步骤 {ref}", path)
        if step_index[target] >= current_step:
            raise ValidationError(
                f"引用了后续步骤 {ref}（步骤只能引用更早的步骤）", path)
    else:
        raise ValidationError(
            f"未知引用根 {head!r}（只支持 $params/$seed/$steps）", path)


# --------------------------------------------------------------------------- #
# 运行期引用解析
# --------------------------------------------------------------------------- #

def resolve_value(token: Any, resolved_params: Dict[str, Any], seed: int,
                  outputs: Dict[str, Any], path: List[str]) -> Any:
    if not _is_ref(token):
        return token
    parts = token[1:].split(".")
    if parts[0] == "params":
        if parts[1] not in resolved_params:
            raise ValidationError(f"参数 {parts[1]!r} 未提供且无默认值", path)
        return resolved_params[parts[1]]
    if parts[0] == "seed":
        return seed
    if parts[0] == "steps":
        val: Any = outputs[parts[1]]
        for key in parts[2:]:
            if not isinstance(val, dict) or key not in val:
                raise ValidationError(
                    f"步骤 {parts[1]!r} 的输出没有字段 {key!r}（引用 {token}）", path)
            val = val[key]
        return val
    raise ValidationError(f"无法解析引用 {token}", path)  # pragma: no cover


# --------------------------------------------------------------------------- #
# 序列化（写入持久化文件的规范形态）
# --------------------------------------------------------------------------- #

def param_to_wire(p: ParamSpec) -> Dict[str, Any]:
    """输出 parse_param 能读回的规范形态（type/min/max，而非内部字段名）。"""
    out: Dict[str, Any] = {"name": p.name, "type": p.ptype}
    if p.description:
        out["description"] = p.description
    if not p.required:
        out["required"] = False
    if p.default is not None:
        out["default"] = p.default
    if p.min_value is not None:
        out["min"] = p.min_value
    if p.max_value is not None:
        out["max"] = p.max_value
    if p.choices is not None:
        out["choices"] = list(p.choices)
    return out


def draw_to_wire(d: DrawSpec) -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": d.rtype, "count": d.count}
    if d.draw_id != "main":
        out["id"] = d.draw_id
    if d.draw_params:
        out["params"] = dict(d.draw_params)
    return out


def step_to_wire(s: StepSpec) -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": s.sid, "handler": s.handler}
    if s.draws:
        out["draws"] = [draw_to_wire(d) for d in s.draws]
    if s.params:
        out["params"] = dict(s.params)
    if s.retry != RetrySpec():
        retry_out: Dict[str, Any] = {}
        if s.retry.max_attempts != 1:
            retry_out["max_attempts"] = s.retry.max_attempts
        if s.retry.retry_on != ("value_error", "overflow"):
            retry_out["retry_on"] = list(s.retry.retry_on)
        out["retry"] = retry_out
    if s.depends_on:
        out["depends_on"] = list(s.depends_on)
    return out


def seed_policy_to_wire(sp: SeedPolicy) -> Dict[str, Any]:
    if sp.mode == "fixed":
        return {"mode": "fixed", "seed": sp.base}
    if sp.mode == "list":
        return {"mode": "list", "seeds": list(sp.values)}
    out = {"mode": "derive", "base_seed": sp.base}
    if sp.count != 1:
        out["count"] = sp.count
    return out


def spec_to_wire(spec: ExperimentSpec) -> Dict[str, Any]:
    return {
        "id": spec.eid,
        "source": spec.source,
        **({"description": spec.description} if spec.description else {}),
        "seed_policy": seed_policy_to_wire(spec.seed_policy),
        "params": [param_to_wire(p) for p in spec.params],
        "steps": [step_to_wire(s) for s in spec.steps],
    }
