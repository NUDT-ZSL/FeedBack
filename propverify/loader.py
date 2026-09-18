"""从 JSON 字典加载完整验收配置（离线文件即可驱动一次运行）。

配置结构：
{
  "seed": 42,
  "input_count": 200,
  "objects": ["counter", "order"],
  "invariants": [
    {"id": "余额非负", "target": "counter", "check": "balance >= 0",
     "when": "active == true", "description": "..."}
  ],
  "objects_config": {
    "counter": {
      "fields": {
        "balance": {"type": "int", "min": -100, "max": 100, "edge_weight": 0.3},
        "active":  {"type": "bool"}
      },
      "constraints": ["balance != 0 or active == false"]
    }
  }
}
"""

from __future__ import annotations

from typing import Tuple

from .domains import Domain
from .errors import SpecError
from .gencfg import GenConfig
from .registry import Registry


def load_config(data: dict) -> Tuple[Registry, GenConfig]:
    if not isinstance(data, dict):
        raise SpecError("config", "配置必须是 JSON 对象")
    registry = Registry()

    objects = data.get("objects", [])
    if not isinstance(objects, list) or not objects:
        raise SpecError("config.objects", "必须声明非空的对象数组")
    for i, name in enumerate(objects):
        try:
            registry.register_object(name)
        except SpecError as exc:
            raise SpecError(f"config.objects[{i}]", exc.reason) from exc

    seed = data.get("seed", 0)
    count = data.get("input_count", 100)
    cfg = GenConfig(seed=seed, input_count=count)

    objects_config = data.get("objects_config", {})
    for target in registry.objects:
        ocfg = objects_config.get(target)
        if ocfg is None:
            raise SpecError(f"config.objects_config", f"对象 {target!r} 缺少生成配置")
        fields = ocfg.get("fields", {})
        if not fields:
            raise SpecError(f"config.objects_config.{target}.fields", "至少声明一个输入字段")
        for name, spec in fields.items():
            path = f"config.objects_config.{target}.fields.{name}"
            domain = Domain.from_spec(spec, path)
            cfg.add_field(target, name, domain, edge_weight=spec.get("edge_weight", 0.2))
        for j, source in enumerate(ocfg.get("constraints", [])):
            try:
                cfg.add_constraint(target, source)
            except SpecError as exc:
                raise SpecError(f"config.objects_config.{target}.constraints[{j}]", exc.reason) from exc

    for i, inv in enumerate(data.get("invariants", [])):
        path = f"config.invariants[{i}]"
        for key in ("id", "target", "check"):
            if key not in inv:
                raise SpecError(path, f"缺少必填字段 {key!r}")
        try:
            registry.register_invariant(
                inv_id=inv["id"],
                target=inv["target"],
                check=inv["check"],
                when=inv.get("when"),
                description=inv.get("description", ""),
            )
        except SpecError as exc:
            raise SpecError(path, exc.reason) from exc

    # 不变量表达式引用的字段必须在对应对象的 fields 中声明过。
    for inv in registry.invariants:
        if inv.target in cfg.targets:
            Registry.compile(inv, set(cfg.fields_of(inv.target)))

    return registry, cfg
