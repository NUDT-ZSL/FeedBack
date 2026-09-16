"""数据模型：参数规格、步骤、实验、运行记录、批量汇总、冲突记录。

所有模型都带 ``to_dict`` / ``from_dict``，字段缺失或类型错误时抛
:class:`IntegrityError`（载入路径）或 :class:`ValidationError`（构建路径）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .errors import IntegrityError, ValidationError
from .rng import VALID_KINDS

REF_KEY = "$param"
MODEL_VERSION = 1


def _req(d: Dict[str, Any], key: str, ctx: str) -> Any:
    if key not in d:
        raise IntegrityError(f"{ctx}: 缺少必需字段 {key!r}")
    return d[key]


def _as_type(v: Any, key: str, ctx: str, types: Tuple[type, ...],
             typename: str) -> Any:
    if not isinstance(v, types) or isinstance(v, bool) and int not in types:
        raise IntegrityError(
            f"{ctx}.{key}: 期望 {typename}，实际为 {type(v).__name__}")
    return v


# ---------------------------------------------------------------------------
# 参数
# ---------------------------------------------------------------------------

@dataclass
class ParameterSpec:
    name: str
    kind: str = "float"               # int / float / bool / str
    default: Any = None
    required: bool = True
    min: Optional[float] = None
    max: Optional[float] = None
    choices: Optional[List[Any]] = None
    description: str = ""

    def validate_value(self, value: Any, loc: str
                       ) -> Any:
        """校验并返回规范化后的参数值。"""
        if value is None:
            if self.default is not None or not self.required:
                value = self.default
            else:
                raise ValidationError(f"参数 {self.name!r} 为必填项", loc=loc)
        if self.kind == "int":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationError(
                    f"参数 {self.name!r} 期望 int，实际为 "
                    f"{type(value).__name__} ({value!r})", loc=loc)
        elif self.kind == "float":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValidationError(
                    f"参数 {self.name!r} 期望数值，实际为 "
                    f"{type(value).__name__} ({value!r})", loc=loc)
            value = float(value)
            if math.isnan(value) or math.isinf(value):
                raise ValidationError(
                    f"参数 {self.name!r} 必须是有限数，实际为 {value}",
                    loc=loc)
        elif self.kind == "bool":
            if not isinstance(value, bool):
                raise ValidationError(
                    f"参数 {self.name!r} 期望 bool，实际为 "
                    f"{type(value).__name__}", loc=loc)
        elif self.kind == "str":
            if not isinstance(value, str):
                raise ValidationError(
                    f"参数 {self.name!r} 期望 str，实际为 "
                    f"{type(value).__name__}", loc=loc)
        else:
            raise ValidationError(
                f"参数 {self.name!r} 的类型 {self.kind!r} 非法", loc=loc)
        if self.kind in ("int", "float"):
            if self.min is not None and value < self.min:
                raise ValidationError(
                    f"参数 {self.name!r}={value} 小于最小值 {self.min}",
                    loc=loc)
            if self.max is not None and value > self.max:
                raise ValidationError(
                    f"参数 {self.name!r}={value} 大于最大值 {self.max}",
                    loc=loc)
        if self.choices is not None and value not in self.choices:
            raise ValidationError(
                f"参数 {self.name!r}={value!r} 不在允许集合 "
                f"{list(self.choices)} 中", loc=loc)
        return value

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "kind": self.kind, "default": self.default,
                "required": self.required, "min": self.min, "max": self.max,
                "choices": list(self.choices) if self.choices is not None
                else None, "description": self.description}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "ParameterSpec":
        try:
            return cls(
                name=_as_type(_req(d, "name", ctx), "name", ctx, (str,),
                              "str"),
                kind=d.get("kind", "float"),
                default=d.get("default"),
                required=bool(d.get("required", True)),
                min=d.get("min"), max=d.get("max"),
                choices=list(d["choices"]) if d.get("choices") is not None
                else None,
                description=d.get("description", ""))
        except IntegrityError:
            raise
        except (TypeError, ValueError) as e:
            raise IntegrityError(f"{ctx}: {e}")


# ---------------------------------------------------------------------------
# 步骤与随机切片
# ---------------------------------------------------------------------------

@dataclass
class Slice:
    """步骤声明消耗的一段同类型随机量。"""
    kind: str
    count: int
    draw_params: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"kind": self.kind, "count": self.count,
                "draw_params": dict(self.draw_params)}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "Slice":
        kind = _as_type(_req(d, "kind", ctx), "kind", ctx, (str,), "str")
        count = _req(d, "count", ctx)
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise IntegrityError(f"{ctx}.count: 期望非负 int，实际 {count!r}")
        dp = d.get("draw_params", {})
        if not isinstance(dp, dict):
            raise IntegrityError(f"{ctx}.draw_params: 期望对象")
        return cls(kind=kind, count=count, draw_params=dict(dp))


@dataclass
class Step:
    step_id: str
    fn: str
    params: Dict[str, Any] = field(default_factory=dict)
    slices: List[Slice] = field(default_factory=list)
    retries: Optional[int] = None     # None 时用实验 default_retries
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {"step_id": self.step_id, "fn": self.fn,
                "params": dict(self.params),
                "slices": [s.to_dict() for s in self.slices],
                "retries": self.retries, "description": self.description}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "Step":
        sid = _as_type(_req(d, "step_id", ctx), "step_id", ctx, (str,),
                       "str")
        fn = _as_type(_req(d, "fn", ctx), "fn", ctx, (str,), "str")
        params = d.get("params", {})
        if not isinstance(params, dict):
            raise IntegrityError(f"{ctx}.params: 期望对象")
        slices_raw = d.get("slices", [])
        if not isinstance(slices_raw, list):
            raise IntegrityError(f"{ctx}.slices: 期望数组")
        retries = d.get("retries")
        if retries is not None and (not isinstance(retries, int)
                                    or isinstance(retries, bool)
                                    or retries < 0):
            raise IntegrityError(f"{ctx}.retries: 期望非负 int")
        return cls(step_id=sid, fn=fn, params=dict(params),
                   slices=[Slice.from_dict(
                       s, f"{ctx}.slices[{i}]")
                       for i, s in enumerate(slices_raw)],
                   retries=retries, description=d.get("description", ""))

    def iter_refs(self) -> List[Tuple[str, str]]:
        """返回 (引用的参数名, 位置) 列表。"""
        refs: List[Tuple[str, str]] = []
        for key, val in self.params.items():
            if isinstance(val, dict) and REF_KEY in val:
                name = val[REF_KEY]
                refs.append((name, f"params.{key}"))
        return refs


@dataclass
class LaidSlice:
    """切片在实验全局随机流中的布局。"""
    step_id: str
    slice_index: int
    kind: str
    offset: int
    count: int
    draw_params: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"step_id": self.step_id, "slice_index": self.slice_index,
                "kind": self.kind, "offset": self.offset,
                "count": self.count, "draw_params": dict(self.draw_params)}


# ---------------------------------------------------------------------------
# 实验
# ---------------------------------------------------------------------------

@dataclass
class Experiment:
    experiment_id: str
    param_specs: List[ParameterSpec]
    steps: List[Step]
    values: Dict[str, Any] = field(default_factory=dict)
    seed_policy: Dict[str, Any] = field(default_factory=dict)
    default_retries: int = 0
    source: str = "local"
    description: str = ""
    tags: List[str] = field(default_factory=list)

    # ---- 校验 ----------------------------------------------------------
    def validate(self, fn_names: Optional[Sequence[str]] = None) -> None:
        """对配置做全部检查，一次性抛出所有错误。"""
        errors: List[ValidationError] = []
        where = self.experiment_id or "<unknown experiment>"

        if not self.experiment_id or not isinstance(self.experiment_id, str):
            errors.append(ValidationError("实验标识必须是非空字符串",
                                          loc="experiment.experiment_id",
                                          where=where))
        if not isinstance(self.default_retries, int) \
                or isinstance(self.default_retries, bool) \
                or self.default_retries < 0:
            errors.append(ValidationError(
                f"default_retries 必须是非负整数，实际 "
                f"{self.default_retries!r}", loc="experiment.default_retries",
                where=where))
        self._validate_seed_policy(errors, where)

        names = [p.name for p in self.param_specs]
        if len(names) != len(set(names)):
            dup = sorted({n for n in names if names.count(n) > 1})
            errors.append(ValidationError(
                f"参数名重复: {dup}", loc="experiment.parameters",
                where=where))
        unknown = set(self.values) - set(names)
        for n in sorted(unknown):
            errors.append(ValidationError(
                f"提供了未声明的参数 {n!r}",
                loc=f"experiment.values[{n!r}]", where=where))
        resolved: Dict[str, Any] = {}
        for i, spec in enumerate(self.param_specs):
            try:
                if spec.kind not in ("int", "float", "bool", "str"):
                    raise ValidationError(
                        f"未知参数类型 {spec.kind!r}",
                        loc=f"experiment.parameters[{i}].kind", where=where)
                resolved[spec.name] = spec.validate_value(
                    self.values.get(spec.name),
                    loc=f"experiment.values[{spec.name!r}]")
            except ValidationError as e:
                errors.append(e)

        sids = [s.step_id for s in self.steps]
        if len(sids) != len(set(sids)):
            dup = sorted({n for n in sids if sids.count(n) > 1})
            errors.append(ValidationError(
                f"步骤标识重复: {dup}", loc="experiment.steps", where=where))
        if not self.steps:
            errors.append(ValidationError("实验至少需要一个步骤",
                                          loc="experiment.steps", where=where))
        for i, step in enumerate(self.steps):
            ctx = f"experiment.steps[{i}]({step.step_id!r})"
            if not step.step_id:
                errors.append(ValidationError("步骤标识不能为空",
                                              loc=f"{ctx}.step_id",
                                              where=where))
            for ref_name, sub in step.iter_refs():
                if ref_name not in names:
                    errors.append(ValidationError(
                        f"步骤引用了不存在的参数 {ref_name!r}",
                        loc=f"{ctx}.{sub}.{REF_KEY}", where=where))
            if step.retries is not None and (
                    not isinstance(step.retries, int)
                    or isinstance(step.retries, bool)
                    or step.retries < 0):
                errors.append(ValidationError(
                    f"retries 必须是非负整数，实际 {step.retries!r}",
                    loc=f"{ctx}.retries", where=where))
            for j, sl in enumerate(step.slices):
                if sl.kind not in VALID_KINDS:
                    errors.append(ValidationError(
                        f"未知随机量类型 {sl.kind!r}，允许 {list(VALID_KINDS)}",
                        loc=f"{ctx}.slices[{j}].kind", where=where))
                if not isinstance(sl.count, int) or isinstance(sl.count, bool) \
                        or sl.count < 0:
                    errors.append(ValidationError(
                        f"count 必须是非负整数，实际 {sl.count!r}",
                        loc=f"{ctx}.slices[{j}].count", where=where))
                else:
                    self._check_draw_params(sl, f"{ctx}.slices[{j}]",
                                            where, errors)
            if fn_names is not None and step.fn not in fn_names:
                errors.append(ValidationError(
                    f"步骤引用了未注册的计算函数 {step.fn!r}",
                    loc=f"{ctx}.fn", where=where))

        if errors:
            from .errors import MultiValidationError
            raise MultiValidationError(errors)
        self.values = resolved

    def _validate_seed_policy(self, errors: List[ValidationError],
                              where: str) -> None:
        pol = self.seed_policy or {}
        if not pol:
            return
        t = pol.get("type")
        loc = "experiment.seed_policy"
        if t == "fixed":
            if "seed" not in pol:
                errors.append(ValidationError("fixed 策略需要 seed 字段",
                                              loc=loc, where=where))
        elif t == "sequence":
            seeds = pol.get("seeds")
            if not isinstance(seeds, list) or not seeds:
                errors.append(ValidationError(
                    "sequence 策略需要非空 seeds 数组", loc=loc, where=where))
            elif any(not isinstance(s, int) or isinstance(s, bool) or s < 0
                     for s in seeds):
                errors.append(ValidationError(
                    "seeds 必须是非负整数数组", loc=loc, where=where))
            elif len(set(seeds)) != len(seeds):
                errors.append(ValidationError("seeds 中存在重复种子",
                                              loc=loc, where=where))
        else:
            errors.append(ValidationError(
                f"未知种子策略类型 {t!r}（fixed/sequence）",
                loc=loc, where=where))

    @staticmethod
    def _check_draw_params(sl: Slice, ctx: str, where: str,
                           errors: List[ValidationError]) -> None:
        dp = sl.draw_params
        try:
            if sl.kind == "integer":
                low = int(dp.get("low", 0))
                high = int(dp.get("high", 2**31 - 1))
                if high <= low:
                    raise ValueError(f"需要 high>low，收到 [{low},{high})")
            elif sl.kind == "uniform":
                low = float(dp.get("low", 0.0))
                high = float(dp.get("high", 1.0))
                if not high > low:
                    raise ValueError(f"需要 high>low，收到 [{low},{high}]")
            elif sl.kind == "normal":
                std = float(dp.get("std", 1.0))
                if not (std > 0.0) or math.isinf(std):
                    raise ValueError(f"std 必须是有限正数，收到 {std}")
            elif sl.kind == "bernoulli":
                p = float(dp.get("p", 0.5))
                if not 0.0 <= p <= 1.0:
                    raise ValueError(f"p 必须在 [0,1]，收到 {p}")
        except (TypeError, ValueError) as e:
            errors.append(ValidationError(
                f"切片 {sl.kind!r} 参数非法: {e}",
                loc=f"{ctx}.draw_params", where=where))

    # ---- 随机流布局 ----------------------------------------------------
    def lay_out_stream(self) -> List[LaidSlice]:
        """按步骤顺序把全部切片铺到一条连续随机流上。"""
        laid: List[LaidSlice] = []
        offset = 0
        for step in self.steps:
            for j, sl in enumerate(step.slices):
                laid.append(LaidSlice(
                    step_id=step.step_id, slice_index=j, kind=sl.kind,
                    offset=offset, count=sl.count,
                    draw_params=dict(sl.draw_params)))
                offset += sl.count
        return laid

    def total_draws(self) -> int:
        return sum(s.count for st in self.steps for s in st.slices)

    def resolve_step_params(self, step: Step) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for key, val in step.params.items():
            if isinstance(val, dict) and REF_KEY in val:
                out[key] = self.values[val[REF_KEY]]
            else:
                out[key] = val
        return out

    def policy_seed(self) -> Optional[int]:
        pol = self.seed_policy or {}
        if pol.get("type") == "fixed":
            return int(pol["seed"])
        return None

    # ---- 序列化 --------------------------------------------------------
    def config_dict(self) -> Dict[str, Any]:
        """影响执行的配置内容（剔除 source 等来源元数据）。

        同一份实验配置由不同来源给出时，配置指纹必须相同；差异仅体现
        在来源标签与冲突留档上。
        """
        d = self.to_dict()
        d.pop("source", None)
        return d

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "parameters": [p.to_dict() for p in self.param_specs],
            "steps": [s.to_dict() for s in self.steps],
            "values": dict(self.values),
            "seed_policy": dict(self.seed_policy),
            "default_retries": self.default_retries,
            "source": self.source,
            "description": self.description,
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str = "experiment") \
            -> "Experiment":
        eid = _as_type(_req(d, "experiment_id", ctx), "experiment_id", ctx,
                       (str,), "str")
        params_raw = _req(d, "parameters", ctx)
        steps_raw = _req(d, "steps", ctx)
        if not isinstance(params_raw, list):
            raise IntegrityError(f"{ctx}.parameters: 期望数组")
        if not isinstance(steps_raw, list):
            raise IntegrityError(f"{ctx}.steps: 期望数组")
        values = d.get("values", {})
        if not isinstance(values, dict):
            raise IntegrityError(f"{ctx}.values: 期望对象")
        policy = d.get("seed_policy", {})
        if not isinstance(policy, dict):
            raise IntegrityError(f"{ctx}.seed_policy: 期望对象")
        dr = d.get("default_retries", 0)
        if not isinstance(dr, int) or isinstance(dr, bool) or dr < 0:
            raise IntegrityError(f"{ctx}.default_retries: 期望非负 int")
        tags = d.get("tags", [])
        return cls(
            experiment_id=eid,
            param_specs=[ParameterSpec.from_dict(
                p, f"{ctx}.parameters[{i}]")
                for i, p in enumerate(params_raw)],
            steps=[Step.from_dict(s, f"{ctx}.steps[{i}]")
                   for i, s in enumerate(steps_raw)],
            values=dict(values),
            seed_policy=dict(policy),
            default_retries=dr,
            source=d.get("source", "local"),
            description=d.get("description", ""),
            tags=list(tags) if isinstance(tags, list) else [])


# ---------------------------------------------------------------------------
# 运行记录
# ---------------------------------------------------------------------------

@dataclass
class AttemptRecord:
    attempt: int
    consumed: Dict[str, int]          # slice key "kind@offset" -> 已消耗数
    error: Optional[str] = None
    error_type: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"attempt": self.attempt, "consumed": dict(self.consumed),
                "error": self.error, "error_type": self.error_type}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "AttemptRecord":
        consumed = _req(d, "consumed", ctx)
        if not isinstance(consumed, dict):
            raise IntegrityError(f"{ctx}.consumed: 期望对象")
        return cls(attempt=int(_req(d, "attempt", ctx)),
                   consumed={str(k): int(v) for k, v in consumed.items()},
                   error=d.get("error"), error_type=d.get("error_type"))


@dataclass
class SliceRecord:
    kind: str
    offset: int
    count: int
    consumed: int
    slice_index: int = 0
    sample_draws: List[Any] = field(default_factory=list)  # 至多前若干个

    def to_dict(self) -> Dict[str, Any]:
        return {"kind": self.kind, "offset": self.offset, "count": self.count,
                "consumed": self.consumed, "slice_index": self.slice_index,
                "sample_draws": list(self.sample_draws)}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "SliceRecord":
        for k in ("kind", "offset", "count", "consumed"):
            if k not in d:
                raise IntegrityError(f"{ctx}: 缺少字段 {k!r}")
        return cls(kind=str(d["kind"]), offset=int(d["offset"]),
                   count=int(d["count"]), consumed=int(d["consumed"]),
                   slice_index=int(d.get("slice_index", 0)),
                   sample_draws=list(d.get("sample_draws", [])))


@dataclass
class StepRecord:
    step_id: str
    fn: str
    status: str                        # ok / failed
    result: Any = None
    attempts: List[AttemptRecord] = field(default_factory=list)
    slices: List[SliceRecord] = field(default_factory=list)
    order: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {"step_id": self.step_id, "fn": self.fn,
                "status": self.status, "result": self.result,
                "attempts": [a.to_dict() for a in self.attempts],
                "slices": [s.to_dict() for s in self.slices],
                "order": self.order}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "StepRecord":
        sid = _as_type(_req(d, "step_id", ctx), "step_id", ctx, (str,),
                       "str")
        status = _as_type(_req(d, "status", ctx), "status", ctx, (str,),
                          "str")
        if status not in ("ok", "failed"):
            raise IntegrityError(f"{ctx}.status: 非法值 {status!r}")
        raw_a = d.get("attempts", [])
        raw_s = d.get("slices", [])
        return cls(step_id=sid, fn=str(d.get("fn", "")), status=status,
                   result=d.get("result"),
                   attempts=[AttemptRecord.from_dict(
                       a, f"{ctx}.attempts[{i}]")
                       for i, a in enumerate(raw_a)],
                   slices=[SliceRecord.from_dict(
                       s, f"{ctx}.slices[{i}]")
                       for i, s in enumerate(raw_s)],
                   order=int(d.get("order", 0)))


@dataclass
class RunRecord:
    experiment_id: str
    seed: int
    status: str                        # ok / failed
    step_records: List[StepRecord] = field(default_factory=list)
    estimate: Any = None
    estimate_step: Optional[str] = None
    attempts_total: int = 0
    retries_total: int = 0
    scheduling: str = "sequential"
    reproduced: Optional[bool] = None
    error: Optional[str] = None
    result_fingerprint: Optional[str] = None
    config_fingerprint: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"experiment_id": self.experiment_id, "seed": self.seed,
                "status": self.status,
                "step_records": [s.to_dict() for s in self.step_records],
                "estimate": self.estimate,
                "estimate_step": self.estimate_step,
                "attempts_total": self.attempts_total,
                "retries_total": self.retries_total,
                "scheduling": self.scheduling,
                "reproduced": self.reproduced, "error": self.error,
                "result_fingerprint": self.result_fingerprint,
                "config_fingerprint": self.config_fingerprint}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str = "run") -> "RunRecord":
        eid = _as_type(_req(d, "experiment_id", ctx), "experiment_id", ctx,
                       (str,), "str")
        if "seed" not in d:
            raise IntegrityError(f"{ctx}: 缺少字段 'seed'")
        seed = d["seed"]
        if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
            raise IntegrityError(f"{ctx}.seed: 期望非负 int")
        status = _as_type(_req(d, "status", ctx), "status", ctx, (str,),
                          "str")
        if status not in ("ok", "failed"):
            raise IntegrityError(f"{ctx}.status: 非法值 {status!r}")
        raw = d.get("step_records", [])
        if not isinstance(raw, list):
            raise IntegrityError(f"{ctx}.step_records: 期望数组")
        return cls(
            experiment_id=eid, seed=seed, status=status,
            step_records=[StepRecord.from_dict(
                s, f"{ctx}.step_records[{i}]") for i, s in enumerate(raw)],
            estimate=d.get("estimate"),
            estimate_step=d.get("estimate_step"),
            attempts_total=int(d.get("attempts_total", 0)),
            retries_total=int(d.get("retries_total", 0)),
            scheduling=d.get("scheduling", "sequential"),
            reproduced=d.get("reproduced"), error=d.get("error"),
            result_fingerprint=d.get("result_fingerprint"),
            config_fingerprint=d.get("config_fingerprint"))


# ---------------------------------------------------------------------------
# 批量汇总
# ---------------------------------------------------------------------------

@dataclass
class OutlierInfo:
    seed: int
    value: float
    z_score: float
    mean_without: float
    std_without: float
    threshold: float
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        # JSON 没有无穷大：留一法标准差为 0 时 z 记为 null，读回为 inf
        return {"seed": self.seed, "value": self.value,
                "z_score": None if math.isinf(self.z_score) else self.z_score,
                "mean_without": self.mean_without,
                "std_without": self.std_without,
                "threshold": self.threshold, "reason": self.reason}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str) -> "OutlierInfo":
        try:
            z = d["z_score"]
            if z is None:
                z = math.inf
            return cls(seed=int(d["seed"]), value=float(d["value"]),
                       z_score=float(z),
                       mean_without=float(d["mean_without"]),
                       std_without=float(d["std_without"]),
                       threshold=float(d["threshold"]),
                       reason=str(d["reason"]))
        except KeyError as e:
            raise IntegrityError(f"{ctx}: 缺少字段 {e}")
        except (TypeError, ValueError) as e:
            raise IntegrityError(f"{ctx}: {e}")


@dataclass
class BatchSummary:
    experiment_id: str
    ci_level: float
    seeds: List[int]
    estimates: Dict[str, float]
    mean: float
    variance: float
    std: float
    ci_low: float
    ci_high: float
    outliers: List[OutlierInfo]
    method: str = "mean+t(loo-z@2.5)"

    def to_dict(self) -> Dict[str, Any]:
        return {"experiment_id": self.experiment_id,
                "ci_level": self.ci_level, "seeds": list(self.seeds),
                "estimates": dict(self.estimates), "mean": self.mean,
                "variance": self.variance, "std": self.std,
                "ci_low": self.ci_low, "ci_high": self.ci_high,
                "outliers": [o.to_dict() for o in self.outliers],
                "method": self.method}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str = "batch_summary") \
            -> "BatchSummary":
        try:
            outliers = [OutlierInfo.from_dict(
                o, f"{ctx}.outliers[{i}]")
                for i, o in enumerate(d.get("outliers", []))]
            estimates = {str(k): float(v)
                         for k, v in d["estimates"].items()}
            return cls(
                experiment_id=str(d["experiment_id"]),
                ci_level=float(d["ci_level"]),
                seeds=[int(s) for s in d["seeds"]],
                estimates=estimates, mean=float(d["mean"]),
                variance=float(d["variance"]), std=float(d["std"]),
                ci_low=float(d["ci_low"]), ci_high=float(d["ci_high"]),
                outliers=outliers, method=d.get(
                    "method", "mean+t(loo-z@2.5)"))
        except KeyError as e:
            raise IntegrityError(f"{ctx}: 缺少字段 {e}")
        except (TypeError, ValueError) as e:
            raise IntegrityError(f"{ctx}: {e}")


# ---------------------------------------------------------------------------
# 冲突记录
# ---------------------------------------------------------------------------

VALID_CONFLICT_KINDS = ("config", "result")
VALID_CONFLICT_STATUS = ("open", "resolved_a", "resolved_b", "rejected")


@dataclass
class ConflictRecord:
    conflict_id: str
    experiment_id: str
    kind: str
    source_a: str
    source_b: str
    content_a: Any
    content_b: Any
    detail: str
    status: str = "open"
    resolution: Optional[str] = None
    seq: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {"conflict_id": self.conflict_id,
                "experiment_id": self.experiment_id, "kind": self.kind,
                "source_a": self.source_a, "source_b": self.source_b,
                "content_a": self.content_a, "content_b": self.content_b,
                "detail": self.detail, "status": self.status,
                "resolution": self.resolution, "seq": self.seq}

    @classmethod
    def from_dict(cls, d: Dict[str, Any], ctx: str = "conflict") \
            -> "ConflictRecord":
        try:
            kind = d["kind"]
            status = d.get("status", "open")
            if kind not in VALID_CONFLICT_KINDS:
                raise IntegrityError(f"{ctx}.kind: 非法值 {kind!r}")
            if status not in VALID_CONFLICT_STATUS:
                raise IntegrityError(f"{ctx}.status: 非法值 {status!r}")
            return cls(
                conflict_id=str(d["conflict_id"]),
                experiment_id=str(d["experiment_id"]), kind=kind,
                source_a=str(d["source_a"]), source_b=str(d["source_b"]),
                content_a=d["content_a"], content_b=d["content_b"],
                detail=str(d.get("detail", "")), status=status,
                resolution=d.get("resolution"), seq=int(d.get("seq", 0)))
        except KeyError as e:
            raise IntegrityError(f"{ctx}: 缺少字段 {e}")


SliceKey = str
