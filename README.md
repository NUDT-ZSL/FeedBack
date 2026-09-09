# 分布式实时指标聚合与告警引擎

一个**仅使用 Python 标准库**的微服务监控引擎：从可替换的事件源接收指标事件，
按**事件时间**做固定/滑动窗口聚合、多维标签索引、告警规则评估与触发/恢复通知，
原生支持**乱序事件**与**运行中动态加载规则**。

> 离线验收使用文件/标准输入事件源；接入真实消息队列时只需新增一个 `EventSource` 子类。

---

## 1. 目录结构

```
.
├── main.py                     # 命令行入口（批处理 + 交互模式）
├── monitoring/                 # 核心库
│   ├── models.py               # MetricEvent / TimeSeriesPoint / Alert
│   ├── aggregator.py           # WindowConfig / TagFilter / WindowAggregator
│   ├── rules.py                # AlertRule / load_rules（解析与校验）
│   ├── alerting.py             # AlertEngine（状态机：去抖/去重/恢复/空跳）
│   ├── sources.py              # EventSource / File / Stdin / Iterable 事件源
│   └── engine.py               # MonitoringEngine 编排（watermark 驱动）
├── examples/
│   ├── events.jsonl            # 示例事件（刻意乱序，含 1 条超迟事件）
│   ├── rules.json              # 8 条示例规则
│   ├── rules_extra.json        # 交互模式动态加载用规则
│   ├── events_with_errors.jsonl# 各类非法事件
│   ├── rules_with_errors.json  # 各类非法规则
│   └── output_sample.json      # 一次完整运行的输出样例
├── scripts/
│   └── benchmark.py            # 10 万事件性能基准
└── tests/                      # 68 个单元/端到端测试（unittest）
```

---

## 2. 快速开始

要求 Python 3.10+（开发验证于 3.13），无第三方依赖。

```bash
# 批处理：读事件文件 + 规则文件，输出 JSON 到屏幕
python main.py \
  --events examples/events.jsonl \
  --rules  examples/rules.json \
  --window-size 60 \
  --group-by service,instance \
  --allowed-lateness 300 \
  --funcs sum,avg,min,max,count \
  --pretty

# 结果写入文件
python main.py -e examples/events.jsonl -r examples/rules.json -o result.json
```

输出结构：

```json
{
  "summary":     { "events_received": 32, "events_dropped_late": 1, "...": "..." },
  "rule_errors": [],
  "event_errors": [],
  "aggregations":[ { "metric_name": "...", "func": "avg", "timestamp": "...",
                     "window_start": "...", "window_end": "...",
                     "key_tags": {"service": "auth"}, "value": 90.0 } ],
  "alerts":      [ { "alert_id": "...", "rule_id": "...", "status": "firing|resolved",
                     "window_start": "...", "window_end": "...", "value": 90.0,
                     "threshold": 70, "channel": "email:...", "tags": {"...": "..."} } ]
}
```

### 从标准输入读取

```bash
# -e - 表示 stdin（管道 / 重定向）
type events.jsonl | python main.py -e - -r rules.json      # Windows PowerShell: Get-Content ...
cat events.jsonl | python main.py -e - -r rules.json       # bash
```

---

## 3. 交互模式（动态规则加载，无需重启）

```bash
python main.py --rules examples/rules.json --interactive
```

进入后，**普通一行 JSON 是事件，以 `:` 开头的是命令**，所有输出均为一行一个 JSON：

```text
> {"metric_name":"cpu_usage","value":99,"timestamp":"2026-09-09T10:00:01Z","tags":{"region":"us-east"}}
> :rules examples/rules_extra.json      # 运行中加载/覆盖规则（同 id 覆盖并重置状态）
> :rules-inline {"rules":[ {...} ]}     # 直接内联规则 JSON
> :remove cpu_critical                  # 删除规则
> :rules-list                           # 查看当前规则
> :alerts                               # 全部告警
> :active                               # 仍在 firing 的告警
> :query avg --metric cpu_usage         # 查询聚合
> :errors                               # 规则/事件错误
> :help
> :quit                                 # 结束时冲刷未封口窗口并输出最终报告
```

动态加载的规则对**加载之后到达**的事件立即生效；也可在启动时不加 `--rules`，
进入交互后再 `:rules` 加载（见测试 `test_interactive_dynamic_rules`）。

