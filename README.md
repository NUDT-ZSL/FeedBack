# 分布式任务调度协调模块（离线模拟版）

一个**只用 Python 标准库**实现的分布式任务调度"大脑"。协调器 `Scheduler`
负责在一组工作节点之间分配定时任务、发放并续约租约、在节点失联时自动重新
分配任务；工作节点只负责执行。模块**不连真实网络**——节点之间的消息传递
全部用对 `Scheduler` 的直接方法调用模拟，因此可以完全离线运行、确定性单测。

- Python 3.8+（仅标准库，无第三方依赖）
- 逻辑时钟（单调递增整数），不使用墙上时间，测试可注入
- 简化 cron 表达式：`*/n` 步长、逗号分隔多值、二者取并集
- 租约机制 + 心跳续约 + 失联自动故障转移
- JSON 文件快照保存/加载，加载时严格校验一致性
- 逐行 JSON 协议的命令行入口
- 59 个 unittest 用例

## 文件说明

| 文件 | 说明 |
|---|---|
| `scheduler.py` | 协调器核心：`Scheduler`、`Task`、`Node`、`SchedulerError` |
| `main.py` | 命令行入口：从 stdin 逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_scheduler.py` | unittest 测试套件（调度、租约、故障转移、边界、快照、CLI） |
| `README.md` | 本文档 |

## 快速开始

### Python API

```python
from scheduler import Scheduler

s = Scheduler(lease_duration=3)      # 租约长度 3 个逻辑时钟单位
s.register_task("t1", "*/5")         # 每 5 个时钟单位触发
s.register_task("t2", "7")           # 只在第 7 个时钟单位触发
s.add_node("n1")
s.add_node("n2")

s.tick(5)                            # 时钟 0 -> 5
s.acquire("n1")                      # ["t1"]，t1 租约到期时刻 = 5 + 3 = 8
s.acquire("n2")                      # []，同一时钟单位不能重复分配
s.heartbeat("n1")                    # 续约 n1 持有的全部任务
s.complete("n1", "t1")               # 完成上报，释放租约

