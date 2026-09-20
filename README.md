# 离线容量趋势分析模块

该模块只使用 Python 标准库，可在内网、离线环境中运行。它按资源标识归组观测记录，识别乱序、重复时刻和用量/配额冲突，基于本地线性回归给出未来用量、配额缺口和扩容建议。

## 数据格式

JSON：

```json
{
  "records": [
    {
      "record_id": "r1",
      "resource_id": "cluster-a",
      "timestamp": "2026-09-01T00:00:00Z",
      "usage": 100,
      "quota": 200,
      "action": {"type": "expand", "amount": 50}
    }
  ]
}
```

CSV 支持 `record_id,resource_id,timestamp,usage,quota,action_type,action_amount,action_unit,action_note` 列；`record_id` 和动作列可省略。动作类型支持 `expand/scale_up/扩容` 与 `shrink/scale_down/缩容`。

## 命令行

```bash
python -m capacity_planner analyze records.json --horizon 30d --interval 6h
python -m capacity_planner analyze records.csv --format csv --resource cluster-a
```

持续时间支持 `30m`、`12h`、`7d`、`2w` 以及 ISO 形式（如 `P30D`、`PT6H`）。

## 增量更新

`CapacityPlanner.upsert_record()`、`correct_record()` 和 `delete_record()` 只会使旧资源与新资源的序列、趋势和预测缓存失效；`analyze()` 的结果与新建分析器全量重算一致。调整预测窗口时，趋势缓存仍会保留，仅请求的资源会生成新窗口预测。

## Python API

```python
from datetime import timedelta

from capacity_planner import CapacityPlanner, PredictionWindow
from capacity_planner.io import load_records

planner = CapacityPlanner(PredictionWindow(timedelta(days=30), timedelta(hours=6)))
planner.add_records(load_records("records.json"))
report = planner.analyze()

# 修正一条记录；只有相关资源会重新构建序列和预测。
planner.correct_record("r-42", usage=128.5)
updated = planner.analyze()
```

## 结果语义

- 同一资源按时间排序；乱序通过记录进入顺序识别，并在 `out_of_order_record_ids` 中列出。
- 同一时刻的多条记录全部保留。完全重复标记为 `duplicate`，用量或配额不一致标记为 `contradiction`。
- 冲突时刻的最小值/最大值形成用量包络，均值进入线性趋势拟合；不会静默丢弃任一方。
- 趋势使用普通最小二乘法；只有一个不同时刻时使用最新观测的平推估计。
- 每个预测点包含期望用量、低/高用量、当前保守配额，以及期望和区间上限对应的配额缺口。
- `recommended_action=expand` 时，建议配额按窗口内高用量估计计算；`trend_source` 给出方法、保留观测数量、不同时刻数量和历史时间范围。
