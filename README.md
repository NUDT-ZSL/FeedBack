# 改版体验归因引擎

离线、纯标准库（Python 3.9+，无第三方依赖）的版本迭代体验指标归因引擎。
回答每次发版后的核心问题：**指标变化里，多少是改版带来的真实变化，多少是
用户结构变化 / 自然波动，变化能否沿一条可追溯、可守恒校验的链路拆开。**

## 运行

```bash
# 单元测试（29 个，覆盖需求 1–8）
python -m unittest discover -s tests -v

# 离线验收演示（端到端叙事场景）
python examples/acceptance_demo.py
```

## 包结构

| 文件 | 职责 |
| --- | --- |
| `attribution/clock.py` | 可注入、单调非递减的逻辑时钟 |
| `attribution/records.py` | 不可变记录：`Revision`、`Segment`、构成纪元 `Epoch` |
| `attribution/engine.py` | 注册校验、归属裁决、幂等观测、归因分解、来源链与查询 |
| `attribution/store.py` | JSON 快照原子写入 / 载入全量校验（含守恒复查） |
| `attribution/errors.py` | `ValidationError`（带 JSON 指针风格的出错位置） |
| `tests/test_attribution.py` | 单元测试 |
| `examples/acceptance_demo.py` | 离线验收演示 |

## 核心概念

### 逻辑时钟

所有时刻都是 `int` 逻辑刻度。登记改版 / 分群 / 纪元 / 观测都不允许晚于时钟
当前值（杜绝“向未来写数据”）；时钟不可回拨。测试时可注入 `supplier`。

```python
from attribution import AttributionEngine, LogicalClock

clk = LogicalClock(0)
eng = AttributionEngine(clk, composition_threshold=0.5)
clk.advance(1)
eng.register_segment("power", 1, ["p1", "p2"])
```

### 分群、构成纪元与唯一归属

- 分群有唯一 id、进入时刻（首个纪元）和一组用户；用户在分群内去重。
- 同一分群的成员构成可用 `replace_composition(seg, time, users)` 在**严格
  递增**的时刻替换（构成纪元），从而表达“改版前后同一分群换了一批人”。
- 同一用户同一时刻被多个分群声称拥有时，按确定性规则裁决：**分群 id
  字典序最小者保留，其余拒绝**，全部进入 `assignment_conflicts()` 台账；
  台账由当前全量纪元推导，**与登记顺序无关**。
- `active_members(seg, t)` 返回该分群在 `t` 真正拥有的成员。

### 观测：幂等与缺失

`observe(segment, time, item, value)` 的唯一键是 `(分群, 时刻, 体验项)`：

- 同值重复上报：幂等忽略；
- 异值重复上报：保留首次值，返回并记录一条 `DuplicateObservation`；
- 未上报（或当时无活动成员）的格子：`value_at()` 返回 `None`，
  `missing_slots(item)` 显式列出缺失的 `(分群, 时刻)`——**绝不补零**；
  真实上报的 `0.0` 正常保留。

## 归因方法

对比域取窗口前后两侧都上报了该体验项、且都有活动成员的分群；窗口边缘只
出现一侧的分群进入 `excluded_segments`（缺失不猜）。设分群 `g` 前后活动
成员数为 `n0, n1`，域内总人数 `N0, N1`，成员份额 `p = n/N`，取值 `y`：

```
分群总贡献  total_g = p1·y1 − p0·y0
真实变化    real_g  = (p1 + p0)/2 · (y1 − y0)      # 分群内水平变化
结构混合    mix_g   = (y1 + y0)/2 · (p1 − p0)      # 成员跨分群迁移
```

这是对称的 Kitagawa/Shapley 分解，恒有 `real_g + mix_g = total_g`，
且 `Σ_g total_g` 恰好等于域内按成员加权的整体均值变化。

**构成判定**：若分群前后活动成员的 Jaccard 相似度
`|S0∩S1| / |S0∪S1|` 低于阈值（默认 0.5），认为该分群“构成明显不同”，
其分群内水平变化不计入改版真实效果，而计入 `composition_migration`
（归入结构项），该分群出现在 `composition_segments` 中，并给出其对总变化
绝对值的贡献占比 `segment_shares`（占比之和为 1）。

**抵消**：结构项与真实项异号时（典型：低分群体扩张拖累均值，而改版实际在
提分），`canceled_by_structure = min(|structural|, |real|)`，即被用户
结构掩盖 / 抵消掉的改版效果。体验项级与来源链段级都在汇总层判定。

