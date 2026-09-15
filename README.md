# 影响评估内核（impact_kernel）

策略调整影响评估：给定调整前后两套策略，对同一批访问请求逐条重放，
精确算出决策翻转，并解释每条翻转由哪条规则差异导致。
纯 Python 标准库实现，无第三方依赖，可完全离线运行与测试。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

## 语义约定（文档化行为）

- **效果（Effect）**：`ALLOW` 放行、`DENY` 拒绝、`AUDIT` 仅审计
  （放行类结果，但审计口径与 ALLOW 不同）。
- **生效规则选取**：仅考虑启用状态的规则；命中的规则按
  **优先级降序**排列，同优先级按**规则标识字典序升序**，首位即唯一生效规则。
- **默认效果**：无任何规则命中时，按策略声明的默认效果处理；
  内核默认 `DENY`（可在 `ImpactKernel(...)` 或 `load_policy(...)` 中覆盖）。
- **条件**：若干子句的合取（AND）；空条件匹配一切请求。
  操作符：`eq / ne / lt / le / gt / ge / in`。
- **翻转判定**：新旧决策的（效果 + 生效规则）任一不同即为翻转。
- **翻转分类**：
  - `NEW_DENY` 新增拒绝：旧决策非拒绝 → 新决策拒绝；
  - `NEW_ALLOW` 新增放行：旧决策拒绝 → 新决策非拒绝；
  - `AUDIT_ONLY` 仅审计变化：放行/拒绝结论未变，仅审计口径或生效规则变化
    （如优先级互换、条件重叠导致生效规则被同效果规则替换）。
- **归因**：把策略差异表示为原子差异集合（新增/删除/修改规则、默认效果变化），
  按子集大小从小到大枚举，找出能复现新决策的**最小差异集合**：
  - 唯一 → `ATTRIBUTED`，并说明该差异为何改变了生效规则；
  - 多组互斥最小解释 → `AMBIGUOUS`，列出全部候选，明确报告无法唯一归因；
  - 差异集合为空但决策翻转 → `UNATTRIBUTABLE`，说明原因，绝不随便挑规则充当解释；
  - 差异数超过 12 时退化为贪心约简，给出极小解释但标注 `unique=False`。
- **特殊翻转的归因保证**：
  - 两侧都无规则命中、仅默认效果不同时，翻转归因到默认效果差异，
    解释中明确"两套策略下均无规则命中"；
  - 规则停用/启用导致的翻转归因到该规则的启用状态差异，
    解释中说明替换后的生效规则或默认效果去向。

## 快速上手

```python
from impact_kernel import ImpactKernel, Rule, Condition, Clause, Effect

kernel = ImpactKernel({"user": str.__name__, "age": "int", "vip": "bool"})
kernel.add_request("req-1", {"user": "alice", "age": 20, "vip": False})

kernel.load_policy("old", [
    Rule("R-adult", 10, Condition((Clause("age", "ge", 18),)), Effect.ALLOW),
])
kernel.load_policy("new", [
    Rule("R-adult", 10, Condition((Clause("age", "ge", 21),)), Effect.ALLOW),
])

result = kernel.replay()                 # 逐条旧/新决策 + 是否翻转（按请求 ID 排序）
print(result.stats.describe())           # 整体翻转统计

for comp in result.flipped_comparisons():
    exp = kernel.explain_flip(comp.request_id)
    print(exp.describe())                # 最小规则差异集合 + 归因说明

kernel.decision_basis("req-1", "new")    # 任意请求的决策依据
kernel.rule_hits("R-adult", "new")       # 任意规则的命中请求列表（稳定顺序）
```

## 模块结构

| 模块 | 职责 |
| --- | --- |
| `schema.py` | 属性模式与类型检查（bool 不被当作 int） |
| `models.py` | Effect / Clause / Condition / Rule / AccessRequest / Policy 及校验 |
| `engine.py` | 单请求评估，输出决策与完整命中轨迹 |
| `diff.py` | 策略间原子差异计算与差异子集应用 |
| `replay.py` | 批量重放、翻转分类、整体统计 |
| `explain.py` | 翻转归因（最小差异集合 / 歧义 / 无法归因） |
| `kernel.py` | 门面：请求与策略维护、全部查询接口 |

所有查询结果（重放对比、命中列表、统计中的请求列表）均按标识字典序返回，顺序稳定。
