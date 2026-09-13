# 限流熔断内核

纯 Python 标准库实现的滑动窗口限流 + 失败率熔断内核。不依赖第三方库、
不接真实网络，所有时间由可注入的**逻辑时钟**（`FakeClock`）驱动，
可离线运行、可单元测试。

## 文件

| 文件 | 说明 |
| --- | --- |
| `kernel.py` | 核心：`FakeClock`、`SlidingWindowRateLimiter`、`CircuitBreaker`、`Guard`、快照读写 |
| `main.py` | 命令行入口，stdin 逐行 JSON 命令 / stdout 逐行 JSON 结果 |
| `test_kernel.py` | unittest 测试（74 个） |
| `acceptance.py` | 端到端验收脚本（73 项断言，含 CLI 子进程） |

## 快速开始

```python
from kernel import FakeClock, SlidingWindowRateLimiter, CircuitBreaker, Guard

clock = FakeClock(start=0)
limiter = SlidingWindowRateLimiter(window_length=10, rate_limit=100, clock=clock)
breaker = CircuitBreaker(
    clock,
    window_length=10,              # 失败率统计窗口
    failure_rate_threshold=0.5,    # 失败率 >= 50% 触发（含等于）
    min_samples=5,                 # 且样本数 >= 5
    consecutive_failure_threshold=5,  # 或连续失败 5 次
    cooldown_duration=5,           # 打开后的冷却期
    half_open_max_calls=1,         # 半开探测请求数（默认 1）
    backoff_strategy="exponential",  # fixed | exponential
    backoff_multiplier=2.0,        # 指数退避倍数
    max_cooldown=60,               # 冷却期硬上限
    observation_window=30,         # 恢复后观察期
    fast_open_multiplier=0.5,      # 观察期内再超标：冷却期 *0.5
)
guard = Guard(clock, limiter, breaker)

guard.allow("user-service")          # True：先过限流，再过熔断
guard.record_failure("user-service")
clock.tick(6)                        # 假时钟推进（冷却到期）
guard.allow("user-service")          # half_open 探测，True
guard.record_success("user-service") # 探测成功 -> closed
```

## 语义要点

- **滑动窗口不是固定窗口**：窗口内保存 `(时间戳, cost)` 事件，事件在
  `t + window_length` 时刻恰好过期。任意长度为 `window_length` 的区间内
  放行总量不超过阈值，窗口边界不会出现固定窗口的两倍突发。
- **限流返回**：放行 `{"allowed": true, "current": ..., "remaining": ...}`；
  拒绝 `{"allowed": false, "reason": "rate_limited", "retry_after": 剩余等待}`。
- **熔断三态**：`closed -> open -> half_open -> closed`（探测失败则
  `half_open -> open`）。open 期间 `allow` 直接拒绝，不真正执行。
- **半开探测**：最多放行 `half_open_max_calls` 个；任一失败立即重开并退避，
  全部成功才关闭并清零统计。
- **指数退避有上限**：冷却期按倍数增长但永不超过 `max_cooldown`。
- **观察期**：恢复后的 `observation_window` 内再次超标，冷却期缩短为
  `cooldown_duration * fast_open_multiplier`，更快重新打开。
- **组合互不污染**：Guard 中限流拒绝完全不触碰熔断器；熔断拒绝使用
  “先预检后提交”，不消耗限流配额；`record_success/failure` 只写给熔断器。
- **时钟单调**：逻辑时钟只进不退；载入更早的快照会被拒绝。

## 快照

```python
guard.save("state.json")
restored = Guard.load("state.json")
```

JSON 内含版本号、逻辑时钟读数、限流配置与每 key 事件、熔断配置与每 key
状态机数据。载入时校验：版本、状态取值合法、计数非负、冷却期非负且不超
上限、`cooldown_end >= opened_at`、半开探测数不超配置、时间戳不晚于时钟、
时钟不回退等。任何不一致都抛出带清晰信息的 `SnapshotError`，不会静默吞掉。

## 命令行

```bash
python main.py --rate-window 10 --rate-limit 100 \
               --failure-rate 0.5 --consecutive-failures 5 \
               --cooldown 5 --backoff exponential --max-cooldown 60
```

每行输入一个 JSON 对象，每行输出一个 JSON 对象：

```json lines
{"cmd":"allow","key":"a"}
{"cmd":"failure","key":"a"}
{"cmd":"tick","delta":6}
{"cmd":"state","key":"a"}
{"cmd":"stats"}
{"cmd":"save","path":"state.json"}
{"cmd":"load","path":"state.json"}
{"cmd":"dump"}
{"cmd":"reset","key":"a"}
```

支持命令：`allow`（可带 `cost`）、`success`、`failure`、`state`、
`stats`、`reset`、`save`、`load`、`dump`、`tick`（可带 `delta`）、`now`。
错误也输出一行 JSON：`{"ok": false, "error": "...", "cmd": ...}`。

## 测试

```bash
python -m unittest -v test_kernel   # 74 个单元测试
python acceptance.py                # 73 项端到端验收（含 CLI 子进程）
```
