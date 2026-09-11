# 因果一致性快照与部分回放引擎

一个**纯 Python 标准库**实现的离线引擎，用于分布式调试与确定性重放场景：

- 每个逻辑进程追加带**向量时钟**（vector clock）的事件；
- 引擎维护全局因果状态，可回答两类问题：
  1. **一致性快照**："某个时刻（每进程一个 seq 切点）的快照包含哪些事件？"
  2. **部分回放**："只回放某个/某些事件时，哪些事件必须一起回放才能保证因果完整？"

无第三方依赖、无网络 IO，可离线运行，带完整 `unittest` 测试。

- 要求：Python 3.10+（使用 `X | Y` 联合类型语法）
- 入口：库 API（`causal_engine` 包）或命令行（`main.py`）

---

## 1. 目录结构

```
workspace/
├── causal_engine/
│   ├── __init__.py        # 包入口，导出 CausalEngine / Event / 异常
│   ├── engine.py          # Event dataclass 与 CausalEngine 核心实现
│   ├── cli.py             # 逐行 JSON 命令处理
│   └── exceptions.py      # 异常体系
├── tests/
│   ├── helpers.py         # 三进程交叉依赖的标准场景
│   ├── test_engine.py     # 注册 / append / 查询 / 边界
│   ├── test_vector_clock.py
│   ├── test_snapshot.py   # 因果一致性快照
│   ├── test_replay.py     # 部分回放闭包
│   ├── test_persistence.py# save/load 往返与损坏文件
│   └── test_cli.py        # 逐行 JSON 协议
├── main.py                # 命令行入口
└── README.md
```

---

## 2. 向量时钟约定

事件的 `vector` 表示事件 **发生之前** 发送进程已知的各进程最大 `seq`
（不包含本事件自己）。例如在 p2 上、seq=2 的事件，若它依赖 p1 的第 1 个
事件：

```json
{"event_id": "b2", "process_id": "p2", "seq": 2,
 "vector": {"p1": 1, "p2": 1}}
```

`append` 时引擎校验：

1. `process_id` 必须已注册，`event_id` 全局唯一；
2. `seq` 必须等于该进程当前最大 seq + 1（从 1 开始，**不允许跳号/重复**）；
3. `vector` 的键必须都是已注册进程；
4. **发送者自己的分量必须恰好等于 `seq - 1`**；
5. 此前进程已知的所有进程必须继续出现（**知识单调，不能丢进程**）；
6. 各分量不能超过对应进程当前已经产生的最大 seq，也不能小于此前已知值
   （**知识单调，不能回退**）。

事件追加成功后，该进程的当前向量 = `max(旧向量, vector)`，自己的分量
更新为新 seq。

---

## 3. 库 API 快速上手

```python
from causal_engine import CausalEngine, Event

engine = CausalEngine()
engine.register_process("p1")
engine.register_process("p2")

engine.append(Event("a1", "p1", 1, {"p1": 0}))
engine.append(Event("b1", "p2", 1, {"p2": 0}))
# b2 是 p2 收到 a1 之后产生的事件
engine.append(Event("b2", "p2", 2, {"p1": 1, "p2": 1}, payload={"k": "v"}))
# p1 反过来同步了 p2 的知识
engine.append(Event("a2", "p1", 2, {"p1": 1, "p2": 1}))

# --- 一致性快照：每进程给一个 seq 上限（cut）---
snap = engine.consistent_snapshot({"p1": 1, "p2": 2})
print([e.event_id for e in snap])  # ['a1', 'b1', 'b2']

# cut 切掉了 b2 的前驱 a1 -> 抛 InconsistentSnapshotError
try:
    engine.consistent_snapshot({"p1": 0, "p2": 2})
except Exception as exc:
    print(type(exc).__name__, exc.missing_predecessors)
    # InconsistentSnapshotError ['a1']

# --- 部分回放：seed + 全部传递因果前驱的最小闭包 ---
print([e.event_id for e in engine.replay_closure(["b2"])])
# ['a1', 'b1', 'b2']

print(engine.get_state())
# {'total_events': 4, 'processes': {'p1': {'max_seq': 2, 'vector': {...}}, ...}}

# --- 持久化 ---
engine.save("state.json")
restored = CausalEngine.load("state.json")
assert restored.get_state() == engine.get_state()
```

