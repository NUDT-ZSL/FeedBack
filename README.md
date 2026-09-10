# 增量式依赖图引擎（depgraph）

在构建系统或数据管道里跟踪“谁依赖谁”，当某个节点内容变化时，精确算出
需要重新执行的**最小节点集合**，并按拓扑顺序给出重算计划。纯 Python
标准库实现，无第三方依赖，可离线运行。

## 它解决什么问题

朴素做法每次都全量重算。本引擎把工作分成三段：

1. **注册**：把节点（唯一 id、内容指纹、依赖列表）注册进图，图始终是
   有向无环图（DAG），形成环会立即报错并指出环上的节点；
2. **标脏**：某节点指纹变化时，只有它自己和沿反向依赖边能到达的节点
   被标记（菱形依赖只标记一次，结果与传播顺序无关）；
3. **出计划**：`get_plan()` 只返回“依赖都已确认干净、且自身脏/待定”
   的节点，按拓扑序排列。调用方按计划重算、逐个确认，计划自动沿依赖
   方向推进，直到为空。

## 环境要求

- Python 3.9+，仅用标准库（`json`、`os`、`collections`、`heapq`）。

## 快速上手（作为库使用）

```python
from depgraph import DependencyGraph

g = DependencyGraph()
g.add_node("a", "hash-a")
g.add_node("b", "hash-b", deps=["a"])
g.add_node("c", "hash-c", deps=["b"])

g.update_fingerprint("a", "hash-a-v2")   # a 内容变了

g.get_plan()        # ["a"]  —— b/c 还在等 a
g.mark_clean("a")   # 调用方重算完 a

g.get_plan()        # ["b"]
g.mark_clean("b")

g.get_plan()        # ["c"]
g.mark_clean("c")

g.get_plan()        # []  —— 全部追平
```

菱形依赖不会重复重算：

```python
g.add_node("x", "hx")
g.add_node("m1", "hm1", deps=["x"])
g.add_node("m2", "hm2", deps=["x"])
g.add_node("y", "hy", deps=["m1", "m2"])

g.update_fingerprint("x", "hx2")
g.get_affected("x")  # ["x", "m1", "m2", "y"] —— y 经两条路径到达，只出现一次
```

排查“这个节点为什么脏”：

```python
g.explain_dirty("y")
# [["y", "m1", "x"], ["y", "m2", "x"]]
# 读法：y 依赖 m1，m1 依赖的 x 变脏了；m2 这条链同理。
```

## 核心概念：三种状态

每个节点保存**当前指纹**与**已确认指纹**，外加一个状态：

| 状态 | 含义 | 如何进入 / 离开 |
|------|------|----------------|
| `clean` | 已确认与当前内容一致 | 新建即 clean；`mark_clean()` 回到 clean |
| `dirty` | **脏源**：当前指纹 ≠ 已确认指纹，自身内容变了 | `update_fingerprint()` 传入不同指纹 |
| `pending` | **待定**：自身指纹没变，但传递依赖中有脏源 | 标脏时沿反向边 BFS 传播 |

**待定状态是“黏性”的**。链条 `a -> b -> c` 中 a 变脏后 b、c 待定；
调用方重算并 `mark_clean("a")` 后，b、c **仍然待定** —— 它们还没用
新的 a 重算。每个节点只在自己被重算确认后才回到 clean。这保证了
`get_plan()` 不会漏掉任何一次必要重算。

**重算计划 = 陈旧集合（dirty ∪ pending）的“就绪前沿”**：

- 自身 dirty/pending；
- **所有**直接依赖当前都是 clean。

不满足第二条的节点不会出现在计划里（依赖还没处理完）。并列节点按 id
升序，输出完全确定。

## API 一览

`DependencyGraph`（`depgraph.engine`）：

| 方法 | 说明 |
|------|------|
| `add_node(node_id, fingerprint, deps=None)` | 注册节点；新节点默认 clean |
| `remove_node(node_id)` | 删除节点，并从其他节点的依赖列表中摘除 |
| `update_fingerprint(node_id, fingerprint)` | 更新指纹；变化则标脏并传播，返回是否变化 |
| `mark_clean(node_id)` | 确认该节点已按当前内容重算完毕 |
| `get_plan()` | 当前可重算节点，拓扑序（依赖在前） |
| `get_affected(node_id)` | 该节点变化会影响的全部节点（含自身），结构查询 |
| `explain_dirty(node_id)` | 到最近脏源的解释路径列表；clean 返回 `[]`，dirty 返回 `[[id]]` |
| `save(path)` / `load(path)` | JSON 快照原子写入 / 加载并完整校验 |
| `to_dict()` / `from_dict(raw)` | 快照字典序列化 / 反序列化 |
| `get_status(node_id)` | 单节点状态：指纹、确认指纹、state、deps |
| `list_nodes()` / `len(g)` / `node_id in g` | 辅助查询 |

**参数约束**：节点 id 与指纹都是非空字符串；`deps` 中不能有空值、
重复项、自身 id，且被依赖节点必须已存在。违反约束抛出明确异常：

```
DepGraphError
├── NodeNotFoundError      # 引用了不存在的节点
├── DuplicateNodeError     # 重复添加同一 id
├── InvalidNodeError       # 空 id/空指纹/自依赖/重复依赖/类型错误
├── CycleError             # 成环（异常对象带 cycle 列表，首尾相同）
└── SnapshotError          # 快照损坏、缺字段或一致性校验失败
```

