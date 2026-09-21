# 离线端到端延迟预算归因

这是一个完全运行在本地的分析组件，用于把端到端请求耗时拆解到阶段，并定位预算超支。归因引擎与网页界面分离，只依赖 Python 标准库，不访问任何外部服务。

## 启动

```powershell
.\run_ui.bat
```

也可以执行：

```powershell
python -m latency_budget.server
```

服务默认监听 `http://127.0.0.1:8765/index.html`，启动后自动打开浏览器并加载 [data/sample_requests.json](data/sample_requests.json)。

## 输入格式

数值时间戳按毫秒解释；也支持 ISO-8601 字符串，但同一条请求不能混用两类时间戳。

```json
{
  "default_budgets": {"database": 35, "service": 55},
  "requests": [
    {
      "id": "request-1",
      "name": "可选名称",
      "fragments": [
        {"id": "f1", "stage": "database", "start": 0, "end": 42}
      ]
    }
  ]
}
```

片段字段兼容 `fragments`、`segments`、`phases`、`spans`；阶段名兼容 `stage`、`stage_name`、`name`、`phase`；时间字段兼容 `start/start_time/startTime/begin` 与 `end/end_time/endTime/finish`。

## 归因口径

- 只有一个阶段活动的时间计入该阶段的“独占耗时”。
- `n` 个不同阶段同时活动的时间计入“共同占用墙钟”，只给端到端增加一次；归因到每个阶段时按 `1/n` 分摊。
- 阶段“实际占用”取该阶段所有片段的并集，避免同一阶段重叠片段被重复累计；这种情况会产生警告。
- 没有片段覆盖的时间计入“空档”。
- 可加总口径为：各阶段“独占耗时 + 分摊共同占用”之和 + 空档 = 端到端耗时。

预算超支按阶段实际占用与预算比较，结果包含：

- `overrun_ms = max(0, actual_occupied_duration - budget)`
- `e2e_contribution_duration = exclusive_duration + allocated_shared_duration`

因此，超支阶段的实际超支幅度与其对端到端墙钟时间的贡献会分别展示。并发可能让后者小于超支幅度。

## 异常规则

以下情况会把请求标记为 `invalid`，且不输出归因总额，避免误导：

- 片段结束早于开始。
- 一个片段严格嵌套在另一个片段内部。
- 缺少阶段名或时间戳。
- 同请求混用数值和 ISO 时间戳。
- 预算不是有限非负数字。

零时长片段、同阶段片段重叠是非致命警告；请求仍可归因。完全重合但不同阶段的片段是合法共同占用，不是嵌套。

## 命令行与独立验证

```powershell
python -m latency_budget.cli data\sample_requests.json
python -m latency_budget.cli data\sample_requests.json --budgets budgets.json --segments
python -m unittest discover -s tests -v
```

核心 API：

```python
from latency_budget.engine import analyze_batch, analyze_request

result = analyze_batch(payload, budgets={"database": 35}, include_segments=True)
```

`analyze_batch` 和 `analyze_request` 都是无状态纯函数：重复输入得到一致输出，调整预算时传入新预算即可，不会残留上一次分析结果。算法按请求排序和扫描时间轴，复杂度约为 `O(n log n)`，测试覆盖 30,000 条请求场景。

## 代码结构

- [latency_budget/engine.py](latency_budget/engine.py)：独立归因引擎。
- [latency_budget/server.py](latency_budget/server.py)：本地 HTTP API 与静态文件服务。
- [latency_budget/web/](latency_budget/web/)：原生 HTML/CSS/JavaScript 界面。
- [latency_budget/cli.py](latency_budget/cli.py)：命令行分析入口。
- [tests/test_engine.py](tests/test_engine.py)：独立逻辑验证、异常和规模测试。