### 方法一览

| 方法 | 说明 |
|---|---|
| `register_process(pid)` | 注册进程；重复注册抛 `DuplicateProcessError`（带冲突 id） |
| `append(Event(...))` | 校验并追加事件；非法即拒绝且状态不变 |
| `consistent_snapshot({pid: seq})` | 返回 cut 内、因果闭合的事件（按 `(process_id, seq)` 排序）；因果不完整抛 `InconsistentSnapshotError` |
| `replay_closure([ids])` | seeds 的传递因果闭包（最小回放集），自动去重；缺 id 抛 `UnknownEventError` |
| `get_event(id)` | 事件详情或 `None` |
| `list_events(pid)` | 某进程全部事件（seq 升序） |
| `get_state()` | 每进程最大 seq、每进程向量快照、全局事件总数 |
| `save(path)` / `CausalEngine.load(path)` / `dump()` / `from_dict(d)` | JSON 持久化与校验重建 |

### 异常体系

```
CausalEngineError
├── DuplicateProcessError      # 重复注册（.process_id）
├── UnknownProcessError        # 引用未注册进程（.process_id, .context）
├── InvalidEventError          # 字段 / seq / vector 非法，消息含具体进程与值
├── DuplicateEventError        # event_id 重复（.event_id）
├── UnknownEventError          # replay seed 不存在（.missing_ids）
├── InconsistentSnapshotError  # 快照缺前驱（.missing_predecessors, .required_by）
├── InvalidCutError            # cut 值非法或越界
└── PersistenceError           # JSON 文件损坏 / 字段缺失 / 内容不一致
```

---

## 4. 一致性快照语义

`consistent_snapshot(process_cut)` 中 `process_cut` 是 `process_id -> 最大纳入 seq`，
未出现的已注册进程按 cut=0 处理。返回集满足：

1. 每个进程只包含 `seq <= cut` 的事件；
2. **前缀性**：每进程纳入的都是 `1..cut` 的连续前缀；
3. **因果闭合**：被包含事件的每个因果前驱（vector 中 `> 0` 的分量指向的
   那个确定事件）也必须在集合内。

因为纳入的是前缀，只需检查是否存在"cut 内事件 → cut 外事件"的依赖边。
若有，抛 `InconsistentSnapshotError`：

- `missing_predecessors`：缺失的前驱 event_id 列表；
- `required_by`：每个缺失前驱分别被哪些 cut 内事件需要。

cut 本身非法（引用未注册进程、负数、非整数、超过当前最大 seq）抛
`InvalidCutError` / `UnknownProcessError`。

---

## 5. 部分回放（因果闭包）

`replay_closure(seeds)` 返回 seeds 与它们所有**传递因果前驱**的并集，
即保证回放因果完整所需的**最小集合**，按 `(process_id, seq)` 升序：

- seeds 为空 → 返回空列表；
- seeds 重复 → 自动去重；
- 任一 seed 不存在 → 抛 `UnknownEventError`，`missing_ids` 列出**全部**缺失 id；
- 菱形依赖中共享前驱只出现一次。

---

## 6. 命令行接口

从标准输入**逐行读 JSON**，每行一条命令，向标准输出写一行 JSON 结果。

```bash
python main.py < commands.txt
```

成功：

```json
{"ok": true, "cmd": "register", "result": {"process_id": "p1", "registered": true}}
```

失败（错误也以 JSON 返回，必含 `error`，另有 `error_type`）：

```json
{"ok": false, "cmd": "append", "error": "vector['p1'] = 99 ... exceeds ...",
 "error_type": "InvalidEventError"}
```