s.tick(5)                            # 时钟 10
s.acquire("n2")                      # ["t1"]，下一个触发点可再次分配
```

### 命令行

```bash
python main.py < commands.txt
```

每行一条 JSON 命令，每行输出一条 JSON 结果（成功含 `"ok": true`，错误含
`"ok": false` 和 `error` 字段）。单条命令出错不会中断进程：

```jsonlines
{"op": "register_task", "task_id": "t1", "schedule": "*/5"}
{"op": "add_node", "node_id": "n1"}
{"op": "tick", "n": 5}
{"op": "acquire", "node_id": "n1"}
{"op": "save", "path": "snapshot.json"}
{"op": "load", "path": "snapshot.json"}
{"op": "status"}
{"op": "dump"}
```

## 语义说明（重要）

### 调度表达式

| 表达式 | 含义 |
|---|---|
| `"7"` | 只在逻辑时钟第 7 个单位触发 |
| `"*/5"` | 从第 5 个单位起每 5 个单位触发：5, 10, 15, ... |
| `"3,7"` | 在第 3、第 7 个单位触发（逗号分隔多值） |
| `"*/5,7"` | 上述集合取并集：5, 7, 10, 15, ... |

- 不支持范围语法 `a-b`；每段首尾的空白会被忽略。
- 一个表达式中最多一个 `*/n` 分段；`n` 必须是正整数。
- **时钟 0 永不触发任何任务**（`"0"` 与显式 0 分段均为非法表达式）。
- 空串、非数字、负数、空分段（`"1,"`）都会抛 `SchedulerError`。

### 租约过期边界规则

采用**闭区间失效**：

> 当 `当前逻辑时钟 >= lease_expire_at` 时，租约视为过期。
> 即 `lease_expire_at == 当前时钟` 的那一刻，任务就已经失联、可重新分配。

例如租约长度为 3、在时钟 5 acquire：`lease_expire_at = 8`。时钟 7 时租约
**仍有效**（其他节点不能抢）；时钟 8 时**立即失效**，owner 清空，任务回到
可分配状态。过期判定在每次 `tick()` 推进之后和每次 `acquire()` 之前执行。

### 互斥与同一时钟单位去重

- 任务在某个时钟单位**最多被一个节点持有一次**。即使两个节点在同一时钟
  单位连续 `acquire`，后调用的节点也拿不到已分配的任务（任务表在单次
  acquire 中即时更新，不存在先收集后提交的窗口）。
- 即使持有者在同一个时钟单位内 `complete()` 或被 `remove_node()`，该任务
  在本时钟单位也不会再次被分配，必须等到下一个触发点。任务记录用
  `last_fired_at` 保证这一点。
- 租约未过期的任务不能被其他节点抢占。
- 触发点错过即跳过：`"7"` 在时钟 7 无人 acquire，则时钟 8 不会补分配。

### 心跳与故障转移

- `heartbeat(node_id)` 把**该节点自己持有的**全部任务的
  `lease_expire_at` 刷新为 `当前时钟 + 租约长度`；不能续约别人的任务。
- 节点注册时刻记为首次心跳；心跳同时更新节点的 `last_heartbeat`。
- 超过租约长度没有心跳的节点，其任务在**下一次 `tick()` 或 `acquire()`**
  时被回收（owner 清空、从节点任务集合移除）。
- `remove_node(node_id)` 主动下线会**立即**释放全部任务并删除节点。
- 失联判定以**每个任务的 `lease_expire_at`** 为准（心跳逐任务续约），
  节点级 `last_heartbeat` 主要用于观测。

## API 参考

所有领域错误都抛 `SchedulerError`。

| 方法 | 说明 |
|---|---|
| `Scheduler(lease_duration=3)` | 构造，租约长度必须为正整数 |
| `register_task(task_id, schedule)` | 注册任务；重复 id 报错，不静默覆盖 |
| `add_node(node_id)` | 注册节点（记一次心跳）；重复 id 报错 |
| `remove_node(node_id)` | 节点下线，立即释放全部任务，返回被释放 id 列表 |
| `tick(n=1)` | 时钟前进 n（正整数），随后回收过期租约，返回新时钟 |
| `heartbeat(node_id)` | 续约该节点持有的全部任务，返回续约的 id 列表 |
| `acquire(node_id)` | 先回收过期租约，再分配所有到期可领的任务，返回 id 列表 |
| `complete(node_id, task_id)` | 完成上报；只有当前 owner 可上报 |
| `get_task(task_id)` | 任务详情字典（值拷贝） |
| `get_node(node_id)` | 节点详情字典（值拷贝） |
| `list_tasks()` / `list_nodes()` | 全部任务/节点详情，按 id 排序 |
| `get_orphaned_tasks()` | 当前时钟已到触发点、无 owner 且本单位未分配过的任务 id |
| `save(path)` / `Scheduler.load(path)` | JSON 快照保存/加载 |
| `snapshot()` / `Scheduler.restore(dict)` | 快照字典的导出/重建（不经过文件） |
| `clock` / `lease_duration` | 当前时钟 / 租约长度（只读属性） |

`get_task` 返回字段：

```python
{
  "task_id": "t1",
  "schedule": "*/5,7",
  "period": 5,                 # */n 的 n，没有则 None
  "ticks": [7],                # 显式列举的触发时钟（已排序）
  "owner": "n1",               # 未分配为 None
  "lease_expire_at": 8,        # 未分配为 None
  "last_fired_at": 5,          # 上次被分配（触发）的时钟
}
```

`get_node` 返回 `{"node_id", "last_heartbeat", "tasks"}`，其中 `tasks` 是
排序后的持有的 task_id 列表。

### orphaned 的语义

`get_orphaned_tasks()` 是**纯查询**，不触发失联回收。它返回当前时钟恰好
命中调度表达式、无 owner 且本时钟单位尚未被分配的任务——典型场景是任务
到了触发点但所有节点都没来 acquire。租约刚到期、但还没有任何一次
`tick()`/`acquire()` 触发回收的任务仍挂在原 owner 名下，不会出现在列表中。

## 快照格式与一致性校验

`save(path)` 写出 UTF-8 JSON：

```json
{
  "version": 1,
  "clock": 10,
  "lease_duration": 3,
  "tasks": [
    {"task_id": "t1", "schedule": "*/5", "owner": "n1",
     "lease_expire_at": 13, "last_fired_at": 10}
  ],
  "nodes": [
    {"node_id": "n1", "last_heartbeat": 10, "tasks": ["t1"]}
  ]
}
```

`load()` / `restore()` 会校验并在不通过时抛出带清晰信息的 `SchedulerError`：

- 文件不存在、不是合法 UTF-8、不是合法 JSON（带行列号）；
- 缺少字段、版本号不符、类型错误（含把 `true/false` 当整数）；
- `clock < 0`、租约长度非正、`lease_expire_at` 为负；
- 任务 `owner` 指向不存在的节点；节点持有不存在的任务；
- 任务 owner 与节点任务集合**双向引用**必须一致；
- 有 owner 必须有 `lease_expire_at`，无 owner 不允许带到期时刻；
- `last_fired_at` 必须命中该任务自己的调度表达式，且不超过当前时钟。

## CLI 操作一览

| op | 参数 |
|---|---|
| `register_task` | `task_id`, `schedule` |
| `add_node` | `node_id` |
| `remove_node` | `node_id` |
| `heartbeat` | `node_id` |
| `tick` | `n`（可省略，默认 1） |
| `acquire` | `node_id` |
| `complete` | `node_id`, `task_id` |
| `status` | 无；返回时钟、租约配置与全量任务/节点 |
| `orphaned` | 无 |
| `save` / `load` | `path`（load 用快照替换当前进程内状态） |
| `dump` | 无；输出原始快照结构 |

## 运行测试

```bash
python -m unittest -v test_scheduler
```

测试覆盖：

- 表达式解析（合法/非法全量样例）、重复注册与空 id；
- 基本分配（步长、单点、多值、并集、时钟 0 不触发）；
- 互斥：同单位双节点连续 acquire、租约内不可抢占、下线/完成后同单位不重放；
- 租约边界：到期前一单位有效、`clock == lease_expire_at` 恰好失效、逐步推进；
- 心跳：续约自己的任务、不能续约别人的、未注册节点报错、续约后跨过原到期点；
- 故障转移：失联后任务在下一个触发点被其他节点接走，节点"复活"也拿不回；
- `complete` 越权上报、未分配任务上报、未知 id；
- 状态查询、排序、返回值防篡改、orphaned 各场景；
- 快照往返一致、坏 JSON/坏 UTF-8/缺字段/坏版本/悬空引用/双向不一致/负数；
- 3 节点 20 任务、时钟推进 30 步的轮流 acquire 模拟，逐单位校验全局唯一持有；
- CLI 全链路与错误 JSON 化。

## 设计取舍

- **逻辑时钟而非真实时间**：所有时序行为确定性可复现，适合单测与回放。
- **只模拟消息传递**：没有 socket/线程/锁；"网络"就是方法调用，调用串行
  执行，因此互斥由"分配即时落表"天然保证。
- **错过触发点不补跑**：简化 cron 的常见取舍，避免暂停期间产生大量积压执行。
- **闭区间失效（`>=`）**：租约长度精确表示"持有的时钟单位数"，边界无歧义。
