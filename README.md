# depgraph — 依赖图增量构建引擎

一个纯 Python（无第三方依赖，Python 3.8+）的有向无环依赖图引擎，解决一个
经典问题：**一张有几十个构建节点的图，上游节点的指纹变了，下游哪些需要重跑？
现在能跑哪些？为什么某个节点被判定为需要重跑？**

- 节点带唯一 `node_id`、调用方算好的 `fingerprint` 和依赖列表 `deps`
- 显式迭代式找环（不靠递归，500 节点的环也能准确报错并给出环序列）
- 指纹变化沿反向边传播，**待定状态显式维护、逐节点确认**（菱形依赖只标记
  一次，反复更新幂等，结果与传播顺序无关）
- `get_plan()` 按拓扑序给出**此刻**可执行节点——上游没确认完，下游不进计划
- `get_affected()` / `explain_dirty()` 排查影响面与脏因，菱形给出多条路径
- JSON 快照 `save` / `load`，加载时做完整一致性校验
- `main.py` 逐行 JSON 命令行协议，错误也以 JSON 返回（含 `error` 字段）

目录结构：

```
workspace/
├── depgraph/
│   ├── __init__.py      # 包入口，导出 DependencyGraph 与异常
│   └── engine.py        # 引擎实现
├── main.py              # 命令行入口（逐行 JSON 协议）
├── tests/
│   └── test_depgraph.py # 62 个 unittest 测试
└── README.md
```

## 语义说明（重要）

每个节点有**当前指纹**与**已确认指纹**，外加一个**显式待定标记**：

| 状态 | 含义 |
|------|------|
| `clean` | 当前指纹 == 已确认指纹，未处于待定 |
| `dirty` | 当前指纹 != 已确认指纹（自身内容变了） |
| `pending` | 两指纹一致，但上游变化尚未逐级确认完 |

**为什么 pending 是显式粘性状态？** A→B→C，改了 A 后：

1. `get_plan()` 先只给出 `["A"]`；
2. `mark_clean("A")` 确认 A 重跑完成，计划释放为 `["B"]`——**B 还没确认，
   C 不能出现在计划里**（pending 不会因为 A 变 clean 就自动消失）；
3. `mark_clean("B")` 后计划才出现 `["C"]`。

如果 pending 只靠"是否可达 dirty 节点"推导，第 2 步会把 B 误判为 clean、
C 错误进计划。这正是题面示例要求的门控语义。

新注册的节点从未确认过（已确认指纹为空），因此处于 `dirty`，需要先执行
再确认。

## 快速开始（Python API）

```python
from depgraph import DependencyGraph

g = DependencyGraph()
g.add_node("A", "fA1", [])
g.add_node("B", "fB1", deps=["A"])
g.add_node("C", "fC1", deps=["B"])
g.mark_clean("A")
g.mark_clean("B")
g.mark_clean("C")

g.update_fingerprint("A", "fA2")   # A dirty；B、C pending
g.get_plan()                       # ["A"]
g.mark_clean("A")
g.get_plan()                       # ["B"] —— B 未确认，C 被门控
g.mark_clean("B")
g.get_plan()                       # ["C"]
g.mark_clean("C")
g.get_plan()                       # []

g.get_affected("A")                # ["A", "B", "C"]（拓扑序）
g.explain_dirty("C")               # 全干净后为 []；脏时给出到脏源的路径
```

菱形依赖（`A → {B, C} → D`）：改 A 后 D 经两条路径受影响，但只被待定一次；
`explain_dirty("D")` 返回两条到最近根源的解释路径，每步带 `status`：

```python
g.update_fingerprint("A", "fA2")
g.explain_dirty("D")
# [[{"node": "D", "status": "pending"},
#   {"node": "B", "status": "pending"},
#   {"node": "A", "status": "dirty"}],
#  [{"node": "D", "status": "pending"},
#   {"node": "C", "status": "pending"},
#   {"node": "A", "status": "dirty"}]]
```

