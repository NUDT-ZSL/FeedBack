# 逻辑时钟截止时间调度内核（Deadline Scheduler Kernel）

一个可嵌入任务编排 / 请求超时管理的小型调度内核：上游不断注册带截止时间的
任务，你可以随时查询「现在哪些任务已经超时」「下一个任务什么时刻触发」，
支持按任务来源批量取消、用逻辑时钟推进时间（**完全不依赖墙上时间**）。

* 纯 Python 标准库实现（`heapq` / `dataclasses` / `json` / `pathlib`）
* 无第三方依赖、无网络、离线可跑、可单测
* Python 3.10+（仅用到标准类型注解，3.8+ 基本也可运行）

## 文件

| 文件 | 说明 |
| --- | --- |
| `scheduler.py` | 内核：`Task`、`DeadlineScheduler`、错误类型、快照校验 |
| `main.py` | 命令行入口：标准输入逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_scheduler.py` | `unittest` 测试：堆操作、惰性删除、边界、上限、快照、CLI，以及数千任务随机差分测试 |
| `README.md` | 本文档 |

## 快速开始

```bash
# 跑测试
python -m unittest -v test_scheduler

# 命令行交互（每行一条 JSON 命令，每行一条 JSON 结果）
python main.py
```

```
$ python main.py
{"cmd":"register","task":{"task_id":"req-1","owner":"gateway","deadline":30,"priority":0,"payload":{"url":"/x"}}}
{"ok": true, "result": "registered", ...}
{"cmd":"advance","time":30}
{"ok": true, "result": "advanced", "clock": 30}
{"cmd":"poll"}
{"ok": true, "result": "polled", "tasks": [...], "count": 1}
```

## 作为库嵌入

```python
from scheduler import DeadlineScheduler, Task

s = DeadlineScheduler()                       # 精确模式：无活跃任务上限
s.register(Task("t1", "checkout", deadline=100, priority=0, payload={"n": 1}))
s.register(Task("t2", "checkout", deadline=50,  priority=2, payload=None))
s.register(Task("t3", "search",   deadline=50,  priority=1, payload=None))

