# 离线性能剖析模块

分析一次运行会话中各调用帧的耗时分布并定位热点。纯标准库实现（Python 3.10+），离线可验收。

## 运行测试

```bash
python -m pytest tests/ -q
```

## 结构

- `profiler/models.py` — 公开数据模型：`Sample`、`ConflictRecord`、`GapRecord`、`FrameStats`、`ChainLink`、`ContributionReport` 等
- `profiler/session.py` — `ProfilerSession`：帧树维护、采样摄入、归并与增量重算、查询
- `profiler/errors.py` — `FrameError` / `GapError`
- `tests/test_profiler.py` — 37 个测试，按需求 1~7 分组

## 快速上手

```python
from profiler import ProfilerSession, Sample

s = ProfilerSession(hotspot_threshold=0.2)
s.add_frame("root", "t1", "main")
s.add_frame("a", "t1", "func_a", parent_id="root")

report = s.add_samples([
    Sample(thread_id="t1", timestamp=1, frame_id="root", depth=0, self_time=5.0),
    Sample(thread_id="t1", timestamp=2, frame_id="a", depth=1, self_time=3.0),
])
print(report.accepted, report.rejected)   # 拒绝项带批次位置与原因

s.mark_gap("t1", 10, 20, reason="线程中断")  # 数据缺失，不折算为零

st = s.frame_stats("a")       # 自耗时/累计/占比/是否热点/资格原因
hot = s.hotspots()            # 稳定排序：累计降序、标识升序
chain = s.call_chain("a")     # 根 → 目标帧的完整调用链
src = s.contributions("a")    # 各来源贡献 + 涉及该帧的冲突记录
```

## 关键设计决策

1. **帧树**：帧标识唯一；父帧必须先登记（根帧 `parent_id=None`）；`reparent_frame` 修正归属时沿新父链向上检查成环。递归/动态派发产生的同名帧是不同节点，天然支持重复帧。
2. **采样校验**：同一 `(线程, 时刻)` 的重复采样（帧与自耗时完全一致）幂等跳过；自耗时非正、深度与帧实际深度（祖先数，根为 0）不一致、帧不存在、线程不匹配都会被拒绝，拒绝记录带批次下标与原因，不中断整批。
3. **归并不变式**：每帧 `累计 = 自耗时 + Σ 直接子帧累计`；会话总耗时 = 根帧累计之和。测试对全部帧逐条断言该不变式。
4. **数据缺失**：`mark_gap` 只标记区间，绝不生成零耗时采样；采样时刻区间与缺失区间相交的帧被标记 `gap_affected`，失去热点资格（`eligible=False` 并给出原因），耗时本身仍如实统计。
5. **冲突**：同一 `(线程, 时刻)` 出现不同观测时，先撤回原有观测的聚合贡献，再把双方（及后续各方）一并保留在 `ConflictRecord` 中——双方均不计入聚合，绝不静默择一；`describe()` 生成指出帧、来源、数值的可读文本。完全一致的重报视为幂等而非冲突。
6. **增量重算**：摄入或改归属只把受影响帧及其祖先标脏，按深度从深到浅重算这些帧的累计；`recompute_full()` 从已接受采样全量重建。测试断言：分批摄入 == 一次摄入、增量 == 全量、改归属后 == 按最终结构从头归并，且未受影响帧的耗时逐值不变。
7. **查询**：`frame_stats`（自耗时/累计/占比/热点/资格原因）、`hotspots`（累计降序 + 标识升序的稳定排序）、`call_chain`（根到目标帧）、`contributions`（来源按名称排序，冲突按时刻排序）。所有查询结果可重复。

## 已知边界

- 深度校验发生在摄入时刻；摄入后再 `reparent_frame` 改变子树深度时，已入库采样不会重新校验（重算只重做聚合，不重做摄入校验）。
- 幂等判定对自耗时做精确相等比较；浮点噪声导致的"同一样本微小差异"会被视为冲突而非重复——这是有意为之，矛盾数据必须显式可见。
