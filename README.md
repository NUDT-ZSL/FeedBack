# eventagg — 离线事件时间聚合引擎

纯 Python、零依赖、不接任何外部服务的事件时间聚合引擎。所有"当前时刻"都来自
可注入的逻辑时钟（`ManualClock`），可完全离线运行与单元测试。

## 运行测试

```bash
python -m pytest tests -q
```

## 快速上手

```python
from eventagg import Event, EventTimeEngine, ManualClock

clock = ManualClock()
engine = EventTimeEngine(window_size=10, allowed_lateness=5, clock=clock)

engine.register_domain("sales")
engine.register_group("g1", "sales")

engine.ingest(Event("e1", "g1", event_time=100, arrival_time=100, value=1.0, source="A"))
result = engine.ingest(Event("e2", "g1", event_time=90, arrival_time=110, value=2.0))
# result.status == IngestStatus.LATE, result.lateness_excess == 5

engine.window_stats("g1")        # {窗口起点: WindowStats(count/total/min/max/mean/late_count)}
engine.window_events("g1", 90)   # 窗口内事件明细（含迟到标记与超出量）
engine.watermark("g1")           # 水位线位置
engine.corrections("g1")         # 迟到/冲突解决对结果的修正轨迹（before -> after）
engine.snapshot_as_of("g1", 105) # 任意时刻的 as-of 视图
```

## 语义约定（验收口径）

1. **分组登记**：先 `register_domain` 再 `register_group`。分组标识全局唯一，
   重复抛 `DuplicateGroupError`，域未登记抛 `UnknownDomainError`，
   错误均携带 `location`（如 `register_group(group_id='g1', ...)`）指出位置。
2. **事件校验**：`event_time > arrival_time` 拒绝（`field="event_time"`）；
   `value` 必须为有限实数（拒绝字符串 / None / NaN / inf / bool 并说明原因）。
3. **窗口归属**：窗口起点 = `floor(event_time / window_size) * window_size`。
   同一 `event_id` 以相同 `(event_time, value)` 重复到达 → 幂等去重，不重复计入。
4. **迟到判定**：水位线 = 该分组已到达事件的最大事件时间（单调不减）。
   `arrival_time > watermark + allowed_lateness` 即迟到，
   超出量 `excess = arrival_time - watermark - allowed_lateness` 在结果与修正记录中给出。
   迟到事件**仍然计入**统计（修正已有结果），绝不静默丢弃或当作准时。
5. **增量重算**：常规到达只重算该事件所在窗口；`recompute_from_scratch(group)`
   提供从头全量重算，测试在每次操作后断言两者完全一致。
6. **冲突**：同一 `event_id` 的 `(event_time, value)` 矛盾时，双方版本全部保留，
   生成可读 `ConflictRecord`（指出事件、双方来源、各自取值）。统计默认先到生效，
   `resolve_conflict(event_id, source)` 可切换生效版本。
7. **查询**：`window_stats` / `window_events` / `watermark` / `corrections` /
   `conflicts` / `snapshot` / `snapshot_as_of`（as-of 只计入 `arrival_time <= t`
   的事件，冲突解决按 t 之前的生效版本回放）。
8. **一致性**：迟到或冲突解决后，未受影响窗口统计值保持不变；
   受影响窗口与从头全量重算完全一致。冲突解决可能改变水位线推进路径
   （进而改变后续事件的迟到标记），因此解决时对全组做确定性重算并逐窗口记录修正。

## 目录结构

```
eventagg/
  clock.py    # Clock 协议 + ManualClock（可注入逻辑时钟）
  errors.py   # 带 location/field 的错误类型
  models.py   # Event / WindowStats / ConflictRecord / Correction / IngestResult / Snapshot
  engine.py   # EventTimeEngine 核心
tests/
  test_engine.py  # 27 个验收测试，逐条映射需求 1-8
```
