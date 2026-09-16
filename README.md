# subalign — 离线多语言字幕时间轴对齐模块

纯 Python 标准库实现，无外部依赖、无网络调用，可离线验收。把若干来源的
候选字幕轨对齐到一份基准时间轴，**分别**识别整体平移、线性速率漂移和
中段缺失，并保留跨轨矛盾参数供人工复核。

## 快速开始

```python
from subalign import AlignConfig, Entry, Reference, SubtitleTrack, SubtitleSystem, to_json, from_json

ref = Reference([Entry(0, 3000, "片头 NASA 2024"), ...], source="母版")
track = SubtitleTrack("en-web", "web 版 23.976fps", [Entry(120, 3120, "Intro NASA 2024"), ...])

sys = SubtitleSystem(ref, [track], config=AlignConfig(tolerance_ms=250))
sys.align()

# 任意时刻查询（校正后时刻 + 所用参数 + 参与锚点）
q = sys.correct_time("en-web", "00:05:00.000")
print(q.corrected_ms, q.ratio, q.shift, [(a.ref_index, a.cand_index) for a in q.anchors])

# 三类偏差分项
b = sys.report("en-web").bias
print(b.shift_ms, b.rate_ratio, b.missing_intervals, b.shift_basis, b.rate_basis)

# 跨轨矛盾（双方参数都保留）
for c in sys.conflicts(): ...

# 单文件持久化（原子写入；载入时重算并与存储结果逐项核对）
to_json(sys, "project.json")
sys2 = from_json("project.json")
```

逐步推导式验收：

```bash
python demo_acceptance.py                # 42 项 PASS/FAIL 推导比对 + 完整报告
python demo_acceptance.py project.json   # 同时导出工程文件
python -m pytest tests/ -q               # 66 个单元测试
```

## 模型与约定

| 概念 | 表示 |
|---|---|
| 时刻 | 整数毫秒；`to_millis()` 接受 int/float/`Fraction`/`HH:MM:SS.mmm` |
| 校正模型 | 分段线性 `ref = ratio · cand + shift`，`ratio/shift` 为 `Fraction`，全程精确无浮点 |
| 锚点 | 条目中点文本匹配；`exact`（归一化全等）或 `fuzzy`（共有实词/拼写相似） |
| 段 | 中段缺失两侧各一段，候选时刻半开域 `[domain_lo, domain_hi)` 首尾相接覆盖全轴 |

关键确定性约定：

* 锚点匹配是"基准索引、候选索引双严格递增"约束下的**加权最优单调双射**
  （精确匹配权重 2，模糊匹配权重为相似度），杜绝一对多；平手由索引
  字典序裁决，结果与锚点到达顺序、轨插入顺序无关。
* 每段拟合用精确 OLS（两点即两点式），只依赖点集，置换输入结果不变。
* 所有排序都有确定键；分数参数以 `"p/q"` 文本存取；重复计算字节级一致。

## 三类偏差如何分别处理

1. **整体平移**：段截距 `shift`（候选 0ms 对应的基准毫秒），附锚点数与置信度。
2. **线性速率漂移**：段斜率 `ratio`（帧率比，1 为无漂移），漂移量随时刻
   线性增大；置信度取决于锚点时间展布与残差。
3. **中段缺失（支持多处互不相邻）**：先用 O(n) 局部窗口扫描预筛候选
   边界（紧邻两侧各 w 个锚点各自拟合，分界处基准轴错位量 ≥ `min_cut_gap_ms`
   才入选），再用只允许在候选位置切分的**全局分段回归 DP**（前缀和 O(1)
   求段 OLS 误差）枚举分段数，取第一个通过逐分界校验的方案（错位/段内
   残差信噪比 ≥ `cut_residual_factor`）。两处缺失相距很近、中段锚点数
   与两侧接近时，局部判据会被另一处缺失污染，而全局 DP 只有在两个真
   位置同时切分才能让各段残差归零。缺失区间优先取"两侧锚点间缺失的
   基准条目"时间并集（可逐条复核），两侧分别拟合，**缺失绝不进入速率
   拟合**——避免被误当成内容压缩。前提：相邻切口之间至少 w 个锚点
   （默认 2，即中间段速率可辨识的最低条件）。

## 跨轨冲突

对每两条轨的每对"基准覆盖区间相交"的段，检查（满足其一即记录）：

* `|ratio_a − ratio_b| > conflict_rate_eps`；
* 对称错位量 `(ratio_a+ratio_b)/2 · |c_a − c_b| > conflict_shift_eps_ms`
  （`c_a,c_b` 为区间中点在两轨上的逆映射候选时刻）。

冲突记录包含区间、双方来源 id、双方各自参数与超限量，双方原始报告原样
保留，系统不静默择一。

## 容差报告

逐锚点计算残差（基准中点 − 校正值），超过 `tolerance_ms` 的锚点按基准
条目时间重叠合并为区间，输出区间、最大残差与涉及锚点，按基准起点稳定
排序。锚点不足、无法拟合的轨状态为 `insufficient_anchors`，不产生参数。

## 工程文件（JSON v1）

包含：`reference`、`tracks`（id/来源/条目）、`config`（含容差）、
`results`（每轨锚点、分段 ratio/shift/段域/残差、三类偏差、缺失区间、
容差超限区间）、`conflicts`。

载入时：

1. 先做 JSON 解析、字段完整性、标识唯一、时刻合法（非负/止≥起/单调不减）
   与配置自洽校验，问题一次性收集并在错误信息中指出位置；
2. 通过后在**临时对象**上重跑确定性流水线，与文件内存储结果逐项精确比对；
3. 任一不符即抛 `PersistenceError`（列出全部问题），不返回半成品，
   调用方已有系统状态不变。

## 代码结构

```
subalign/
  timecode.py    毫秒整数与时间码
  textnorm.py    多语言归一化/相似度（Jaccard + 二元组 Dice + 实词覆盖）
  model.py       输入/结果数据模型与配置（内置校验）
  matcher.py     单调双射锚点匹配
  fitter.py      精确 OLS、候选预筛 + 全局分段回归 DP、分段建模、偏差汇总
  analysis.py    容差报告、跨轨冲突
  system.py      门面：SubtitleSystem（维护/对齐/查询）
  persistence.py JSON 导出导入与载入校验
  report.py      中文可读报告
tests/           66 个单元测试（8 条需求 + 多缺口场景覆盖）
demo_acceptance.py  逐步推导验收脚本
```
