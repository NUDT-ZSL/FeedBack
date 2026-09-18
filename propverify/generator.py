"""确定性输入生成。

关键设计：每个字段的随机源由 (seed, 对象, 输入序号, 字段名) 四元组
经 SHA-256 派生，因此：
- 与生成顺序无关 —— 打乱输入序号或字段遍历顺序，结果完全一致；
- 单字段取值域变更只影响该字段的取值，其余字段逐位不变，
  这是增量重判“未受影响结论不得改变”的基础。
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from typing import Optional

from .gencfg import GenConfig


def _derive_seed(*parts) -> int:
    h = hashlib.sha256()
    for p in parts:
        h.update(repr(p).encode("utf-8"))
        h.update(b"|")
    return int.from_bytes(h.digest()[:8], "big")


def field_rng(seed: int, target: str, index: int, field_name: str) -> random.Random:
    return random.Random(_derive_seed(seed, target, index, field_name))


def generate_field(cfg: GenConfig, target: str, index: int, field_name: str):
    """重新生成单个字段的取值（增量重判时只调用它）。"""
    fspec = cfg.object_config(target).fields[field_name]
    rng = field_rng(cfg.seed, target, index, field_name)
    if rng.random() < fspec.edge_weight:
        return fspec.domain.edge(rng)
    return fspec.domain.generate(rng)


@dataclass
class GeneratedInput:
    target: str
    index: int
    values: Optional[dict]  # None 表示无法生成（理论上合法配置下不发生）
    skip_reason: Optional[str] = None  # 约束不满足 → 跳过原因

    @property
    def skipped(self) -> bool:
        return self.skip_reason is not None


def generate_input(cfg: GenConfig, target: str, index: int) -> GeneratedInput:
    """按配置生成第 index 个输入；约束不满足时标记跳过并说明原因。"""
    values = {
        name: generate_field(cfg, target, index, name)
        for name in cfg.fields_of(target)
    }
    violated = cfg.constraints_ok(target, values)
    if violated is not None:
        return GeneratedInput(
            target=target,
            index=index,
            values=values,
            skip_reason=f"不满足约束: {violated}",
        )
    return GeneratedInput(target=target, index=index, values=values)
