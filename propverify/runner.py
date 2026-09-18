"""运行器：批量生成输入、逐条判定不变量、收缩反例、增量重判。

确定性保证：
- 输入只由 (seed, 对象, 序号) 决定，与遍历顺序无关；
- 汇总结论按 (对象, 序号, 不变量标识) 排序后计算，顺序无关；
- 收缩无随机性，结果可复现且复验仍违反原不变量。

增量重判：
- 不变量变更 → 只重判该不变量；
- 字段取值域变更 → 只重新生成该字段，逐输入比对，取值或跳过状态
  发生变化的输入才重判，其余输入的判定对象原样保留（同一实例）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from .gencfg import GenConfig, ObjectGenConfig
from .generator import GeneratedInput, generate_field, generate_input
from .registry import CompiledInvariant, Invariant, Registry
from .shrink import ShrinkResult, shrink_input
from .verdicts import FAIL, PASS, SKIP, Verdict, VerdictKey, VerdictStore

LOCAL_SOURCE = "local"


@dataclass
class FailureDetail:
    key: VerdictKey
    values: dict
    reason: str
    shrink: Optional[ShrinkResult] = None


@dataclass
class UpdateSummary:
    regenerated_inputs: List[Tuple[str, int]] = field(default_factory=list)
    rejudged: List[VerdictKey] = field(default_factory=list)
    unchanged_verdicts: int = 0


class Runner:
    def __init__(self, registry: Registry, config: GenConfig):
        self.registry = registry
        self.config = config
        self.store = VerdictStore()
        self.inputs: Dict[Tuple[str, int], GeneratedInput] = {}
        self.failures: Dict[VerdictKey, FailureDetail] = {}
        self._compiled: Dict[str, CompiledInvariant] = {}
        self._field_specs: Dict[Tuple[str, str], tuple] = {}
        self._constraint_sources: Dict[str, tuple] = {}
        self._snapshot_config()

    # ------------------------------------------------------------ 快照
    def _snapshot_config(self) -> None:
        self._field_specs = {
            (t, name): self.config.object_config(t).fields[name].spec_key()
            for t in self.config.targets
            for name in self.config.fields_of(t)
        }
        self._constraint_sources = {
            t: tuple(c.source for c in self.config.object_config(t).constraints)
            for t in self.config.targets
        }

    # ------------------------------------------------------------ 判定
    def _compile(self, inv: Invariant) -> CompiledInvariant:
        known = set(self.config.fields_of(inv.target)) if inv.target in self.config.targets else None
        compiled = Registry.compile(inv, known)
        self._compiled[inv.inv_id] = compiled
        return compiled

    def _judge(self, compiled: CompiledInvariant, gin: GeneratedInput) -> Verdict:
        if gin.skipped:
            return Verdict(SKIP, gin.skip_reason)
        try:
            if not compiled.applies(gin.values):
                return Verdict(SKIP, "前置条件不满足，该输入不参与本不变量判定")
        except Exception as exc:
            return Verdict(SKIP, f"前置条件求值异常: {exc}")
        try:
            if compiled.holds(gin.values):
                return Verdict(PASS)
            return Verdict(FAIL, "判定条件为假")
        except Exception as exc:
            return Verdict(FAIL, f"判定条件求值异常: {exc}")

    def _record(self, compiled: CompiledInvariant, gin: GeneratedInput) -> Verdict:
        key = (compiled.inv_id, gin.target, gin.index)
        verdict = self._judge(compiled, gin)
        self.store.submit(LOCAL_SOURCE, key, verdict)
        if verdict.status == FAIL:
            shrink = shrink_input(
                self.config,
                gin.target,
                gin.values,
                violates=lambda v: not compiled.holds(v) if compiled.applies(v) else False,
            )
            self.failures[key] = FailureDetail(
                key=key, values=dict(gin.values), reason=verdict.reason, shrink=shrink
            )
        else:
            self.failures.pop(key, None)
        return verdict

    # ------------------------------------------------------------ 全量运行
    def run(self) -> "Runner":
        for target in self.config.targets:
            for inv in self.registry.invariants_for(target):
                self._compile(inv)
            for index in range(self.config.input_count):
                gin = generate_input(self.config, target, index)
                self.inputs[(target, index)] = gin
                for inv in self.registry.invariants_for(target):
                    self._record(self._compiled[inv.inv_id], gin)
        return self

    # ------------------------------------------------------------ 外部来源
    def submit_external(self, source: str, inv_id: str, target: str, index: int, verdict: Verdict):
        """登记外部来源对同一键的判定；矛盾时返回冲突记录。"""
        return self.store.submit(source, (inv_id, target, index), verdict)

    # ------------------------------------------------------------ 增量：不变量变更
    def update_invariant(self, inv: Invariant) -> UpdateSummary:
        old = self.registry.invariant(inv.inv_id)
        if old.spec_key() == inv.spec_key():
            return UpdateSummary()
        self.registry.replace_invariant(inv)
        compiled = self._compile(inv)
        summary = UpdateSummary()
        for index in range(self.config.input_count):
            gin = self.inputs.get((inv.target, index))
            if gin is None:
                continue
            self._record(compiled, gin)
            summary.rejudged.append((inv.inv_id, inv.target, index))
        return summary

    # ------------------------------------------------------------ 增量：取值域/约束变更
    def update_domain(self, target: str, field_name: str, domain, edge_weight: float = None) -> UpdateSummary:
        """替换某字段的取值域，只重判取值或跳过状态实际变化的输入。"""
        ocfg = self.config.object_config(target)
        old_fspec = ocfg.fields[field_name]
        new_weight = old_fspec.edge_weight if edge_weight is None else edge_weight
        # 在探针配置上整体重建该校验域：空域 / 非法权重 / 约束排斥在此拒绝。
        probe = GenConfig(self.config.seed, self.config.input_count)
        for name in self.config.fields_of(target):
            f = ocfg.fields[name]
            if name == field_name:
                probe.add_field(target, name, domain, new_weight)
            else:
                probe.add_field(target, name, f.domain, f.edge_weight)
        for c in ocfg.constraints:
            probe.add_constraint(target, c.source)

        ocfg.fields[field_name].domain = domain
        ocfg.fields[field_name].edge_weight = new_weight
        self._field_specs[(target, field_name)] = ocfg.fields[field_name].spec_key()

        summary = UpdateSummary()
        compiled = {inv.inv_id: self._compile(inv) for inv in self.registry.invariants_for(target)}
        for index in range(self.config.input_count):
            gin = self.inputs[(target, index)]
            new_value = generate_field(self.config, target, index, field_name)
            old_value = gin.values.get(field_name) if gin.values else None
            new_values = dict(gin.values or {})
            new_values[field_name] = new_value
            violated = self.config.constraints_ok(target, new_values)
            new_skip = f"不满足约束: {violated}" if violated is not None else None
            if new_value == old_value and new_skip == gin.skip_reason:
                summary.unchanged_verdicts += len(compiled)
                continue  # 未受影响：判定对象原样保留
            new_gin = GeneratedInput(target=target, index=index, values=new_values, skip_reason=new_skip)
            self.inputs[(target, index)] = new_gin
            summary.regenerated_inputs.append((target, index))
            for inv_id, comp in compiled.items():
                self._record(comp, new_gin)
                summary.rejudged.append((inv_id, target, index))
        return summary

    def update_constraint(self, target: str, new_sources: List[str]) -> UpdateSummary:
        """整体替换某对象的约束集合，只重判跳过状态变化的输入。"""
        from .expr import Expr

        ocfg = self.config.object_config(target)
        old = tuple(c.source for c in ocfg.constraints)
        if tuple(new_sources) == old:
            return UpdateSummary()
        new_exprs = [Expr(s, f"object[{target}].constraint[{s!r}]") for s in new_sources]
        # 先在副本上验证可满足性，拒绝时不污染当前配置。
        probe_cfg = ObjectGenConfig(target=target, fields=dict(ocfg.fields), constraints=new_exprs)
        self.config._check_satisfiable(probe_cfg)
        ocfg.constraints = new_exprs
        self._constraint_sources[target] = tuple(new_sources)

        summary = UpdateSummary()
        compiled = {inv.inv_id: self._compile(inv) for inv in self.registry.invariants_for(target)}
        for index in range(self.config.input_count):
            gin = self.inputs[(target, index)]
            violated = self.config.constraints_ok(target, gin.values or {})
            new_skip = f"不满足约束: {violated}" if violated is not None else None
            if new_skip == gin.skip_reason:
                summary.unchanged_verdicts += len(compiled)
                continue
            new_gin = GeneratedInput(target=target, index=index, values=dict(gin.values or {}), skip_reason=new_skip)
            self.inputs[(target, index)] = new_gin
            summary.regenerated_inputs.append((target, index))
            for inv_id, comp in compiled.items():
                self._record(comp, new_gin)
                summary.rejudged.append((inv_id, target, index))
        return summary

    # ------------------------------------------------------------ 汇总
    def conclusion(self) -> Dict[str, dict]:
        """每条不变量的最终结论；按键排序计算，与生成顺序无关。"""
        out: Dict[str, dict] = {}
        for key in self.store.keys():
            inv_id = key[0]
            entry = out.setdefault(inv_id, {"pass": 0, "fail": 0, "skip": 0, "conflict": 0, "failures": []})
            v = self.store.effective(key)
            entry[v.status] += 1
            if v.status == FAIL:
                entry["failures"].append(key)
        for entry in out.values():
            entry["failures"].sort()
        return out