s.cancel_by_owner("checkout")                 # 按来源批量取消 -> 1
s.advance_to(50)                              # 推进逻辑时钟
s.peek_next()                                 # -> 50（t3）
[s.task_id for s in s.poll_expired()]         # -> ["t3"]；t1/t2 已取消，不出现
s.peek_next()                                 # -> None
s.stats()
```

## 核心语义（契约）

### 1. Task

```python
Task(task_id: str, owner: str, deadline: int, priority: int, payload: Any = None)
```

* `task_id`：非空字符串，**内核运行期内全局唯一**。取消或超时弹出后，该 id
  仍不可再次注册（防止旧引用误挂到新任务上）。重复注册报 `SchedulerError`。
* `owner`：非空字符串，表示任务来源 / 提交方，用于批量取消。
* `deadline`：**绝对**逻辑时刻（不是相对时长），非负整数。
* `priority`：整数，数值越小越优先（允许负数）。
* `payload`：任意可 JSON 序列化对象（注册时即校验，`NaN/Infinity` 拒绝）。

### 2. 逻辑时钟

* 初始为 `0`，单调递增；`advance_to(t)` 只能推进到 `t >= clock`。
* 回退报错，错误信息同时给出当前值与尝试值，例如：
  `logical clock cannot go backwards: current=10, attempted=9`。
* 推进时钟本身不会自动回调任何东西；是否取任务由调用方显式 `poll_expired()`。
* 所有超时判定只看逻辑时钟，内核不读取任何系统时间。

### 3. 超时边界规则（重要）

> **`deadline <= clock` 即超时。deadline 恰好等于当前时钟的那一刻，任务
> 已经算超时。**

也就是说：deadline 表示「不晚于该时刻必须完成」，触发点本身到期。

* 初始时钟 `0` 时注册 `deadline=0` 的任务，立即 `poll_expired()` 就能取到。
* `clock=4, deadline=5` 时未到期；推进到 `5` 后到期。
* 测试 `test_boundary_deadline_equals_clock` / `test_deadline_zero_is_due_immediately`
  锁定该规则。

### 4. 堆与惰性删除

* 内部最小堆存三元组 `(deadline, priority, task_id)`，天然按
  **deadline 升序 → priority 升序 → task_id 字典序升序** 弹出。
* 取消（单个或按 owner 批量）只把任务从活跃表移到取消记录表，**不从堆中部
  删除**；堆条目在日后升到堆顶（`poll_expired` / `peek_next`）时被跳过并
  物理摘除。因此取消永远不会破坏堆序，时间复杂度只是 O(1) 簿记
  （不调用 `heapq` 的重排操作）。
* `poll_expired()` 返回后任务即从内核移除；**重复调用不会重复返回**。
* 已取消任务永远不会出现在 `poll_expired()` 的结果中。
* 堆膨胀可通过 `stats()` 的 `heap_stale_entries`（堆中惰性条目数）观察。

### 5. 接口一览

| 方法 | 行为 |
| --- | --- |
| `register(task)` | 校验并入堆；重复 id / 非法字段 / 超上限时抛错 |
| `cancel(task_id)` | 惰性取消单个任务；任务不存在或已取消均抛错 |
| `cancel_by_owner(owner)` | 取消该 owner 的全部**活跃**任务，返回取消数量（没有则 `0`） |
| `advance_to(t)` | 单调推进时钟，返回新时钟 |
| `poll_expired()` | 取出所有 `deadline <= clock` 的未取消任务（有序），并移除 |
| `peek_next()` | 下一个未取消任务的最早 deadline；无活跃任务返回 `None` |
| `stats()` | 见下 |
| `save(path)` / `load(path)` | JSON 快照持久化 / 重建（含严格校验） |
| `to_snapshot()` / `from_snapshot(data)` | 不经过文件的快照导出 / 重建 |

`stats()` 返回：

```json
{
  "clock": 30,
  "active_tasks": 12,
  "cancelled_tasks": 3,
  "expired_tasks": 7,
  "heap_stale_entries": 2,
  "heap_size": 14,
  "active_by_owner": {"gateway": 8, "worker": 4},
  "max_tasks": null
}
```

### 6. 内存上限策略（重要）

* `DeadlineScheduler()` 或 `DeadlineScheduler(max_tasks=None)`：**精确模式，
  无上限**，适合小规模使用或与受限模式做对照。
* `DeadlineScheduler(max_tasks=N)`（`N` 为非负整数）：活跃任务数达到 `N`
  后，新的 `register()` **被拒绝并抛出明确错误**：
  `active task limit reached: max_tasks=N, active=N; ...`。
  * **不会静默丢弃、不会挤掉已有任务**；已有任务与堆状态完全不变。
  * 取消任务或 `poll_expired()` 弹出任务会腾出名额。
  * 计数针对的是**活跃任务**，已取消 / 已弹出的历史任务不占名额。
  * `max_tasks=0` 表示一个任务都不允许注册。

## 持久化（JSON 快照）

`save(path)` 写入：

```json
{
  "version": 1,
  "clock": 30,
  "max_tasks": null,
  "tasks": [
    {"task_id": "t1", "owner": "o", "deadline": 40, "priority": 0,
     "payload": null, "cancelled": false}
  ],
  "stats": {"active": 1, "cancelled": 0, "expired": 2}
}
```

* 写入采用「临时文件 + 原子替换」，不会留下写坏一半的目标文件。
* `load(path)` 严格校验并重建：顶层结构、版本、`clock`/`max_tasks` 非负、
  每条记录字段齐全且类型正确、`task_id` 全局唯一、`deadline` 非负、
  `priority` 为整数、`payload` 可 JSON 序列化、`cancelled` 是布尔值、
  计数与实际任务数一致、活跃任务数不超过 `max_tasks`。
* 文件不存在、JSON 损坏（报行列号）、字段缺失或不一致，全部抛出带清晰
  信息的 `SchedulerError`，不会静默吞掉。
* 快照是压缩后的逻辑状态：堆中惰性删除条目不写回，重建后
  `heap_stale_entries` 归零，堆通过一次 `heapify` 重建。时钟、各计数、
  取消记录、后续 `register/poll` 的可观测行为与保存前完全一致。

## 命令行协议（main.py）

从标准输入逐行读 JSON 对象，每条命令输出一行 JSON：成功 `{"ok": true, ...}`，
失败 `{"ok": false, "error": "..."}`。空行跳过；非法 JSON 只产生一条错误行，
不中断后续命令。

| 命令 | 形式 |
| --- | --- |
| `init` | `{"cmd":"init","max_tasks":100}`（可选，仅允许作为第一条；`null`/缺省为无上限） |
| `register` | `{"cmd":"register","task":{...}}`，任务字段也允许直接平铺 |
| `cancel` | `{"cmd":"cancel","task_id":"t1"}` |
| `cancel_owner` | `{"cmd":"cancel_owner","owner":"gateway"}` |
| `advance` | `{"cmd":"advance","time":30}` |
| `poll` | `{"cmd":"poll"}` → `tasks` 有序列表 |
| `peek` | `{"cmd":"peek"}` → `next`（无任务时为 `null`） |
| `stats` | `{"cmd":"stats"}` |
| `save` / `load` | `{"cmd":"save","path":"state.json"}` |
| `dump` | 输出完整快照 JSON |

也支持文件输入：`python main.py < commands.txt > results.jsonl`。

## 边界情况对照

| 情况 | 行为 |
| --- | --- |
| 空内核 `peek/poll` | `None` / `[]` |
| `deadline=0` | 初始时钟下立即超时 |
| `deadline` 为负 | 注册即拒绝 |
| priority 相同 | 按 `task_id` 升序 |
| 同一 owner 多任务 | 全部计入 `active_by_owner`，批量取消一次性移除 |
| 取消不存在的 id | 抛错（区分「从未注册/已超时弹出」） |
| 重复取消同一任务 | 抛错 `already cancelled` |
| 时钟回退 | 抛错并带 current/attempted，时钟不变 |
| poll 无到期任务 | 返回 `[]` |
| peek 时全是已取消任务 | 清理堆顶惰性条目后返回 `None` |
| `max_tasks=0` | 任何注册都被拒绝 |
| save 后 load | 时钟/任务/取消标记/计数一致，可继续注册与 poll |
| 损坏快照文件 | 报错信息含文件来源与行列/字段原因 |

## 验收 / 差分测试说明

`test_scheduler.py` 中的 `DifferentialTests` 内置一个**排序列表 + 线性扫描**
参考实现 `ReferenceKernel`：

* 构造数千任务、多个 owner、随机 deadline/priority；
* 随机推进时钟、随机取消单个任务、随机按 owner 批量取消、随机 poll；
* 每一步比对两个实现的 `peek_next()`、活跃计数；每次 poll 比对返回的
  **顺序与集合完全一致** `(task_id, deadline, priority)`；
* 同时直接校验内部堆始终满足最小堆不变量（验证惰性删除不破坏堆序）；
* 另有中途 `save/load` 后继续随机操作的往返一致性场景；
* 无上限与 `max_tasks=250/300` 受限模式各跑一个种子。

直接运行：

```bash
python -m unittest -v test_scheduler
```
