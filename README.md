# 熔断内核（Circuit Breaker Kernel）

可离线验收的多单元熔断内核。**纯 Python 标准库实现**（仅用到 `json`、`dataclasses`、`enum`、`typing`），不依赖第三方包，不访问真实网络与真实时钟，由可注入的逻辑时钟驱动，同一输入序列重放必然得到完全相同的状态迁移序列与判定结果。

## 文件

| 文件 | 说明 |
| --- | --- |
| `circuit_breaker.py` | 内核模块（状态机、逻辑时钟、持久化、操作分发） |
| `test_circuit_breaker.py` | 40 个单元测试，覆盖全部需求与边界 |
| `README.md` | 本文档 |

运行测试：

```bash
python -m unittest test_circuit_breaker -v
```

## 状态机

每个熔断单元（以非空字符串标识注册）处于且仅处于三种状态之一：

```
                 连续失败达到阈值
        closed ────────────────────► open
          ▲                          │
          │ 半开探测成功              │ 冷却期结束
          │                          ▼
          └────────── half_open ◄────┘
            半开探测失败 ──► open（重新计时冷却）
```

- **closed（关闭）**：请求一律放行。上报成功清零连续失败计数；上报失败计数加一，达到 `failure_threshold` 立即迁移到 open 并开始计时冷却。
- **open（打开）**：请求一律拒绝。拒绝是**纯判定**，不改变连续失败计数，也不产生状态迁移。打开状态下上报成功/失败属于调用方错误（没有在途请求），抛出 `NoInflightRequestError`。
- **half_open（半开）**：冷却期结束后自动进入。按 `half_open_probe_quota` 限量放行探测请求；配额用尽后其余请求仍被拒绝，单元停留在半开，**等待在途探测上报结果**后再决定走向：
  - 探测成功 → 迁移到 closed，连续失败计数清零；
  - 探测失败 → 迁移回 open，重新计时冷却，迁移记录中保存失败原因与发生时刻。

冷却到期是**惰性结算**的：`advance_clock` 会结算所有单元，`allow` / `query` / `report_*` 会先结算目标单元，因此任意时刻查询到的状态都是当前逻辑时刻的真实状态，且判定结果可复现。

## 恢复抖动加速策略（重点）

**抖动识别**：单元每次离开 open 进入 half_open 时记录时刻 `last_open_exit_at`。此后任何一次进入 open 时，若距 `last_open_exit_at` 不超过 `flapping_window_seconds`，判定为恢复抖动，`flap_level` 加一；否则 `flap_level` 归零。半开探测失败导致的重新打开也计入抖动（恢复尝试本身失败了）。

**加速公式**（第 n 级抖动，n 从 0 起）：

```
effective_cooldown = min(cooldown_seconds * backoff_multiplier ** flap_level,
                         max_cooldown_seconds)
```

- 首次打开 `flap_level = 0`，使用基础冷却期 `cooldown_seconds`；
- 窗口内每次重新打开，冷却期按 `backoff_multiplier` 指数放大，恢复探测变得越来越谨慎；
- **冷却期有硬上限** `max_cooldown_seconds`，不会无限增长；
- 单元在 closed 状态健康运行超过抖动窗口后再失败，`flap_level` 归零，冷却期回到基础值。

示例（基础冷却 10s、倍率 2、窗口 50s、上限 100s）：首次打开冷却 10s；恢复后 50s 内再次熔断，冷却依次为 20s、40s、80s、100s、100s……；若恢复后健康运行超过 50s 再失败，重新从 10s 起步。

## 配置项（`UnitConfig`，按单元独立配置）

| 字段 | 默认 | 约束 | 含义 |
| --- | --- | --- | --- |
| `failure_threshold` | 3 | 整数 ≥ 1 | 触发熔断的连续失败次数 |
| `cooldown_seconds` | 30.0 | > 0 | 基础冷却期（秒，逻辑时间） |
| `half_open_probe_quota` | 1 | 整数 ≥ 0 | 半开状态允许的在途探测数；**为 0 时半开不放行任何请求，单元停留在半开** |
| `flapping_window_seconds` | 60.0 | ≥ 0 | 抖动识别窗口 |
| `backoff_multiplier` | 2.0 | ≥ 1 | 抖动加速倍率 |
| `max_cooldown_seconds` | 600.0 | ≥ 基础冷却期 | 冷却期上限 |

