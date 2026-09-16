# 园区排放连续观测异常识别模块

离线、确定性、可验收的异常识别模块：维护若干监测来源（烟囱、污水口等），
按来源自身历史判定异常，区分设备故障与真实超标，并支持同源聚类与增量重算。

纯 Python 3.10+，无第三方依赖；测试使用 pytest。

## 快速开始

```python
from emission_monitor import MonitoringSystem, Reading, ThresholdSegment

s = MonitoringSystem()

# 1. 注册监测来源：唯一标识 + 所属园区 + 指标类型 + 上报周期
s.add_source("stack-1", park="东区", metric_type="SO2", period=10, max_missed_periods=1)

# 3. 配置基线曲线（点间线性插值）与分段阈值（同一时刻最多一段生效）
s.set_baseline("stack-1", [(0, 100.0), (1000, 100.0)])
s.set_thresholds("stack-1", [
    ThresholdSegment(0, 500, tolerance=5.0, max_jump=10.0, upper=150.0),
    ThresholdSegment(500, None, tolerance=8.0, max_jump=10.0, upper=150.0),  # 分段调整
])

# 2. 按逻辑时刻上报读数；重复上报幂等，时刻倒退 / 非数值拒绝并指出批次位置
results = s.ingest([Reading("stack-1", 0, 101.0), Reading("stack-1", 10, 140.0)])
for r in results:
    print(r.status, r.reason)

# 4. 异常判定（偏离 / 跳变 / 越界），每条都带判定依据
for a in s.anomalies("stack-1"):
    print(a.kind, a.reason, a.evidence)

# 5. 数据缺失：连续多周期未上报的区间被明确列出，不按零值参与判定
for iv in s.missing_intervals("stack-1"):
    print(iv.describe())

# 6. 同源聚类：同园区 + 同指标 + 同时段的多来源异常，给出贡献占比
for c in s.clusters(window=20):
    print(c.describe())

# 7. 多通道矛盾读数：双方保留，生成可读冲突记录
for c in s.conflicts():
    print(c.describe())

# 8. 阈值调整 / 基线修正后只增量重算受影响时段；可随时校验与全量重判一致
s.set_thresholds("stack-1", [ThresholdSegment(0, None, tolerance=6.0)])
assert s.is_consistent("stack-1")
assert s.anomalies("stack-1") == s.recompute_all("stack-1")
```

## 需求映射

| # | 需求 | 实现 |
|---|------|------|
| 1 | 来源维护 | `add_source`（唯一标识、园区、指标类型、周期），`readings()` 按逻辑时刻有序 |
| 2 | 幂等 / 拒绝 | `ingest` 逐条返回 `IngestResult`：`duplicate` 幂等忽略；时刻倒退、非数值 `rejected` 并在 `reason` 中指出批次位置 |
| 3 | 基线 + 分段阈值 | `set_baseline`（线性插值曲线）；`set_thresholds` 校验分段不重叠，重叠抛 `ValueError` |
| 4 | 异常判定 | 偏离基线超容差 `deviation`、单周期跳变过大 `jump`、越界 `out_of_bounds`；`Anomaly.evidence` 保存基线值/容差/前一读数/限值等判定依据，`reason` 为可读说明 |
| 5 | 数据缺失 | `missing_intervals` 列出每段缺失的全部逻辑时刻；缺失不参与判定、跳变判定不跨越缺失区间 |
| 6 | 同源聚类 | `clusters(window)` 按园区 + 指标分组，时间间距 ≤ window 的异常聚成一簇；≥2 个来源才判“可能同源”，贡献占比按各来源异常严重度归一化 |
| 7 | 冲突记录 | 同一时刻矛盾数值双方均保留（`readings` 可见），`conflicts` 给出时刻、双方通道与各自数值的可读记录 |
| 8 | 增量重算 | 阈值/基线变更只重算取值发生变化的时段（`recompute_log` 可核对），区间外判定原样保留；`is_consistent` / `recompute_all` 验证与从头重判完全一致 |

## 关键设计

- **判定是纯函数**：某时刻的判定只依赖该时刻读数、该时刻生效的阈值、该时刻基线值，
  以及“上一条读数”（仅跳变判定用）。因此增量重算只需把区间前最近一条读数作为上下文，
  结果与全量重判逐条相等。
- **受影响时段精确计算**：阈值是阶梯函数，在分段边界采样比较即得差异区间；基线是分段
  线性函数，在合并点集划出的每个基本区间中点采样，不同则整个区间计入，相邻区间合并。
- **冲突读数的判定**：同一时刻的多个矛盾数值各自独立参与判定（哪条通道的读数异常，
  异常就记在谁头上），冲突本身另记为 `ConflictRecord`。

## 运行测试

```bash
python -m pytest tests/ -q
```

37 个用例覆盖上述 8 条需求：`test_ingest`（1/2）、`test_detect`（3/4）、
`test_missing`（5）、`test_cluster`（6）、`test_conflict`（7）、`test_detect`/`test_recompute`（8）。
