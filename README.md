# narrative — 长线叙事游戏的世界状态与存档管理模块

纯 Python 3.10 标准库实现，无第三方依赖，完全离线可验收。

## 功能总览（对应需求）

1. **叙事节点图**：节点含唯一标识、章节、进入条件、带标识的状态变更；节点间以条件边构成有向图（`narrative/model.py`）。
2. **世界状态**：命名变量 + 类型 + 当前值；进入节点按序应用变更，类型不符/未声明变量拒绝并指出位置（节点/变更/变量）。
3. **条件系统**：比较 + 逻辑组合，纯函数求值保证确定性；缺变量策略见 `docs/semantics.md` 第 2 节。
4. **回退读档**：每次进入前压入完整快照，`rollback_to` / `rollback_steps` 将状态、进度、解锁、分支归属一并回退，不留痕迹。
5. **汇合合并**：确定性合并两条分支的累积变更；同变量不同值保留双方来源并生成可读冲突记录（`narrative/merge.py`）。
6. **存档演进**：格式版本迁移链 + 内容演进（新变量补默认值、移除节点标记不可用），迁移后进度与分支归属不变（`narrative/migration.py`）。
7. **查询接口**：进入条件 / 可达后继 / 变量来源链 / 分支归属 / 未解决冲突，全部按稳定顺序返回。

## 目录结构

```
narrative/
  conditions.py   条件 AST 与确定性求值
  model.py        Schema / StateChange / Node / Edge / Graph 与校验
  engine.py       引擎：进入、快照、回退、合并应用、存档、查询
  merge.py        分支合并与冲突记录
  migration.py    存档格式迁移链
tests/            39 个单元测试，逐项覆盖需求
docs/semantics.md 行为契约（缺变量策略、合并规则、迁移规则等）
demo.py           七项需求端到端验收脚本
```

## 离线验收

```bash
python -m unittest discover -s tests -t .   # 单元测试（39 项）
python demo.py                              # 需求验收演示（19 项检查，全过退出码 0）
```

## 最小示例

```python
from narrative import (Compare, Edge, Engine, Graph, Node, Schema,
                       StateChange, VariableDef)

schema = Schema([VariableDef("trust", "int", 0)])
graph = Graph(
    [Node("start", "ch1", changes=[StateChange("c1", "trust", "add", 2)]),
     Node("ally", "ch2", entry_condition=Compare("trust", "ge", 2))],
    [Edge("start", "ally", label="help")],
)
engine = Engine(schema, graph)
engine.enter("start")
print(engine.reachable_from("start"))   # ['ally']
engine.enter("ally")
print(engine.branch_attribution())      # 'start:help'
engine.rollback_to("ally")              # 回到进入 ally 前
save = engine.save()                    # JSON 可序列化存档
```
