# 离线资源容量预测

这是一个只依赖 Python 标准库的本地模块，用于导入一批资源用量记录，识别同一资源的连续观测，推导线性增长趋势，并按指定窗口预测未来用量、配额缺口和扩容建议。

## 输入记录

JSON 可以是数组，也可以是 `{"records": [...]}`。字段支持：

| 字段 | 别名 | 含义 |
| --- | --- | --- |
| `resource_id` | `resource`, `resourceId` | 资源标识 |
| `observed_at` | `timestamp`, `collected_at`, `time` | ISO-8601 采集时刻 |
| `usage` | `used`, `usage_value` | 当前用量 |
| `quota` | `limit`, `capacity` | 当前配额 |
| `record_id` | `recordId` | 可选记录标识；省略时自动生成 |
| `action` | `scale_action` | `expand`/扩容，或 `shrink`/缩容 |
| `action.amount` | `amount` | 动作量 |
| `action.quota_after` | `quota_after` | 动作后明确配额 |

CSV 使用同样的表头。无时区时间按 UTC 解释。

## 命令行

```powershell
python -m capacity_planner examples\records.json --horizon 7d --step 1d
python -m capacity_planner data.csv --format csv --resource cluster-a/cpu
```

默认预测窗口从资源最后一个观测点之后一个步长开始，默认未来 7 天、每小时一个点。输出为 JSON。

## Python API

```python
from datetime import timedelta
from capacity_planner import CapacityPlanner, ForecastWindow
from capacity_planner.io import records_from_json_text

planner = CapacityPlanner(default_step=timedelta(days=1))
planner.add_records(records_from_json_text(open("records.json", encoding="utf-8").read()))

# 临时指定窗口，不改变已保存配置
result = planner.analyze("cluster-a/cpu", ForecastWindow.horizon(
    start=..., periods=7, interval=timedelta(days=1)
))

# 持久调整某资源窗口；仅该资源缓存失效
planner.set_forecast_horizon("cluster-a/cpu", timedelta(days=14), timedelta(days=1))

# 修正一条记录；同一资源只更新预测，移动资源时旧/新资源同时失效
planner.correct_record("auto-1", {"usage": 71.0})
```

## 冲突与建议依据

- 同一资源、同一时刻出现多条记录时，所有记录都保留并标记 `duplicate_timestamp`；若 `usage`、`quota` 或动作不同，再额外给出矛盾字段和值。
- 后到的更早时间记录标记为 `out_of_order`，不会被丢弃。
- 冲突用量形成独立的低值和高值线性拟合，预测同时给出 `low`、`expected`、`high`。
- 最新时刻的有效配额冲突会产生 `conflict_review`，避免静默选择某个配额作为扩容基准。
- 最近扩/缩容动作之后若至少有两个不同时刻，趋势使用动作后的数据；否则回退到全历史，并在 `trend.source` 标明。
- `recommendation.rationale` 列出趋势来源、样本组数、斜率、峰值区间和首次越限时间。

## 验证

```powershell
python -m unittest discover -s tests -v
```