## API 概览

```python
from circuit_breaker import CircuitBreaker, UnitConfig

cb = CircuitBreaker()                       # 可注入 LogicalClock(start)
cb.register("pay-svc", UnitConfig(failure_threshold=3, cooldown_seconds=10))

cb.allow("pay-svc")                         # 放行判定 -> bool
cb.report_success("pay-svc")                # 上报成功
cb.report_failure("pay-svc", "timeout")     # 上报失败（可带原因）
cb.advance_clock(10.0)                      # 推进逻辑时钟（负值报 ClockRegressionError）

cb.query("pay-svc")     # 状态、连续失败数、剩余冷却、已放行探测数、剩余配额、
                        # 抖动等级、最近一次迁移（含原因与时刻）等
cb.history("pay-svc")   # 该单元迁移历史；cb.history() 为全部
cb.inspect()            # 完整内部状态快照
cb.export_file("state.json"); cb.import_file("state.json")   # 持久化
```

### 逐条操作分发 `apply(op)`

`apply` 接收字典形式的操作请求，便于接入消息流或录制回放：

| `op` | 必填字段 | 说明 |
| --- | --- | --- |
| `register` | `unit_id`，可选 `config` | 注册单元 |
| `allow` | `unit_id` | 放行判定 |
| `report_success` | `unit_id` | 上报成功 |
| `report_failure` | `unit_id`，可选 `reason` | 上报失败 |
| `advance` | `delta` | 推进逻辑时钟 |
| `query` | `unit_id` | 查询单元状态 |
| `history` | 可选 `unit_id` | 查询迁移历史 |
| `export` | 可选 `path` | 导出（无 `path` 时返回字典） |
| `import` | `path` 或 `data` | 导入 |
| `inspect` | — | 查看内部状态 |

## 持久化与导入校验

`export_file` 写出键排序的 JSON（输出确定），包含 `version`、`clock`、`units`（状态、计数、冷却配置、探测进度、抖动等级）、`history`（全部迁移记录）。`import_file` / `import_dict` **先完整校验、后原子替换**，任何一项校验失败都抛出 `ImportValidationError` 且内存状态保持不变。校验项包括：

- 顶层字段齐全、版本匹配、时钟非负；
- 单元标识非空且**唯一**；
- 各类计数为非负整数；状态取值合法（`closed` / `open` / `half_open`）；
- 冷却期与配额配置合法（同 `UnitConfig` 约束）；open 状态必须携带不晚于当前时钟的 `opened_at` 与不超过上限的正冷却期；非半开状态不得有在途探测；
- 迁移历史引用的单元必须存在。

## 边界行为一览

| 场景 | 行为 |
| --- | --- |
| 空系统 | 查询/历史/导出均正常返回空结果；对任何单元操作报 `UnknownUnitError` |
| 重复注册同一单元 | `DuplicateUnitError`，信息含单元标识 |
| 空标识 / 非字符串标识 | `ConfigError` |
| 失败阈值恰好达到 | 当次上报立即迁移到 open |
| 冷却期恰好结束 | 时刻 `>= opened_at + cooldown` 即进入 half_open |
| 探测配额为零 | 半开状态一律拒绝，单元停留在半开（不会自动恢复） |
| 打开状态下上报结果 | `NoInflightRequestError`（无在途请求） |
| 半开状态下无在途探测却上报 | `NoInflightRequestError` |
| 逻辑时钟回退（推进量为负） | `ClockRegressionError`，时钟保持不变 |
| 对不存在的单元操作 | `UnknownUnitError`，信息含单元标识 |
| 导入损坏文件 / 字段缺失 / 校验失败 | `ImportValidationError`，信息定位到具体单元与字段，内存状态不变 |
| 未知操作类型 / 操作数不是字典 | `CircuitBreakerError` |

## 确定性保证

内核不读取真实时钟、不使用随机数；所有时间来自注入的 `LogicalClock`，冷却结算按单元注册顺序进行，导出 JSON 键排序。因此**同一操作序列重复执行，必然得到完全相同的迁移序列、判定结果与导出内容**（由 `TestDeterminism` 验证）。