---

## 4. 事件模型

每行一个 JSON 对象（JSON Lines）：

```json
{
  "metric_name": "cpu_usage",
  "value": 92.5,
  "timestamp": "2026-09-09T10:00:05Z",
  "tags": {"service": "auth", "instance": "a1", "region": "cn-east"}
}
```

| 字段 | 类型 | 校验 |
| --- | --- | --- |
| `metric_name` | string | 非空 |
| `value` | number | 必须是**有限**数值（拒绝 `NaN`/`Infinity`/`bool`/字符串） |
| `timestamp` | string | 合法 ISO 8601，支持尾缀 `Z`、时区偏移；裸时间按 UTC |
| `tags` | object | 键值均为非空字符串（数字值自动转字符串） |

空行与 `#` 开头的注释行会被忽略；非法行被跳过、记录到 `event_errors`，不影响其他事件。

---

## 5. 告警规则

JSON 文件为规则数组，或 `{"rules": [...]}`：

```json
{
  "id": "cpu_auth_high",
  "metric_name": "cpu_usage",
  "agg_func": "avg",
  "window_seconds": 60,
  "slide_seconds": 60,
  "operator": ">",
  "threshold": 70,
  "duration_windows": 2,
  "tags": {"service": "auth", "region": "cn-*"},
  "channel": "email:ops@example.com"
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 规则唯一 ID（必填，非空） |
| `metric_name` | 监控指标 |
| `agg_func` | `sum` / `avg` / `min` / `max` / `count` |
| `window_seconds` | 窗口长度（正整数秒） |
| `slide_seconds` | 滑动步长，默认等于窗口长度（即固定窗口）；必须整除窗口长度 |
| `operator` | `>` `>=` `<` `<=` `==` `!=` |
| `threshold` | 有限数值 |
| `duration_windows` | 连续满足多少个窗口才触发（默认 1） |
| `tags` | 标签过滤，精确匹配或 `*`/`?` 通配；同时决定规则的**聚合分组维度** |
| `channel` | 通知渠道，仅记录（`email:…`、`webhook:…`、`log`） |

非法规则会被跳过并记录到 `rule_errors`，不影响其他规则；同 ID 规则只保留第一条。

---

## 6. 核心语义

### 6.1 事件时间窗口与乱序处理

* 窗口起点完全由事件自带 `timestamp` 取整得到，**与到达顺序无关**；
  同一批事件无论正序、逆序还是乱序喂入，聚合结果逐字节一致（见
  `tests/test_engine.py::test_shuffled_events_same_result`）。
* watermark = 已观测到的最大事件时间。窗口满足
  `window_end + allowed_lateness <= watermark` 后**封口**，迟到事件不再写入；
  宽限期内（默认 300 秒）的迟到事件正确并入历史窗口。
* 被丢弃的超迟事件计入 `summary.events_dropped_late`（示例中 09:30 的
  `legacy` 事件即超 5 分钟宽限被丢弃）。
* EOF 时会强制冲刷所有未封口窗口（含最后一个不完整窗口），保证批处理结果完整。

### 6.2 聚合与多维标签

* 固定窗口：`window_seconds`；滑动窗口：`window_seconds` + `slide_seconds`。
  一条事件会落入所有覆盖它的滑动窗口。
* 每窗口每标签组只保留增量统计量 `(count, sum, min, max)`，不存原始事件，
  内存有界（封口窗口评估后即物理清理）。
* 查询接口 `get_query_result(funcs, time_range, tag_filter, metric_name)`，
  标签过滤支持精确与 `*` 通配。

### 6.3 告警状态机

每个 `规则 × 标签组` 一份独立状态：

```
ok ──连续 N 个窗口满足(duration_windows)──▶ firing（发 status=firing）
▲                                            │
└────────────条件不满足 / 该窗口无数据────────┘（发 status=resolved）
```

* **去抖**：必须连续 `duration_windows` 个窗口满足才触发，中断即清零。
* **去重**：firing 期间持续满足不重复告警。
* **恢复**：条件不满足的下一窗口产生 `resolved` 记录；`alert_id` 在整个
  生命周期保持稳定，便于关联两条记录。
* **空跳**：沿密集的 slide 时钟评估，完全没有数据的空窗口也占一拍，
  因此“连续 N 个窗口”指**时钟连续**而非“有数据的窗口连续”，数据断流会正确
  打断计数/触发恢复。
* 相同窗口形状与标签维度的规则共享一份聚合计算。

---

## 7. 作为库使用

```python
from monitoring import (
    MonitoringEngine, FileEventSource,
)

