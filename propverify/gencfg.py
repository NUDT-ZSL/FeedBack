"""输入生成配置：每个对象声明若干字段的取值域、约束与权重。

校验规则（全部在登记时完成，拒绝时带位置与原因）：
- 取值域为空（下界大于上界、空候选集、空字母表等）→ 拒绝；
- 权重非法（负数、全零、数量不匹配）→ 拒绝；
- 约束表达式互相排斥（采样 + 边界探测找不到任何可行解）→ 拒绝。
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .domains import Domain
from .errors import SpecError
from .expr import Expr

# 约束可满足性探测：小空间笛卡尔积全量枚举，大空间确定性采样。
_EXHAUSTIVE_LIMIT = 20_000
_SAMPLE_LIMIT = 5_000


@dataclass
class FieldSpec:
    name: str
    domain: Domain
    # 边界权重：以该概率生成边界代表值（空串、0、上下界等），其余均匀随机。
    edge_weight: float = 0.2

    def spec_key(self) -> tuple:
        return (self.name, repr(sorted(self.domain.to_spec().items())), self.edge_weight)


@dataclass
class ObjectGenConfig:
    target: str
    fields: Dict[str, FieldSpec] = field(default_factory=dict)
    constraints: List[Expr] = field(default_factory=list)

    def spec_key(self) -> tuple:
        return (
            self.target,
            tuple(self.fields[k].spec_key() for k in sorted(self.fields)),
            tuple(c.source for c in self.constraints),
        )


class GenConfig:
    """一次验收运行的完整生成配置。"""

    def __init__(self, seed: int, input_count: int):
        if not isinstance(seed, int) or isinstance(seed, bool):
            raise SpecError("config.seed", "seed 必须是整数")
        if not isinstance(input_count, int) or isinstance(input_count, bool) or input_count <= 0:
            raise SpecError("config.input_count", "input_count 必须是正整数")
        self.seed = seed
        self.input_count = input_count
        self._objects: Dict[str, ObjectGenConfig] = {}

    # ------------------------------------------------------------ 字段
    def add_field(self, target: str, name: str, domain: Domain, edge_weight: float = 0.2) -> None:
        path = f"object[{target}].field[{name}]"
        if not isinstance(edge_weight, (int, float)) or isinstance(edge_weight, bool) or not 0.0 <= edge_weight <= 1.0:
            raise SpecError(path + ".edge_weight", f"边界权重必须在 [0,1] 区间，实际为 {edge_weight!r}")
        domain.validate(path + ".domain")
        cfg = self._objects.setdefault(target, ObjectGenConfig(target=target))
        if name in cfg.fields:
            raise SpecError(path, f"字段标识重复: {name!r} 已在对象 {target!r} 上声明")
        cfg.fields[name] = FieldSpec(name=name, domain=domain, edge_weight=float(edge_weight))

    # ------------------------------------------------------------ 约束
    def add_constraint(self, target: str, source: str) -> None:
        path = f"object[{target}].constraint[{source!r}]"
        cfg = self._objects.get(target)
        if cfg is None:
            raise SpecError(path, f"对象 {target!r} 尚未声明任何字段，无法添加约束")
        expr = Expr(source, path)
        unknown = sorted(expr.names - set(cfg.fields))
        if unknown:
            raise SpecError(path, f"约束引用了未声明的字段 {unknown}；已声明字段: {sorted(cfg.fields)}")
        cfg.constraints.append(expr)
        self._check_satisfiable(cfg)

    # ------------------------------------------------------------ 查询
    def object_config(self, target: str) -> ObjectGenConfig:
        return self._objects[target]

    @property
    def targets(self) -> List[str]:
        return sorted(self._objects)

    def fields_of(self, target: str) -> List[str]:
        return sorted(self._objects[target].fields)

    def constraints_ok(self, target: str, values: dict) -> Optional[str]:
        """返回第一条不满足的约束原文；全部满足返回 None。"""
        cfg = self._objects[target]
        env = {k: values.get(k) for k in cfg.fields}
        for c in cfg.constraints:
            try:
                if not c.check(env):
                    return c.source
            except Exception as exc:  # 约束自身求值失败也视为不满足
                return f"{c.source}（求值异常: {exc}）"
        return None

    # ------------------------------------------------------------ 可满足性
    def _check_satisfiable(self, cfg: ObjectGenConfig) -> None:
        probes = {name: _probe_values(f.domain) for name, f in sorted(cfg.fields.items())}
        total = 1
        for vals in probes.values():
            total *= max(1, len(vals))
        found = False
        if total <= _EXHAUSTIVE_LIMIT:
            names = sorted(probes)
            for combo in itertools.product(*(probes[n] for n in names)):
                if self._constraints_hold(cfg, dict(zip(names, combo))):
                    found = True
                    break
        else:
            rng = random.Random(("sat-probe", cfg.target, self.seed))
            for _ in range(_SAMPLE_LIMIT):
                candidate = {n: rng.choice(v) for n, v in probes.items()}
                if self._constraints_hold(cfg, candidate):
                    found = True
                    break
        if not found:
            sources = [c.source for c in cfg.constraints]
            raise SpecError(
                f"object[{cfg.target}].constraints",
                f"约束互相排斥，探测不到同时满足的取值: {sources}",
            )

    @staticmethod
    def _constraints_hold(cfg: ObjectGenConfig, env: dict) -> bool:
        for c in cfg.constraints:
            try:
                if not c.check(env):
                    return False
            except Exception:
                return False
        return True


def _probe_values(domain: Domain) -> list:
    """为约束探测准备代表值：边界 + 少量确定性内部点。"""
    from .domains import BoolDomain, ChoiceDomain, FloatDomain, IntDomain, ListDomain, StringDomain

    if isinstance(domain, IntDomain):
        vals = {domain.lo, domain.hi, (domain.lo + domain.hi) // 2}
        if domain.lo <= 0 <= domain.hi:
            vals.add(0)
        span = domain.hi - domain.lo
        if span <= 16:
            vals.update(range(domain.lo, domain.hi + 1))
        else:
            for q in (1, 2, 3):
                vals.add(domain.lo + span * q // 4)
        return sorted(vals)
    if isinstance(domain, FloatDomain):
        vals = [domain.lo, domain.hi, (domain.lo + domain.hi) / 2.0]
        if domain.lo <= 0.0 <= domain.hi:
            vals.append(0.0)
        return vals
    if isinstance(domain, BoolDomain):
        return [False, True]
    if isinstance(domain, ChoiceDomain):
        return list(domain.values)
    if isinstance(domain, StringDomain):
        if not domain.alphabet:
            return [""]
        a = domain.alphabet[0]
        z = domain.alphabet[-1]
        return [a * domain.min_len, z * max(domain.min_len, domain.max_len)]
    if isinstance(domain, ListDomain):
        inner = _probe_values(domain.element)
        return [
            [inner[0]] * domain.min_len,
            [inner[-1]] * domain.max_len,
        ]
    return [domain.edge(random.Random(0))]
