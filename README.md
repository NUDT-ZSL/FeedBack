# deptracker — 可嵌入的因果依赖追踪内核

用于**配置变更**与**构建产物失效判断**的轻量内核。上游不断注册
“产物—输入”依赖关系并报告输入指纹变化，内核增量维护失效产物集合，
可以随时回答：

- **现在哪些产物需要重建？** → `get_rebuild_plan()`（拓扑序）
- **某个产物为什么被判为失效？** → `explain_invalid(artifact)`（原因链）

纯 Python 标准库实现（Python 3.8+），无第三方依赖，可离线运行、可单测。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `deptracker.py` | 内核模块：`Edge` dataclass 与 `DependencyTracker` |
| `main.py` | 命令行入口：标准输入逐行 JSON 命令，逐行输出 JSON 结果 |
| `test_deptracker.py` | `unittest` 测试套件（61 个用例） |

## 核心概念

### 依赖边 `Edge`

```python
@dataclass(frozen=True)
class Edge:
    artifact: str   # 产物标识，非空字符串
    input: str      # 输入标识，非空字符串（可以是另一个产物）
    kind: str       # 输入类型：'file' 或 'env'
```

`artifact` / `input` 为空或 `kind` 非法时，`Edge` 构造即抛 `ValueError`
并指明具体字段。

### 指纹与确认状态

- 每个输入有一个**当前指纹**（非空字符串，由调用方算好后通过
  `report_fingerprint(input, fp)` 传入）；
- 每个产物对它依赖的每个输入各记录一个**已确认指纹**——即该产物上一次
  `mark_rebuilt` 时所依据的输入指纹；
- 产物的当前指纹由调用方在重建后通过
  `set_artifact_fingerprint(artifact, fp)` 设置。

### 失效判定

产物 `A` **干净**，当且仅当它的每条依赖边 `(A, inp)` 都满足：

1. `A` 对 `inp` 的已确认指纹存在且等于 `inp` 的当前指纹；
2. 若 `inp` 本身是产物，则 `inp` 也干净。

否则 `A` 失效。产物可以作为其他产物的输入，因此失效沿
“产物 → 输入 → 产物”的链向上游传播，链上任意一环失效，上游全部失效。

### 失效传播（增量）

`report_fingerprint` 报告的指纹与之前不同时，内核沿反向依赖边做 BFS，
把所有直接 / 间接依赖该输入的产物标为失效：

- **菱形依赖去重**：访问集合保证每个产物只标记一次；
- **与传播顺序无关**：失效是一个集合，BFS 顺序不影响结果；
- **指纹没变不产生失效**：报告相同指纹是空操作；
- **指纹改回已确认值会“愈合”**：产物恢复干净（此时做一次全量重算，
  见下文“设计取舍”）。

### 重建计划

`get_rebuild_plan()` 返回当前需要重建的产物列表：

- 只包含**所有产物依赖都已确认干净、自身处于失效状态**的产物
  （依赖还脏着的产物会被阻塞，等下游先重建）；
- 按拓扑序排列：任何产物都排在它所依赖的产物之后；并列时按标识字典序，
  输出确定；
- 空图或无失效时返回空列表。

### 失效解释

`explain_invalid(artifact)` 返回从该产物到**最近失效输入**的路径
（BFS 最短链），链上每个节点带类型（`file` / `env` / 产物）与
指纹变化情况（`confirmed_fingerprint` vs `current_fingerprint`，
状态为 `changed` / `unconfirmed` / `unreported` 等），并给出
`root_cause` 与一句话 `message`。

### 重建确认

```python
tracker.set_artifact_fingerprint("app", "h_new")  # 调用方算好新指纹
tracker.mark_rebuilt("app")                        # 确认重建
```

`mark_rebuilt` 把产物所有输入的**当前指纹**记录为已确认指纹，产物恢复干净，
下游产物随之可能进入可重建计划。前置条件不满足时抛错：

- 产物不存在 → `UnknownArtifactError`；
- 未设置产物指纹 → `DependencyError`（提示先调 `set_artifact_fingerprint`）；
- 有输入尚未报告指纹 → `DependencyError`；
- 某个产物依赖仍失效 → `DependencyError`（提示先重建依赖）。

### 环检测

`add_edge` 注册时检测环，发现即抛 `CycleError`，异常的 `cycle` 属性与
错误信息都包含环上的节点序列（如 `d -> a -> b -> c -> d`），
且被拒绝的边不会进入图。

## 内存上限策略（max_edges）

构造时指定 `DependencyTracker(max_edges=N)`：

- **策略：拒绝本次注册并抛出 `EdgeLimitError`，绝不静默丢弃。**
  被拒绝的边不改变图状态，错误信息包含上限值与被拒的边；