engine = MonitoringEngine(
    rules=[{
        "id": "cpu_high", "metric_name": "cpu", "agg_func": "avg",
        "window_seconds": 60, "operator": ">", "threshold": 80,
        "duration_windows": 2, "tags": {"service": "auth"},
        "channel": "email:ops@example.com",
    }],
    window_size=60,                 # 报表窗口
    group_by=("service", "instance"),
    allowed_lateness=300,
)

engine.process_source(FileEventSource("events.jsonl"))   # 批处理
# 或逐条：engine.add_event(MetricEvent.from_dict(obj)) → 立即推进评估
#       engine.load_rules([...]) 运行中动态加载
#       engine.finalize()         冲刷

for point in engine.query("avg"):        # TimeSeriesPoint
    print(point.to_dict())
for alert in engine.get_alerts():        # Alert（firing / resolved）
    print(alert.to_dict())
```

### 接入真实消息队列（可扩展点）

只需继承 `EventSource` 实现 `events()`，把一条 MQ 消息解析为 `MetricEvent`：

```python
class KafkaEventSource(EventSource):
    def __init__(self, consumer, topic, on_error=None): ...
    def events(self):
        for msg in self.consumer.subscribe(self.topic):
            try:
                yield MetricEvent.from_dict(json.loads(msg.value))
            except ValueError as exc:
                if self.on_error: self.on_error(msg.offset, msg.value, str(exc))
```

`NotificationChannel` 同理：当前渠道仅落记录，需要真实通知时新增一个
发送器消费 `engine.get_alerts()` / `take_new_alerts()` 即可。

---

## 8. 命令行参数

| 参数 | 说明 |
| --- | --- |
| `-e/--events` | JSONL 事件文件，`-` 表示标准输入 |
| `-r/--rules` | 规则 JSON 文件 |
| `-w/--window-size` | 报表聚合窗口秒数（默认 60） |
| `-s/--slide` | 报表滑动步长（默认等于窗口大小） |
| `-g/--group-by` | 报表分组标签，逗号分隔 |
| `--allowed-lateness` | 乱序宽限秒数（默认 300） |
| `-f/--funcs` | 输出的聚合函数（默认全部五个） |
| `--metric` | 仅输出某指标 |
| `--tag-filter` | `service=auth,region=cn-*` |
| `--start` / `--end` | 查询时间范围（ISO 8601，半开区间） |
| `-o/--output` | 输出文件 |
| `--pretty` | 缩进格式化 |
| `-i/--interactive` | 交互模式 |

---

## 9. 运行测试与性能基准

```bash
# 全部 68 个测试
python -m unittest discover -s tests -v

# 10 万事件性能基准（普通机器约 0.7 秒，≈14.5 万事件/秒）
python scripts/benchmark.py 100000
```

测试覆盖：五种聚合函数与窗口边界、乱序顺序无关性、宽限内/超宽限迟到事件、
滑动窗口、标签精确/通配过滤、告警去抖/去重/恢复/空跳/多标签组隔离、
动态规则增删与替换重置、非法事件与非法规则容错、空事件流、CLI 批处理与交互。

---

## 10. 设计取舍与边界

* **有界乱序**：按流处理通行的 watermark + 宽限期模型。超过宽限的事件被
  丢弃并计数，而不是无限重写历史窗口（否则延迟极大的事件会改变早已发出的
  告警，违反“告警不可变”预期）。
* **末窗口冲刷**：离线批处理在 EOF 强制评估所有窗口；常驻进程则严格等
  watermark 推进封口后才评估。
* **通知只记录**：按任务要求 `channel` 仅写入告警记录；真正发送 email/webhook
  留作 `NotificationChannel` 扩展点。
* **单线程驱动**：引擎本身无锁；高吞吐场景可在 `EventSource` 侧分区、
  多个引擎实例并行（按指标/标签哈希分区）。
