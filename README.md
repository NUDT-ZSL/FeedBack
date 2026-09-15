# synthcore — 离线合成系统内核

仅使用 Python 标准库,可完全离线运行与单元测试。跟踪物品、库存与配方,
在配方频繁增删改时维护每种物品的可制作状态与最优合成方案,
并保证增量重算结果与从零全量推导逐物品一致。

```bash
python -m unittest discover -s tests -v   # 运行测试
python examples/demo.py                    # 运行示例
```

## 快速上手

```python
from synthcore import Engine, dumps, load

eng = Engine()
eng.add_item("ore", stock=10)          # 基础库存
eng.add_item("ingot")
eng.add_recipe("smelt", {"ore": 2}, {"ingot": 1})

eng.best_plan("ingot")                 # {'item': 'ingot', 'source': 'recipe',
                                       #  'cost': Fraction(2, 1), 'recipe': 'smelt'}
eng.dependency_tree("ingot")           # 完整合成依赖树
eng.transitive_inputs("smelt")         # {'raw': {'ore': 2}, 'missing': {}}
eng.relation("ingot", "ore")           # 'a_depends_on_b'

text = dumps(eng)                      # 导出 JSON(含最优方案与冲突记录)
eng2 = load(text)                      # 重新载入(先校验后替换,失败状态不变)
```

## 数据模型(需求 1)

- **物品**:唯一标识(非空字符串)+ 基础库存(非负整数)。
- **配方**:唯一标识 + 若干 `(物品, 数量)` 输入与输出,数量必须为**正整数**。
- 非法输入(数量非正整数、标识为空/重复、引用不存在的物品、同一列表内
  物品重复、输入/输出为空)一律抛出 `ValidationError`,消息指出出错位置,
  如 `配方 'r1' inputs[2]: 数量必须为正整数, 实际为 -3`。
- 所有修改操作先校验后落库,失败不影响现有状态。

## 成本与最优方案规则(需求 4)

- 库存 > 0 的物品可直接消耗库存获得,**单位成本 = 1**;库存数量只影响
  可获得性,不影响单位成本(内核只做方案推导,不执行扣减)。
- 配方成本 = `sum(输入物品单位成本 × 输入数量)`;某物品经该配方的单位成本
  = `配方成本 / 该物品在配方中的产出数量`。成本用 `Fraction` 精确表示。
- **最优配方**:使单位成本最小的配方;成本相同(或同时不可行)时按
  **配方标识字典序最小**打破平局;与库存成本相同(=1)时优先库存。
- 成本为 `None` 表示不可获得(无库存且没有任何可行配方链)。

## 环的处理(需求 3)

- 在物品依赖图(输入物品 → 输出物品)上用 Tarjan 算法求强连通分量(SCC);
  大小 > 1 或存在自环的分量即一个环,记入 `engine.conflicts`,包含环上的
  **物品序列与配方序列**以及各物品当前是否可获得。
- **环状 SCC 内部的配方(某输入与某输出同属一个环)不参与成本推导**;
  环上物品只能由库存或"输入全部来自环外"的配方获得,否则判定为不可合成获得。
- 由此有效推导图是凝聚 DAG,推导必然终止,不会死循环;自我增殖配方
  (如 `1A → 2A`)被识别为自环并排除,不会无限压低成本。

## 增量重算(需求 2)

- 每次增/删/改配方或调整库存,只重置**受影响物品**(变更配方的输出物品
  及其反向依赖闭包)的派生值,未受影响物品保留缓存。可通过
  `engine.last_affected` 观察实际重算范围。
- 未受影响物品的全部传递输入与相关 SCC 结构都不在变更集中,因此其缓存值
  与全量推导相同;受影响物品在相同的确定性算法下重算,保证**逐物品结果
  与从零全量推导完全一致**(由 400 步随机操作的一致性测试与多种子模糊
  测试保证)。`engine.full_recompute()` 可随时手动触发全量推导作为基准。

## 配方失效与缺失链(需求 5)

- `engine.recipe_usable(rid)`:配方所有输入均可获得时为 `True`。
- `engine.recipe_status(rid)`:返回 `usable`、`cyclic`(是否为环内配方),
  不可用时给出 `missing`——每条缺失输入递归展开为完整缺失链,叶子为
  "无库存且没有任何配方能生产它"或 `cycle`(环引用,含路径),不会死循环。
- 某配方失效时,最优配方选择自动落到下一条可行备选配方上。

## 查询(需求 6)

| 方法 | 说明 |
| --- | --- |
| `best_plan(item)` | 最优获取方案:来源(stock/recipe)、配方、单位成本;不可获得时附缺失链 |
| `dependency_tree(item)` | 按最优配方展开的完整依赖树,库存为叶子,环引用截断为 `cycle-ref` |
| `transitive_inputs(recipe)` | 配方的全部传递输入:`raw`(有库存叶子)+ `missing`(不可获得叶子),数量为 `Fraction` |
| `relation(a, b)` | `a_depends_on_b` / `b_depends_on_a` / `cyclic` / `none` |

## 导出与载入(需求 7)

- `dumps(engine)` / `export_state(engine)`:导出物品(含库存)、配方,
  以及派生的最优方案与冲突记录(供检视;载入时忽略并以物品+配方重新推导)。
- `load(data, strict_cycles=False)` / `replace_state(engine, data)`:
  载入前完整校验——结构完整、标识唯一、数量为正整数、库存非负、引用存在、
  同表物品不重复;`strict_cycles=True` 时不允许未消解的环(抛 `CycleError`)。
  所有错误一次性汇总报告并带位置(如 `recipes[0].outputs[2].qty`);
  **先构建新状态、全部通过后一次性替换,任何失败都不改变现有状态**。

## 项目结构

```
synthcore/
  __init__.py       公共 API
  errors.py         ValidationError / NotFoundError / CycleError
  model.py          Item / Recipe 不可变模型
  engine.py         增量重算引擎(核心)
  persistence.py    JSON 导出 / 载入与校验
tests/test_synthcore.py   46 个单元测试(含随机化一致性测试)
examples/demo.py          端到端示例
```
