# 多队列工作窃取执行器（Work-Stealing Executor）

一个纯 Python 标准库实现的离线批处理任务调度器：任务提交时声明依赖，执行器按依赖就绪顺序把任务分发到多个工作线程的本地队列上执行，空闲线程可以从其他队列**窃取**任务。支持任务超时、协作式取消、失败重试、下游跳过和 JSON 快照持久化。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `executor.py` | 核心执行器：`Task`、`WorkStealingExecutor`、状态机、快照 |
| `main.py` | 命令行入口：从标准输入逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_executor.py` | `unittest` 测试（47 个用例） |

无第三方依赖，Python 3.8+ 可运行。

## 快速开始（库用法）

```python
from executor import Task, WorkStealingExecutor, current_cancel_token

ex = WorkStealingExecutor(workers=4)

ex.submit(Task("extract", lambda: {"rows": 100}))
ex.submit(Task("transform", lambda: "ok", deps=["extract"],
               timeout=10, max_retries=2))

def slow_payload():
    token = current_cancel_token()   # 协作式取消：payload 自行检查令牌
    while not token.is_cancelled:
        ...  # 干活
    return "interrupted"             # 超时后该返回值会被丢弃

ex.submit(Task("slow", slow_payload, timeout=0.5))

ex.run()                              # 阻塞直到所有任务进入终态
print(ex.get_result("transform"))     # {'state': 'success', 'result': 'ok', ...}
print(ex.get_state()["steals"])       # 工作窃取次数
ex.save("snapshot.json")              # 持久化
ex2 = WorkStealingExecutor.load("snapshot.json")  # 重建并校验
```

### 主要 API

- `submit(task)` / `submit_many(tasks)`：提交任务。`submit_many` 是原子的——全部校验通过才生效，否则一个都不加。校验包括：`task_id` 唯一且非空、`deps` 无重复、不自依赖、依赖的任务已存在（或同批次）、依赖图无环（成环抛 `CycleError`，`e.cycle` 给出环上的 task_id 序列）、`timeout > 0`、`max_retries >= 0`。
- `cancel(task_id)`：取消未完成的任务。等待中/排队中的任务立即标记 `cancelled`；运行中的任务会被设置取消令牌，等 payload 退出（或宽限期结束）后标记 `cancelled`。下游任务级联标记为 `skipped` 并带原因。取消已完成任务抛 `StateError`，取消不存在的任务抛 `UnknownTaskError`。
- `run()`：启动工作线程并阻塞，直到所有任务到达终态（`success` / `failed` / `timeout` / `cancelled` / `skipped`），不会有任务卡在等待区。执行器是一次性的，`run()` 结束后不能再提交或再次运行。
- `get_result(task_id)`：返回 `{task_id, state, attempts, result, error, skip_reason}`。
- `get_state()`：返回每个任务的状态、每个线程已执行的尝试次数、窃取次数、各终态计数。
- `save(path)` / `WorkStealingExecutor.load(path)`：JSON 快照的写出与重建。

## 任务状态机

```
pending ──(依赖全部成功)──▶ ready ──▶ running ──▶ success
   │                         │           │
   │                         │           ├─▶ failed   （异常且重试耗尽）
   │                         │           ├─▶ timeout  （超时且重试耗尽）
   │                         │           └─▶ cancelled（运行中被取消）
   └──(依赖失败/超时/取消/跳过)──▶ skipped（带 skip_reason）
   └──────────(被 cancel)────────▶ cancelled