### 命令格式

| 命令 | 字段 |
|---|---|
| `register` | `process_id` |
| `append` | `event`：完整事件对象 `{event_id, process_id, seq, vector, payload?}` |
| `snapshot` | `process_cut`：`{pid: seq}` |
| `replay` | `seeds`：`[event_id, ...]` |
| `state` | 无 |
| `get` | `event_id`（不存在时 `result` 为 `null`） |
| `list` | `process_id` |
| `save` | `path` |
| `load` | `path`（成功后后续命令作用在新载入的引擎上） |
| `dump` | 无（输出完整持久化字典） |

### 示例会话

```bash
python main.py
{"cmd":"register","process_id":"p1"}
{"cmd":"register","process_id":"p2"}
{"cmd":"append","event":{"event_id":"a1","process_id":"p1","seq":1,"vector":{"p1":0}}}
{"cmd":"append","event":{"event_id":"b1","process_id":"p2","seq":1,"vector":{"p2":0}}}
{"cmd":"append","event":{"event_id":"b2","process_id":"p2","seq":2,"vector":{"p1":1,"p2":1}}}
{"cmd":"snapshot","process_cut":{"p1":1,"p2":2}}
{"cmd":"replay","seeds":["b2"]}
{"cmd":"save","path":"state.json"}
{"cmd":"state"}
```

空行被忽略；某一行 JSON 解析失败只产生一条错误响应，不影响后续行。
单条命令失败不会终止进程（退出码始终为 0，失败体现在响应的 `ok`/`error`）。

---

## 7. 持久化文件格式

`save(path)` 写入 UTF-8 JSON：

```json
{
  "format": "causal-engine-snapshot",
  "version": 1,
  "processes": ["p1", "p2"],
  "events": [ {"event_id": "...", "process_id": "...", "seq": 1,
               "vector": {"p1": 0}, "payload": null} ],
  "vectors": { "p1": {"p1": 2, "p2": 1}, "p2": {"p2": 2, "p1": 1} }
}
```

`load` 会完整校验并给出清晰错误（`PersistenceError`），不静默吞掉：

- 文件不存在 / JSON 语法损坏（带行列号）；
- 顶层结构或字段缺失、格式标识/版本不支持；
- 事件字段缺失、event_id 全局重复、事件归属未注册进程；
- 每进程 seq 必须从 1 连续（文件中事件按进程交错存放也能重建）；
- vector 引用未注册进程、分量超出该进程最大 seq、发送者分量 ≠ seq−1、
  丢掉此前已见进程、知识回退；
- `vectors` 中保存的每进程向量与按事件**重算**结果必须一致。

---

## 8. 运行测试

```bash
python -m unittest discover -s tests -v
```

覆盖：空引擎/单进程单事件、三进程交叉依赖场景下的快照成功与报错、
单 seed/多 seed/菱形依赖的最小闭包、vector 全部非法路径、seq 跳号与重复、
event_id 重复、save↔load 往返一致、各类损坏文件报错、CLI 协议与错误 JSON。

---

## 9. 设计取舍说明

- **vector 直接指向确定的前驱事件**：`vector[q] = k > 0` 表示依赖进程 q
  的第 k 个事件（不是抽象时钟比较），因此闭包与快照的成员判定都是 O(事件数)
  的确定性集合运算，不依赖事件接收顺序。
- **拒绝知识回退**：真实系统中向量时钟的分量单调不减。要求 vector 保留全部
  已见进程且不回退，能在 append 期就发现构造错误的时间戳。
- **快照不"自动修复" cut**：cut 因果不完整时明确报错并指出缺谁，而不是悄悄
  扩大 cut——调试场景下显式失败比返回一个超出请求范围的集合更有用。
- **load 时重算向量交叉校验**：即使文件里的 `vectors` 被手改，与事件历史
  不一致也无法通过加载。
