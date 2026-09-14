# 批处理调度器准入控制模块

容量受限、承诺优先的批处理调度准入模块。只做**决策与状态维护**，不真正执行任务；
由可注入的逻辑时钟驱动（不读取任何墙上时间），仅依赖 Python 标准库，可完全离线
运行与单元测试。

## 目录结构

```
batch_scheduler/
  core.py         # 资源/任务模型、准入判断、承诺保护、抢占、容量时间线、逻辑时钟
  persistence.py  # JSON 导出/导入与完整校验
  cli.py          # 命令行入口（标准输入逐行 JSON 命令）
  __main__.py     # python -m batch_scheduler
tests/
  test_core.py         # 准入、承诺保护、抢占回退、容量时间线、时钟
  test_persistence.py  # 导出导入往返、各类校验失败
  test_cli.py          # CLI 协议与边界行为
```

## 调度语义

- 每个资源有单位时间处理容量；同一资源同一时刻只处理一个任务，任务占用区间
  `[start, end)`，时长 = 处理量 / 容量；同一资源上的占用区间互不重叠，任意时间点
  占用不超过容量。所有时间量按逻辑时钟计量。
- 每次准入时，对该资源上所有尚未开始（`start >= 当前时钟`）的任务按
  **(截止时刻升序, 优先级降序, 提交序号升序)** 重新紧凑排列；已经开始的任务区间
  固定不变。
- **准入拒绝**（写入拒绝记录，不改变任何已排入任务）：
  - `resource_not_found` — 资源不存在
  - `deadline_passed` — 截止时刻不晚于当前时钟
  - `capacity_insufficient` — 截止前没有足够空闲容量
  - `duplicate_task_id` — 任务标识重复
- **承诺保护**：已承诺的紧急任务（`committed=true`）一经准入不得被挤掉。新任务
  若会导致任何已承诺任务无法在其截止前完成，新任务被拒绝。承诺任务恰好卡在截止
  边界（完成时刻 == 截止时刻）视为可行。
- **抢占**：承诺任务仅凭重排无法准入时，按 (优先级升序, 截止时刻降序, 标识升序)
  逐个抢占同资源上的非承诺任务，直到可准入；若抢占全部仍不可行则整体回退并拒绝。
  被抢占任务记录原因并回到待排（pending）状态，处理量与截止时刻保持不变；时钟
  推进时按 (优先级降序, 截止时刻升序, 提交序号升序) 重新尝试准入，仍按原优先级
  参与。承诺任务不可被抢占。

## Python API 示例

```python
from batch_scheduler import Scheduler

s = Scheduler()
s.register_resource("r1", capacity=1)
s.submit_task("a", "r1", amount=3, deadline=3, priority=1)
result = s.submit_task("u", "r1", amount=2, deadline=4, committed=True)
assert result.admitted and result.preempted == ["a"]   # 紧急任务抢占 a
print(s.query_occupancy("r1", 0, 10))                  # 容量占用时间线
print(s.query_task("a"))                               # 排入位置 / 待排状态
print(s.query_records())                               # 拒绝与抢占记录
s.advance_clock(2)                                     # 推进逻辑时钟，重试待排任务
```

## 命令行入口

```
python -m batch_scheduler
```

从标准输入逐行读取 JSON 命令，每条输出一行 JSON。成功为 `{"ok": true, ...}`，
失败为 `{"ok": false, "error": <代码>, "message": <说明>}`；准入被拒绝不是错误，
而是 `{"ok": true, "admitted": false, "reason": ...}`。空行忽略。

| 命令 | 字段 | 说明 |
| --- | --- | --- |
| `register_resource` | `resource_id`, `capacity` | 注册资源（容量可为 0，不能为负） |
| `submit_task` | `task_id`, `resource_id`, `amount`, `deadline`, 可选 `priority`(0), `committed`(false) | 提交任务，返回准入结论 |
| `preempt` | `task_id`, 可选 `reason` | 手动抢占非承诺任务 |
| `query_occupancy` | `resource_id`, `start`, `end` | 查询时间范围内的占用区间与总占用时长 |
| `query_task` | `task_id` | 查询任务排入位置与预计完成时刻 |
| `query_records` | — | 查询所有拒绝与抢占记录（按发生顺序） |
| `advance_clock` | `time` | 推进逻辑时钟（不可回退），返回重新准入的任务 |
| `export` | `path` | 导出完整状态为 JSON 文件 |
| `import` | `path` | 从 JSON 文件载入状态（先校验后替换，失败不影响原状态） |
| `dump_state` | — | 查看完整内部状态 |

## 导出 / 导入

导出内容：逻辑时钟、资源、任务（含占用时间线与承诺标记）、拒绝与抢占记录。
导入时校验：任务标识唯一、处理量为正、截止时刻合法、占用区间互不重叠且不超过
容量、承诺任务已排入且能在截止前完成；文件损坏、字段缺失、版本不符都会返回
清晰的错误，且原有状态保持不变。数值以分数精确序列化（必要时写成 `"p/q"`），
往返完全一致。

## 运行测试

```
python -m unittest discover -s tests -v
```
