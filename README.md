# 年度资金分配引擎（fund_allocator）

离线、零第三方依赖的候选项目资金分配引擎。解决手工凑表时的三类老问题：
**总额超限、前置未达标却先拿钱、砍掉项目却留下它的下游。**

- Python 3.9+，仅用标准库
- 金额全程 `Decimal`，精确到分（0.01），无浮点误差
- 同一输入重复求解，结果逐项目完全一致

## 快速开始

```bash
# 1) 跑离线演示（走查全部 7 条需求）
python -X utf8 demo.py            # Windows 控制台建议加 -X utf8

# 2) 跑全部验收测试（75 个）
python -m unittest discover -s tests -v

# 3) 命令行
python -m fund_allocator.cli validate examples/scenario.json
python -m fund_allocator.cli solve    examples/scenario.json --out solved.json
python -m fund_allocator.cli query    solved.json            # 方案摘要
python -m fund_allocator.cli query    solved.json CORE       # 单项目
python -m fund_allocator.cli cut      solved.json DATA 0 --out cut.json
```

最小代码示例：

```python
from decimal import Decimal
from fund_allocator import Project, Registry, Engine

reg = Registry()
reg.add_project(Project.create("CORE",   1, "300", "120", ["120", "100", "80"], benefit="600"))
reg.add_project(Project.create("APP",    2, "400", "150", ["150", "250"],       benefit="800"))
reg.add_dependency("APP", "CORE")          # APP 前置为 CORE

eng = Engine(reg)
plan = eng.solve("900")                     # 资金上限 900
print(eng.query_plan())                     # 总额/各阶段占用/未满足项
eng.reduce("CORE", Decimal("0"))            # 取消 CORE，只重算其下游
```

## 需求与实现对照

| # | 需求 | 实现位置 | 验收测试 |
|---|------|----------|----------|
| 1 | 项目维护、阶段之和守恒、非法配置带位置拒绝 | `models.py`（`Project`/`money`） | `tests/test_1_projects.py` |
| 2 | 前置依赖、悬空/成环拒绝并给出链条 | `registry.py` | `tests/test_2_dependencies.py` |
| 3 | 上限内出方案：不超限、启动即达最低额、前置门控 | `solver.py`、`models.AllocationPlan.validate` | `tests/test_3_4_solver.py` |
| 4 | 优先级 + ROI 取舍、平局按 id 字典序、结果可复现 | `solver.py:Solver.rank_projects` | 同上 |
| 5 | 削减后只重算下游，且与同约束从头求解一致 | `engine.py:Engine.reduce` | `tests/test_5_incremental.py` |
| 6 | 已批/缺口/启动状态/被依赖、总额/阶段占用/未满足项，稳定顺序 | `queries.py` | `tests/test_6_queries.py` |
| 7 | 单文件存取、全量校验、损坏报错、失败状态不变 | `persistence.py` | `tests/test_7_persistence.py` |

## 关键语义

### 取舍排序（需求 4）

排序键依次为：

1. **优先级升序**（数值越小越优先）；
2. **投入产出比 ROI 降序**，`ROI = benefit / total_need`，用 Decimal
   交叉相乘精确比较（不引入浮点）；未提供 `benefit` 时取总需求额，
   ROI 退化为 1，规则退化为"优先级 + 字典序"；
3. **项目标识字典序升序**（最终平局裁决，保证可复现）。

### 启动与分期（需求 3）

- 项目要么拿 0，要么拿 **≥ 最低启动额**，不存在 0 与最低额之间的半截拨款；
- 项目启动的充要条件是其**所有前置都已达标**（拨款 ≥ 各自最低启动额）；
- 若高优先项目的前置排名更靠后，前置会随该项目**链式启动**：
  把"目标项目 + 尚未达标的全部前置"作为一个**原子事务**，预算够就一起放下，
  不够就整个放弃（不会出现下游拿了钱而前置没达标）；
- 所有启动决策完成后，剩余预算按同一排序键依次补足各项目缺口，
  阶段按顺序填充（阶段 1 填满才进阶段 2……）。

### 削减后的增量重算（需求 5）

`Engine.reduce(X, 新金额)` 的重算区域严格限定为
**R = {X} ∪ X 的全部下游（传递依赖方）**：

- R 之外所有项目（包括当前未获拨款的）拨款一律锁定、分文不动；
- X 锁定在削减后金额（0 = 取消，其下游因门控全部停止）；
- 在以上硬约束下对 R 做一次全新求解。

因此增量结果与"带着同样硬约束、对全部项目从头求解"**逐项目完全相同**
（求解器无状态、决策只依赖约束，不依赖求解范围）。`reduce` 内置
`_check_equivalence=True` 自检开关，会真的跑一遍全量求解逐项比对。
新金额允许 0 或 ≥ 最低启动额，落在 `(0, min_start)` 区间会被拒绝
（那会违反启动下限）；也不允许借"削减"提高金额。

> 注意：削减是一条新增的硬承诺（"该项目此后就是这个金额"），不是假装
> 历史承诺不存在。这正是"只动下游"与"与从头求解一致"能同时成立的原因。

### 查询（需求 6）

- 单项目：已批金额、剩余缺口、启动状态、直接前置、直接/传递依赖方；
- 方案级：总额、剩余、已启动列表、各阶段全局占用、未满足项。
- 所有列表均按 id 字典序（或稳定拓扑序）返回，重复查询结果一致。

## 文件格式（需求 7）

单个 UTF-8 JSON 文件，同时承载项目、依赖、资金上限与方案：

```json
{
  "version": 1,
  "budget": "900.00",
  "projects": [{
    "id": "CORE", "priority": 1,
    "total_need": "300.00", "min_start": "120.00",
    "benefit": "600.00",
    "phases": ["120.00", "100.00", "80.00"]
  }],
  "dependencies": [{"project": "APP", "requires": "CORE"}],
  "plan": {"allocations": [{"project_id": "CORE", "amount": "300.00"}]}
}
```

- 金额一律写成**字符串**（避免 JSON 浮点），必须精确到 0.01；
- 载入依次校验：JSON 可解析、顶层字段齐全、id 唯一、阶段之和等于
  总需求、最低启动额合法、依赖端点存在、图无环、单项金额在
  `[0, total_need]`、已启动项达最低额、前置门控、**已批合计 ≤ 上限**；
- 所有解析与校验都在临时对象上完成，**全部通过后才一次性替换引擎状态**
  （`load_into` 失败时原方案原样保留）；
- 保存采用"同目录临时文件 + `os.replace`"原子替换，不会留下半写文件，
  且同一状态重复保存字节级一致。

## 目录结构

```
fund_allocator/
  errors.py       # 异常类型（ValidationError 带 location，DependencyError 带 chain）
  models.py       # Project / AllocationPlan / 金额规范化 / 阶段填充
  registry.py     # 项目注册表、依赖图、环检测、上下游闭包、稳定拓扑序
  solver.py       # 排序键、链式启动、分期填充（无状态、可复现）
  engine.py       # 全量求解、增量削减重算、查询门面
  queries.py      # 单项目 / 方案级稳定查询
  persistence.py  # JSON 原子写、全量校验载入、失败状态不变
  cli.py          # validate / solve / query / cut
tests/            # 75 个验收测试，按需求编号分文件
examples/         # scenario.json 示例场景
demo.py           # 需求 1-7 端到端走查
```