- 重复注册同一条边是幂等空操作，不占用配额；
- `max_edges=0` 表示禁止注册任何边；
- `max_edges=None`（默认）为**精确模式**：无边数上限，用于小规模对照。

## 持久化（JSON 快照）

```python
tracker.save("state.json")
tracker = DependencyTracker.load("state.json")
```

快照包含：依赖边、输入指纹、产物指纹、每个产物对每个输入的确认状态、
`max_edges` 与格式版本号。`load` 做完整一致性校验，任何问题都抛
`SnapshotError` 并给出具体原因，不静默吞掉：

- 文件不可读 / 不是合法 JSON / 顶层不是对象；
- 缺少 `version` / `edges` / `inputs` / `artifacts` 等必需字段，版本不匹配；
- 依赖边引用了未声明的产物或输入；
- 指纹为空字符串（只允许非空字符串或 `null`）；
- 确认状态引用了不存在的依赖输入；
- 图中存在环、边数超过快照声明的 `max_edges`。

## 命令行入口

```bash
python main.py [--max-edges N] < commands.jsonl
```

从标准输入逐行读 JSON 命令，每条命令输出一行 JSON 结果；
错误同样以 JSON 返回（含 `error` 与 `error_type` 字段），不会中断后续命令。

| 命令 | 参数 | 结果 |
| --- | --- | --- |
| `add_edge` | `artifact`, `input`, `kind`(可选，默认 `file`) | `{"ok":true,"added":true}` |
| `report` | `input`, `fingerprint` | `{"ok":true,"invalidated":[...]}` |
| `set_artifact` | `artifact`, `fingerprint` | `{"ok":true,"invalidated":[...]}` |
| `rebuilt` | `artifact` | `{"ok":true}` |
| `plan` | — | `{"ok":true,"plan":[...]}` |
| `explain` | `artifact` | `{"ok":true,"invalid":true,"chain":[...],...}` |
| `stats` | — | `{"ok":true,"artifacts":N,...}` |
| `save` | `path` | `{"ok":true}` |
| `load` | `path` | `{"ok":true}`（替换当前状态） |
| `dump` | — | `{"ok":true,"state":{...快照...}}` |

示例：

```bash
$ printf '%s\n' \
  '{"cmd":"add_edge","artifact":"app","input":"lib"}' \
  '{"cmd":"add_edge","artifact":"lib","input":"src.c"}' \
  '{"cmd":"report","input":"src.c","fingerprint":"v1"}' \
  '{"cmd":"plan"}' \
  '{"cmd":"set_artifact","artifact":"lib","fingerprint":"h1"}' \
  '{"cmd":"rebuilt","artifact":"lib"}' \
  '{"cmd":"plan"}' | python main.py
{"ok": true, "added": true}
{"ok": true, "added": true}
{"ok": true, "invalidated": []}
{"ok": true, "plan": ["lib"]}
{"ok": true, "invalidated": []}
{"ok": true}
{"ok": true, "plan": ["app"]}
```

## API 速览

```python
from deptracker import DependencyTracker

t = DependencyTracker(max_edges=10000)   # 或 None = 精确模式
t.add_edge("app", "lib", "file")         # -> bool（重复注册返回 False）
t.report_fingerprint("src.c", "v2")      # -> 新标脏的产物列表
t.set_artifact_fingerprint("lib", "h1")  # -> 新标脏的产物列表
t.mark_rebuilt("lib")                    # 确认重建
t.get_rebuild_plan()                     # -> ["lib", "app", ...]（拓扑序）
t.explain_invalid("app")                 # -> 失效原因链
t.is_dirty("app")                        # -> bool
t.remove_artifact("lib")                 # 删除产物及其出边
t.stats()                                # 规模与状态统计
t.save("state.json"); DependencyTracker.load("state.json")
```

## 运行测试

```bash
python -m unittest test_deptracker -v
```

覆盖：环检测（自环 / 双节点 / 长链、环序列报告）、失效传播（链式、
菱形去重、顺序无关、指纹未变不标脏、改回愈合）、计划排序（多层大图
拓扑性质）、解释链（file/env 类型与指纹变化）、`max_edges`（超限拒绝、
0 上限、精确模式）、快照往返与各类损坏文件、命令行入口全命令。

## 设计取舍

- **失效增量、愈合重算**：指纹上报是热路径，只做反向 BFS 增量标脏
  O(可达子图)；“愈合”类事件（指纹改回已确认值、`mark_rebuilt`、
  快照加载）较少发生，此时按拓扑序全量重算失效集合 O(V+E)，
  保证正确性优先。
- **已确认指纹按“产物 × 输入”记录**：同一个输入被不同产物消费时，
  各自确认各自的基线——A 重建确认不影响 B 看到的未确认变化。
- **确定性输出**：计划与解释在并列时按标识字典序，便于测试与比对。