## API 参考

### `DependencyGraph`

| 方法 | 说明 |
|------|------|
| `add_node(node_id, fingerprint, deps=None)` | 注册节点。重复 id、自依赖、重复依赖、空 id/指纹、依赖不存在均抛错；缺依赖错误列出所有缺失 id |
| `remove_node(node_id)` | 删除节点并从所有 deps 中摘除，重算受影响区域的待定状态。存在返回 `True`，不存在返回 `False`（不静默成功） |
| `update_fingerprint(node_id, fingerprint)` | 更新当前指纹；与当前值相同是无操作（返回 `False`），不同则置脏并向全部依赖者传播待定 |
| `mark_clean(node_id)` | 确认重跑完成：已确认指纹更新为当前指纹、清待定。仍有 dirty/pending 的传递依赖时抛错并列出它们 |
| `get_plan()` | 此刻需要重跑的节点，拓扑序；只含"自身 dirty/pending 且直接依赖全部 clean"的节点。空计划返回 `[]` |
| `get_affected(node_id)` | 受该节点影响的全部节点（含自身），拓扑序 |
| `explain_dirty(node_id)` | 到最近非 clean 根源的所有路径；每步带 `node` 与 `status`；clean 节点返回 `[]` |
| `status_of(node_id)` / `get_status()` | 单节点 / 全量状态（`clean`/`dirty`/`pending`） |
| `topo_sort()` | 全图拓扑序（依赖在前），同层按注册顺序稳定输出 |
| `find_cycle()` | 迭代式三色 DFS 找环，返回首尾相同的节点序列（如 `["x","y","x"]`）或 `None` |
| `save(path)` / `load(path)` | JSON 快照写入（临时文件 + 原子替换）/ 加载并校验 |
| `to_dict()` / `from_dict(data)` | 快照字典的导出/重建（加载即校验） |

### 异常

`GraphError` 是基类，其余都继承它，便于统一捕获：

- `ValidationError` —— 空 id/指纹、deps 类型错、重复依赖、自依赖
- `DuplicateNodeError` —— 重复注册同一 id
- `NodeNotFoundError` —— 引用不存在的节点（错误信息列出缺失 id）
- `CyclicDependencyError` —— 图成环，`.cycle` 属性是环上节点序列
- `InvalidSnapshotError` —— 快照损坏/缺字段/不一致

### 快照格式

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "A",
      "fingerprint": "fA2",
      "confirmed_fingerprint": "fA1",
      "status": "dirty",
      "deps": []
    }
  ]
}
```

`status` 是写出的脏状态，加载时**必须与指纹匹配**：`dirty` ⇔ 两个指纹不同。
加载校验清单：根结构与必需字段、字段类型、id/指纹非空、deps 无重复/不自依赖、
依赖节点存在、显式找环、脏状态与指纹一致。节点数组允许任意存储顺序。
`status` 字段缺失时按指纹推导（兼容）。

## 命令行协议（main.py）

从标准输入逐行读 JSON 对象，每行一条结果 JSON。空行忽略；坏 JSON 行、
未知命令、业务错误都返回一行含 `error` 字段的 JSON，进程继续处理后续命令。

| `cmd` | 参数 | 成功返回（节选） |
|-------|------|------------------|
| `add` | `id`, `fingerprint`, `deps?` | `{"ok": true}` |
| `remove` | `id` | `{"ok": true, "removed": true/false}` |
| `update` | `id`, `fingerprint` | `{"ok": true, "changed": true/false}` |
| `clean` | `id` | `{"ok": true}` |
| `plan` | — | `{"plan": [...]}` |
| `affected` | `id` | `{"affected": [...]}` |
| `explain` | `id` | `{"paths": [[{"node","status"}], ...]}` |
| `status` | — | `{"status": {id: state}}` |
| `save` / `load` | `path` | `{"ok": true}` / `{"nodes": N}` |
| `dump` | — | `{"graph": {完整快照}}` |

示例（PowerShell 下用单引号包 JSON、bash 下用 `printf`）：

```bash
printf '%s\n' \
  '{"cmd":"add","id":"A","fingerprint":"fA1"}' \
  '{"cmd":"add","id":"B","fingerprint":"fB1","deps":["A"]}' \
  '{"cmd":"clean","id":"A"}' \
  '{"cmd":"update","id":"A","fingerprint":"fA2"}' \
  '{"cmd":"plan"}' \
  '{"cmd":"explain","id":"B"}' \
  | python main.py