关于环检测：由于只能添加**新**节点且其依赖必须指向已有节点，正常的
增量注册不可能形成环；环检测真正发挥作用的地方是**加载外部快照**
（快照里的边是一次性给出的）。`CycleError.cycle` 形如
`["a", "b", "c", "a"]`，含义是 `a -> b -> c -> a`。

## JSON 快照格式

```json
{
  "format_version": 1,
  "nodes": [
    {
      "id": "a",
      "fingerprint": "hash-a-v2",
      "confirmed_fingerprint": "hash-a",
      "state": "dirty",
      "deps": []
    }
  ]
}
```

加载时依次校验：JSON 合法性 → 必需字段与类型 → id/指纹非空 →
重复 id / 重复依赖 / 自依赖 → 依赖目标存在 → 环 → 状态与指纹及传播
闭包一致。任何一项失败都抛 `SnapshotError` 并指出具体节点/字段，
不会静默忽略或返回半成品图。`state` 字段可省略（旧格式），此时由
两个指纹和传播闭包自动派生。保存采用“写临时文件 + 原子替换”，不会
留下写坏的快照。

## 命令行入口

`main.py` 从标准输入逐行读取 JSON 命令，每行输出一条 JSON 结果：

```bash
python main.py
```

命令格式：`{"op": "<操作>", ...}`。支持的操作：

| op | 参数 | 成功结果（除 `ok: true` 外） |
|----|------|------------------------------|
| `add` | `id`, `fingerprint`, `deps?` | — |
| `remove` | `id` | — |
| `update` | `id`, `fingerprint` | `changed: bool` |
| `clean` | `id` | — |
| `plan` | — | `plan: [...]` |
| `affected` | `id` | `affected: [...]` |
| `explain` | `id` | `paths: [[...]]` |
| `nodes` | — | `nodes: [...]` |
| `status` | `id` | `node: {...}` |
| `save` | `path` | `path` |
| `load` | `path` | `path`, `nodes` |
| `dump` | — | `snapshot: {...}` |

错误统一为：`{"ok": false, "error": "中文错误信息", "type": "异常类型"}`，
环错误还会带 `cycle`。单条命令失败不影响后续命令；空行跳过。

示例（Git Bash）：

```bash
printf '%s\n' \
  '{"op":"add","id":"a","fingerprint":"h1"}' \
  '{"op":"add","id":"b","fingerprint":"h2","deps":["a"]}' \
  '{"op":"update","id":"a","fingerprint":"h1x"}' \
  '{"op":"plan"}' \
  '{"op":"clean","id":"a"}' \
  '{"op":"plan"}' \
  | python main.py
```

输出：

```json
{"ok": true}
{"ok": true}
{"ok": true, "changed": true}
{"ok": true, "plan": ["a"]}
{"ok": true}
{"ok": true, "plan": ["b"]}
```

Windows PowerShell 下可用管道逐行传入，或把命令写在文本文件里
`Get-Content commands.txt | python main.py`。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

测试覆盖（75 个用例）：

- 注册/删除的全部边界：空图、单节点、重复 id、缺依赖节点、自依赖、
  重复依赖、删除不存在的节点、失败注册的原子回滚；
- 指纹更新：指纹不变不标脏、链式传播、菱形去重、注册/传播顺序无关性；
- 计划：门控（依赖未确认不上计划）、拓扑波次、宽图逐层推进、
  独立分支不被牵连；
- 溯源：clean 无路径、dirty 自路径、多脏源多路径；
- 快照：完整往返（含多种状态）、空快照、坏 JSON、缺字段、版本不符、
  缺依赖、重复 id、环、状态/指纹不一致；
- CLI：JSON 行协议、错误 JSON 化、save/load、真正走 stdin/stdout 的
  子进程端到端测试。

## 项目结构

```
workspace/
├── depgraph/
│   ├── __init__.py        # 对外导出 DependencyGraph 与异常
│   └── engine.py          # 引擎实现（正反向邻接表、传播、拓扑、快照）
├── main.py                # 命令行入口：逐行 JSON 协议
├── tests/
│   ├── test_engine.py     # 核心逻辑
│   ├── test_persistence.py# 环检测与快照往返
│   ├── test_cli.py        # 命令行端到端
│   └── test_regression_round2.py # 黏滞脏状态/三态往返/缺依赖回归
└── README.md
```

## 设计说明

- **正反向双邻接表**：`deps`（有序列表，保留注册顺序）与 `rdeps`
  （集合，支持 O(度数) 的反向传播）同步维护，删节点时双向摘边。
- **传播 = 反向 BFS + visited 去重**：结果就是脏源的反向可达闭包，
  与邻接表遍历顺序无关；菱形节点只改一次状态。
- **拓扑排序 = Kahn + 最小堆**：并列节点按 id 升序，计划结果对相同
  状态总是相同。
- **环检测 = 加边前正向可达性检查**：新增边 `u -> v` 前检查 v 是否
  已能到达 u；成环时 BFS 记录父指针还原具体环路径。
- **无递归遍历**：BFS/DFS 全部迭代实现，深图不会撞 Python 递归上限。
