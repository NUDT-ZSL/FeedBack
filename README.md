# 数据血缘推演台(本地离线)

检查派生数据集在字段口径、上游来源或加工步骤变化后, 哪些下游需要重算、
哪些结论已失效。纯 Python 标准库 + 原生前端, 零外部依赖, 完全离线运行。

## 启动

```
python server.py
```

然后浏览器打开 http://127.0.0.1:8000 (端口可用环境变量 LINEAGE_PORT 修改)。

## 运行测试

```
python -m unittest test_engine -v
```

## 功能与需求对照

1. **派生链路维护**: 数据集 + 派生依据(上游、加工步骤、字段映射),
   同一数据集可被任意多个下游引用(见演示数据 dwd_order_detail)。
2. **影响推演**: 修改/停用/替换上游后, 沿派生边推出受影响闭包,
   区分 `需要重算(stale)` 与 `结论失效(invalid)` 两类状态并逐级传递。
3. **冲突保留**: 同一目标存在多条生效派生依据时全部保留并标记
   `依据冲突(conflict)`, 界面可一键"采用此条"裁决, 其余自动置为 superseded。
4. **增量一致**: 每次变更只重算受影响下游闭包; 服务端同时跑全量推演校验,
   事件日志中的 `consistent` 字段为校验结果, 不一致时自动回退全量。
   `test_incremental_matches_full` 用 300 步随机变更验证两种模式结果相同。
5. **异常定位**: 循环依赖(给出完整环路径)、上游缺失、字段映射不完整/
   引用不存在字段, 都会定位到具体数据集与派生依据并写入诊断面板。
6. **本地界面**: 血缘图(按拓扑深度分层)、数据集列表、详情编辑器、
   诊断面板、操作日志(每次操作后的状态变化)同屏展示。

## 状态语义

| 状态 | 含义 |
| --- | --- |
| ok | 结论新鲜可信 |
| stale | 上游定义已变更, 需要重算 |
| invalid | 结论失效(上游缺失/停用/失效、映射残缺、循环依赖) |
| conflict | 多条派生依据冲突, 待人工裁决 |
| disabled | 数据集已停用 |

## 文件结构

- `lineage_engine.py` — 推演引擎(纯函数, 支持全量/增量两种模式)
- `server.py` — HTTP API + 静态服务 + JSON 持久化(data.json)
- `static/` — 单页前端(原生 JS + SVG, 无 CDN 依赖)
- `test_engine.py` — 引擎单元测试与增量一致性测试

## API 一览

- `GET /api/state` 全量状态快照
- `PUT /api/datasets/{id}` 修改定义(版本+1, 触发影响分析)
- `POST /api/datasets/{id}/status` 停用/启用
- `POST /api/datasets/{id}/recomputed` 标记已重算
- `POST /api/derivations` / `PUT` / `DELETE /api/derivations/{id}` 派生依据增改删
- `POST /api/derivations/{id}/adopt` 裁决采用某条依据
- `POST /api/reset` 重置为演示数据