### 多次改版：来源链

`item_chain(item)` 以相邻观测刻度之间的间隔为一段（望远镜拆分）：

- 每段归因给生效时刻落在该间隔内、生效最晚的改版；
- 间隔内没有改版 → 标注 `"(自然波动)"`；
- 两次改版挤在同两个观测刻度之间时，观测上不可区分，整段确定性归给最晚
  改版（不凭空拆分）；
- 采用**平衡面板**：链上每个刻度都有观测的分群才入链，其余列入
  `excluded_segments`；
- 恒有 `Σ 段贡献 == 末值 − 首值`，结果只取决于数据，与登记顺序无关。

### 查询

| 方法 | 返回 |
| --- | --- |
| `attribute_revision(rev_id)` | 改版完整报告（逐体验项、逐分群的 total/structural/real、mix、构成迁移、Jaccard、占比、抵消、排除分群） |
| `net_impact(rev_id)` | `{体验项: 真实变化}`（剔除结构后的改版净影响） |
| `segment_contributions(rev_id)` | 各体验项上各分群贡献占比（稳定排序） |
| `canceled_parts(rev_id)` | 各体验项上被结构抵消的部分（按分群） |
| `item_chain(item)` | 体验项变化来源链 |
| `all_reports()` | 全部改版报告，按 `(生效时刻, id)` 排序 |

所有结果为不可变 dataclass，排序键固定；重复计算返回完全相等的结果。

## JSON 快照

`store.save(eng, path)` / `store.load(path)`（或 `to_dict` /
`load_dict`）。快照包含：逻辑时钟、改版、分群（含全部构成纪元）、观测、
阈值，以及**归因结果段**（所有当前可计算的改版报告与来源链）。写入采用
临时文件 + `os.replace` 原子替换。

载入时在一个**全新引擎**上重建并依次校验，任一失败即抛带位置的
`ValidationError`，调用方原有引擎状态不变：

1. JSON 合法、顶层与必填字段、类型、`format_version`；
2. 标识唯一（改版 id、分群 id、观测键）、时刻为整数且不晚于时钟、纪元
   严格递增、观测引用的分群存在且当时有活动成员；
3. 同观测键冲突值、NaN/Inf 拒绝；
4. 快照中存储的归因数字独立做守恒检查（`结构+真实==总变化`、
   `mix+构成迁移+真实==总变化`、`Σ链段==首末总变化`）；
5. 用重建数据**重算**全部报告与来源链，与快照归因段逐项比对，篡改归因
   结果（即使保持表面守恒）也会被拒绝。

## 需求到实现的对照

| 需求 | 实现位置 / 测试 |
| --- | --- |
| 1 改版登记与位置化校验 | `register_revision`、`records.Revision`；`RevisionTests` |
| 2 分群、唯一归属、确定性裁决台账 | 构成纪元、`owner_at`、`assignment_conflicts`；`SegmentTests` |
| 3 逻辑时钟、幂等观测、缺失标注 | `LogicalClock`、`observe`、`value_at`、`missing_slots`；`ObservationTests` |
| 4 前后变化与结构/真实守恒分解 | `_window_attributions`；`DecompositionTests` |
| 5 构成不同归因到结构 + 占比 | Jaccard 判定、`composition_segments`、`segment_shares`；`CompositionAttributionTests` |
| 6 多次改版逐段拆分、段和守恒、顺序无关 | `item_chain`；`ChainTests` |
| 7 净影响/贡献/抵消/来源链、稳定可复算 | 查询方法；`CancellationTests`、`QueryTests` |
| 8 JSON 快照与载入校验、失败状态不变 | `store`；`StoreTests` |

## 口径说明（重要假设）

- 观测按分群整体上报一个群体取值（可理解为该分群该时刻的指标均值），由
  当时活动成员共享；成员级原始数据不在本引擎范围内。
- 跨分群按**活动成员数加权**（而非分群等权），这样“某类用户扩张/收缩”
  才能作为结构项与改版真实效果异号、相互抵消。
- “构成明显不同”用前后成员 Jaccard 阈值判定，阈值可在构造引擎时注入。
- 守恒统一以浮点 `math.isclose`（容差 1e-7）校验；断言失败抛
  `ConsistencyError`。
