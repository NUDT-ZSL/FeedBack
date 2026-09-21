# 延迟预算归因分析

这是一个完全本地、无第三方运行依赖的离线分析组件。归因逻辑位于纯 Python 模块中，界面只负责调用该模块和展示结果。

## 数据模型

输入 JSON 可以是数组，也可以是包含 `requests` 数组的对象：

```json
{
  "requests": [
    {
      "id": "req-001",
      "name": "可选名称",
      "segments": [
        {"id": "s1", "name": "db", "start_ms": 10, "end_ms": 80}
      ]
    }
  ]
}
```

预算是阶段名到非负毫秒数的映射。字段留空表示该阶段不设置预算。

## 归因规则

- 端到端范围为最早开始时刻到最晚结束时刻。
- 任意时刻只有一个阶段活动：该段墙钟时间计为该阶段的独占耗时。
- 多个阶段部分重叠：该段墙钟时间作为共同占用，在同时活动的不同阶段间均分。
- 没有阶段活动的空档保留为未归因，不会分摊到阶段。
- 同一阶段的同名片段按阶段聚合；实际占用按该阶段的活动并集计算。
- 阶段超支为 `实际占用 - 预算`。预算尾部沿时间轴进行相同的均摊积分，得到“对端到端增加”；墙钟超支与该贡献的差为“被重叠遮蔽”。

错误级异常会使请求标记为 `invalid`，保留原始片段但不生成归因数字：

- 时间倒置：`end_ms < start_ms`
- 嵌套或完全重复的正长度片段
- 缺失片段数组、阶段名或时间戳

零长度片段是警告，可作为点事件展示。

## 启动界面

```powershell
python -m web.app
```

或在 Windows 上双击 `start_ui.bat`。启动后访问 `http://127.0.0.1:8000/`，默认自动打开浏览器并加载 `sample/` 中的本地样例。也可在界面右上角选择“加载本地 JSON”；文件由浏览器在本机读取并交给同源本地服务，不会发送到外部。界面中的每次预算调整都会重新调用无状态分析函数，不复用上一次的归因结果。

## 命令行批量分析

```powershell
python analyze.py --input sample/sample_requests.json --budgets sample/sample_budgets.json --output analysis.json
```

批量模式默认省略每条请求的完整时间线，适合数万请求量级；加入 `--timeline` 可在需要独立审计时输出完整切片。

## 独立验证

```powershell
python -m unittest discover -s tests -v
```

核心 API：

```python
from latency_budget.analyzer import analyze_batch, analyze_request

single = analyze_request(record, budgets={"db": 100})
batch = analyze_batch(records, budgets={"db": 100}, include_timeline=False)
```