```

- 失败和超时都会消耗重试次数：`attempts == max_retries + 1` 次尝试后进入终态。
- 下游任务只有在**所有依赖都成功**后才会入队；任一依赖未成功，下游级联 `skipped`，`skip_reason` 指明是哪个依赖、以何种方式失败。
- payload 返回值必须可 JSON 序列化，否则该次尝试按失败处理。

## 超时与取消语义

Python 线程无法被强杀，因此超时/取消是**协作式**的：

1. 每次尝试在独立的守护线程里执行 payload；
2. 超过 `timeout` 秒（或被 `cancel`）后，执行器设置该次尝试的 `CancellationToken`；
3. 等待一小段宽限期（构造函数 `cancel_grace`，默认 0.5 秒）让 payload 自行退出；
4. 宽限期内退出 → 记为 `timeout` / `cancelled`；仍不退出 → 放弃该线程（守护线程成为孤儿，不阻塞 `run()`），任务照样记为 `timeout` / `cancelled`。

payload 里通过 `executor.current_cancel_token()` 拿到当前任务的令牌并周期检查。

## 工作窃取

- 每个工作线程一个双端队列；新就绪的任务按轮询放入某个队列。
- 线程从自己队列**头部**取任务；队列空时按序扫描其他队列，从**尾部**偷一个任务，窃取计数加一。
- 任务只会入队一次、出队即被独占（出队后在执行器锁内做 `ready → running` 状态迁移），同一任务不会被两个线程执行；期间被取消/跳过的任务在出队时被直接丢弃。
- 只有依赖全部就绪的任务才会进入队列，因此窃取不会破坏依赖顺序。

## 持久化

`save(path)` 写出：

```json
{
  "version": 1,
  "config": {"workers": 4, "cancel_grace": 0.5},
  "tasks": [
    {"task_id": "a", "deps": [], "timeout": 5.0, "max_retries": 1,
     "state": "success", "attempts": 1, "result": 42,
     "error": null, "skip_reason": null}
  ]
}
```

`load(path)` 重建状态并做完整校验：JSON 合法性、必填字段、`task_id` 唯一、依赖存在、无环、状态取值合法、`timeout`/`max_retries`/`attempts` 类型与取值合法。任何问题都抛 `SnapshotError` 并带清晰信息，不会静默吞掉。

注意：payload 是可调用对象，**不会**被持久化。加载回来的快照用于查看状态与结果；若快照里还有未完成任务，调用 `run()` 会抛 `StateError`。

## 命令行入口

```bash
python main.py [workers]   # workers 默认 4
```

从标准输入逐行读 JSON 命令，每条命令输出一行 JSON；错误以 `{"ok": false, "error": {"type": ..., "message": ...}}` 返回。支持 `submit`、`submit_many`、`cancel`、`run`、`result`、`state`、`save`、`load`、`dump`。

因为 JSON 无法传输函数，CLI 的 payload 是内置规格：

- `{"kind": "const", "value": <任意 JSON>}` —— 返回 value
- `{"kind": "fail", "message": "..."}` —— 抛 RuntimeError
- `{"kind": "sleep", "seconds": 0.5, "value": <任意 JSON>}` —— 睡眠（可被令牌中断）后返回 value

示例：

```bash
$ printf '%s\n' \
  '{"cmd":"submit","task_id":"a","payload":{"kind":"const","value":1}}' \
  '{"cmd":"submit","task_id":"b","deps":["a"],"payload":{"kind":"sleep","seconds":0.1,"value":2}}' \
  '{"cmd":"run"}' '{"cmd":"result","task_id":"b"}' | python main.py 2
{"ok": true}
{"ok": true}
{"ok": true, "summary": {"success": 2, ...}}
{"ok": true, "result": {"task_id": "b", "state": "success", "attempts": 1, "result": 2, ...}}
```

## 运行测试

```bash
python -m unittest test_executor -v
```

覆盖：任务校验、环检测与环路径、批量提交原子性、依赖顺序（链/菱形/宽 DAG）、单线程、失败记录、重试成功/耗尽、下游级联跳过、不可序列化结果、协作式与顽固 payload 超时、超时重试、取消等待中/运行中任务、取消不存在/已完成任务、工作窃取发生且任务只执行一次、save/load 往返一致、各类损坏快照报错、CLI 端到端会话。

## 设计取舍

- **锁顺序约定**：全局只有单向锁序 `Condition（_cond）→ 队列锁（_qlocks[i]）`。`_enqueue_locked` / `_requeue_locked` 永远在持有 `_cond` 时被调用、再去拿队列锁；`_steal` 在队列锁内只做 `pop`，`_steals` 计数在**释放队列锁之后**才在 `_cond` 下更新；`_pop_own` 只拿自己的队列锁。任何路径都不会出现反向持锁，因此不存在环等待（AB-BA 死锁）。
- **submit_many 的原子性边界**：分三个阶段。
  1. **校验阶段**（唯一可能失败的阶段）：类型检查、`task_id` 批内/全局去重、依赖存在性、环检测。此阶段不触碰任何执行器状态，抛出的 `ValidationError` / `DuplicateTaskError` / `UnknownTaskError` / `CycleError` / `StateError` 都保证已有任务状态、`_non_terminal`、`_rr`、队列完全不变，同一批次重试会得到同样的结果。
  2. **commit 阶段**：只做 dict/deque 的纯插入操作（建记录、加依赖边、递增 `_non_terminal`、算 `remaining`、就绪任务入队），设计上不会失败；`_rr` 只在这里推进，即任何失败路径上 `_rr` 都不会被改动。
  3. **post-commit 阶段**：对依赖已处于终态（如提交前已被 cancel）的新任务做 skip 级联。由于已有任务提交在先、不可能依赖本批次的新任务，级联只会影响本批次内部，不会改动已有任务。
- **每次尝试一个守护线程**：换来真正的超时放弃能力；代价是顽固 payload 会成为孤儿线程（守护线程，不阻止进程退出），其迟到的结果会被丢弃，且通过每次尝试独立的结果持有器避免污染后续重试。
- **就绪任务才入队**：等待区只存计数（`remaining`），依赖完成时递减到 0 即入队，天然保证依赖顺序，窃取逻辑无需感知依赖。