```

输出：

```json
{"ok": true, "cmd": "add", "id": "A"}
{"ok": true, "cmd": "add", "id": "B"}
{"ok": true, "cmd": "clean", "id": "A"}
{"ok": true, "cmd": "update", "id": "A", "changed": true}
{"ok": true, "cmd": "plan", "plan": ["A"]}
{"ok": true, "cmd": "explain", "id": "B", "paths": [[{"node": "B", "status": "pending"}, {"node": "A", "status": "dirty"}]]}
```

错误示例：

```json
{"error": "节点 'C' 还有未确认干净的依赖: ['A(dirty)', 'B(pending)']", "type": "GraphError", "cmd": "clean", "id": "C"}
{"error": "依赖的节点不存在，缺失的 id: ['nope']", "type": "NodeNotFoundError", "cmd": "add", "id": "X"}
{"error": "快照文件不是合法 JSON（第 1 行第 2 列）: Expecting property name enclosed in double quotes", "type": "InvalidSnapshotError", "cmd": "load"}
```

## 设计要点

- **显式迭代式环检测**：三色标记 DFS 用显式栈 `(节点, 下一条边下标)`，
  不占 Python 递归栈；测试含 500 节点大环与 300 层深链。
- **传播去重与顺序无关**：反向 BFS 用 `visited` 集合，菱形汇合节点只入队
  一次；待定标记是集合并集，任意顺序的同批更新终态相同。
- **粘性 pending + 逐节点门控**：保证"上游没确认、下游不进计划"。
- **删除的状态回收**：只在受删除影响的子图内重算待定，避免误洗白无关链路上
  图中已无 dirty 源的粘性 pending；菱形另一分支仍连通时待定保留。
- **稳定输出**：拓扑序同层按注册顺序；解释路径按 `(长度, 字典序)` 排序。
- **原子快照**：先写 `path.tmp` 再 `os.replace`，加载失败带行列号/字段名。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

预期：`Ran 62 tests ... OK`。覆盖注册校验、长环/深链检测、链与菱形传播、
顺序无关、计划门控与排序、解释链（直连/链/菱形/多脏源/部分确认后）、
删除与待定回收、快照往返与 10 类坏快照、几十节点四层图的多轮更新综合验收，
以及 CLI 全协议端到端。

## 边界情况对照

| 边界情况 | 行为 |
|----------|------|
| 空图 | `get_plan()` / `topo_sort()` 返回 `[]`，快照可往返 |
| 单节点 | 注册即 dirty，clean 后计划为空 |
| 依赖不存在 | `NodeNotFoundError`，信息列出全部缺失 id |
| 重复添加 id | `DuplicateNodeError` |
| 删除不存在节点 | 返回 `False`（CLI 回 `removed: false`，不是错误） |
| 更新不存在节点 | `NodeNotFoundError` |
| 指纹没变 | 无操作，返回 `False`，不产生脏标记 |
| 成环 | `CyclicDependencyError`，`.cycle` 给出环序列 |
| 菱形传播 | 汇合节点只待定一次，解释给出两条路径 |
| 计划为空 | 返回 `[]` |
| clean 时依赖未干净 | 抛错并列出每个阻塞依赖及其状态 |
| 坏快照 | `InvalidSnapshotError`，指出行列号/字段/节点/缺失 id |
