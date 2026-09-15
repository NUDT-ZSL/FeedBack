# 多园区减排目标校准引擎（emission_engine）

纯 Python 标准库实现，完全离线运行，无需安装任何依赖。把**阶段目标 → 季度实绩 → 偏差归因 → 目标调整 → 持久化**串成一条可追溯链路。

## 运行测试

```bash
python -m unittest test_emission_engine -v
```

## 快速上手

```python
from emission_engine import CalibrationEngine

eng = CalibrationEngine(tolerance_rate=0.05, missing_threshold=2)

# 1. 注册园区：阶段区间必须连续不重叠，否则报 ValidationError 并指出位置
eng.register_park("P1", baseline=1000.0, stages=[
    {"stage_id": "S1", "start": "2026Q1", "end": "2026Q1", "allowance": 100.0},
    {"stage_id": "S2", "start": "2026Q2", "end": "2026Q2", "allowance": 100.0},
    {"stage_id": "S3", "start": "2026Q3", "end": "2026Q3", "allowance": 100.0},
    {"stage_id": "S4", "start": "2026Q4", "end": "2026Q4", "allowance": 100.0},
])

# 2. 按季度上报实绩（同源同值重复上报幂等；同源异值视为更正）
eng.report("P1", "2026Q1", 150.0, source="meter")

# 3. 查询状态：累计实绩/累计目标/偏差率/归因/缺失与冲突标注
st = eng.status("P1", as_of="2026Q1")
# st["state"] == "deviated"；st["deviation_rate"] == 0.5
# st["attribution"] 指出是 S1 段累计超出 50

# 4. 偏离后调整：S1 按实绩结算为 150，当前阶段 S2 保持 100 不变，
#    超出量 50 由剩余阶段 S3/S4 均摊（各 -25），总额度仍为 400
eng.adjust("P1", strategy="even", as_of="2026Q1")       # 或 "weighted" + weights={...}

# 5. 导出 / 载入（载入全面校验，失败报错且当前状态不变）
eng.export_json("state.json")
eng2 = CalibrationEngine.import_json("state.json")
```

## 口径约定（验收对齐）

| 概念 | 口径 |
|---|---|
| 季度 | 字符串 `"2026Q1"`（也接受 `"2026-Q1"`），内部为绝对序号 |
| 累计目标 | 已结束阶段计全部额度；当前阶段按已流逝季度数**线性折算**；未来阶段不计 |
| 累计实绩 | 仅汇总"已上报且无未决冲突"的季度 |
| 偏差率 | `(累计实绩 − 累计目标) / 累计目标`，**累计口径**，非单季口径 |
| 偏离判定 | 偏差率 > `tolerance_rate` → `deviated` |
| 数据缺失 | 尾部连续未上报季度数 ≥ `missing_threshold` → `data_missing`；缺失季度不计入累计实绩、在结果中明确标注，**不按零排放处理**，缺失未决时不判 `on_track` |
| 冲突 | 同季度多来源数值不一致 → 双方保留、生成冲突记录（季度/来源/各自数值/检测与解除的逻辑时钟，随导出载入逐项保留），该季度暂不计入累计；某方更正为一致后冲突自动解除，记录保留当时双方数值快照 |
| 幂等 | 同（园区, 季度, 来源, 数值）重复上报返回 `duplicate`，状态与逻辑时钟不变 |
| 目标调整 | 已结束阶段（end ≤ as_of）按实绩结算（额度追认为实际排放量）；**当前阶段额度保持不变**；结算出的超出量由当前阶段之后的剩余阶段承担：均摊或按权重（**权重为零的阶段不参与**，缺省按额度比例）；**全部阶段额度之和调整前后严格守恒**。数据不完整（缺失/未决冲突）或超出发生在未结束阶段时拒绝调整 |
| 逻辑时钟 | 每次有效变更 +1，随 JSON 导出/载入 |

## 主要 API

- `register_park(park_id, baseline, stages)` — 注册园区，校验阶段连续不重叠
- `report(park_id, quarter, value, source)` — 上报实绩，返回 `accepted/duplicate/correction`（及冲突信息）
- `status(park_id, as_of=None)` — 状态全量查询（含归因 `attribution`、缺失/冲突季度列表）
- `adjust(park_id, strategy="even"|"weighted", weights=None, as_of=None)` — 偏离后摊回
- `targets(park_id)` / `adjustment_history(park_id)` / `conflicts(park_id)` — 查询
- `export_json(path)` / `CalibrationEngine.import_json(path)` / `load_json(path)` — 持久化

## 导入校验（任一失败即拒绝且状态不变）

JSON 合法性 → 顶层字段齐全 → 园区标识唯一 → 阶段连续不重叠、额度为正 → 实绩季度在目标区间内、数值非负 → 调整后总量守恒（当前各阶段额度之和 = 原总目标）→ 冲突记录与实绩一致。错误信息均带园区/阶段/季度位置。
