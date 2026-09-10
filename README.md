# 流式区间聚合引擎（WindowAggregator）

把**乱序到达**的、带逻辑时间戳的事件（`add` / `retract`）按可配置的滑动区间做
聚合的离线流处理内核。纯 Python 标准库实现，无第三方依赖，可离线运行、可单测。

核心保证：

> **无论事件以什么顺序到达，每个区间的最终聚合值都与"把所有合法事件按
> `(ts, event_id)` 排序后一次性批处理"的结果完全一致。**

* `sum` 甚至做到**逐位相等**：内部用 `math.fsum` 对值的多重集求和，
  结果与累加顺序无关；
* `min` / `max` / `count` 基于每个区间维护的**有序值多重集**计算，
  撤回极值后结果依然正确。

## 文件

| 文件 | 说明 |
| --- | --- |
| `aggregator.py` | 引擎内核：`Event` / `WindowResult` / `IngestResult` / `WindowAggregator` |
| `main.py` | 命令行入口：从 stdin 逐行读 JSON 命令，每行输出一条 JSON 结果 |
| `test_aggregator.py` | 51 个 unittest，含独立的排序批处理参考实现与随机乱序对拍 |

运行环境：Python 3.8+（只用标准库）。

## 快速开始

```bash
# 跑全部测试
python -m unittest test_aggregator -v

# 命令行
python main.py --window-size 10 --slide 5 --default-agg sum < commands.jsonl
```

```python
from aggregator import WindowAggregator, Event

agg = WindowAggregator(window_size=10, slide=5, default_agg="sum")
agg.ingest(Event("a", "dev1", 1, "add", 3.0))
agg.ingest(Event("b", "dev1", 7, "add", 5.0))
agg.ingest(Event("c", "dev1", 3, "retract", 2.0))  # retract 先到 -> 暂存
agg.ingest(Event("c", "dev1", 3, "add", 2.0))      # add 后到 -> 立即抵消

for r in agg.query("dev1", 0, 10, "sum"):
    print(r.window_start, r.window_end, r.value)
# 0 10 8.0
# 5 15 5.0
```

## 1. 事件模型（`Event`）

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `event_id` | str | 非空；同一条 add 与撤回它的 retract 共用同一个 id |
| `key` | str | 非空；分组维度（设备、用户……） |
| `ts` | int | 整数**逻辑时间**（不是墙上时钟），**允许为负**，不要求单调 |
| `op` | str | `"add"` 或 `"retract"` |
| `value` | float | 有限、非负；int 输入会被规范化为 float；禁止 NaN / Infinity |

构造非法事件直接抛 `ValueError`；`ingest` 也接受 JSON 风格字典，字典构造失败
时**不抛异常**，而是计入非法事件并返回 `accepted=False` 的 `IngestResult`。

## 2. 窗口配置

* `window_size`：正整数，区间宽度；
* `slide`：正整数，滑动步长，**必须整除 `window_size`**，否则构造时
  `ValueError`；
* 区间为左闭右开 `[start, start + window_size)`，起点是 `slide` 的整数倍
  （对负时间戳也成立）；
* 一个事件落入**所有覆盖其 `ts` 的区间**：当 `window_size > slide` 时同一条
  事件同时贡献给多个区间。例如 size=10、slide=5 时，ts=3 属于
  `[-5, 5)` 和 `[0, 10)` 两个区间；
* 支持的聚合：`sum`、`count`、`min`、`max`。
  * `count` = 当前贡献给该区间的、未被撤回的 add 条数；
  * 空区间：`sum=0.0`、`count=0`、`min/max=None`（JSON 里是 `null`）。

## 3. add / retract 语义与错误策略

非法事件一律：**记录到计数（`illegal_events`）、忽略、不污染聚合**，
通过 `IngestResult.accepted=False`、`error_kind`、`error` 说明原因。

| 情况 | 处理 | `error_kind` |
| --- | --- | --- |
| 正常 add | 写入所有覆盖区间 | — |
| 重复 `event_id` 的 add | 拒绝 | `duplicate_add` |
| retract 匹配到未撤回 add，且 key/ts/value 完全一致 | 从**所有**覆盖区间移除贡献 | — |
| retract 的 key/ts/value 与原 add 不一致 | 拒绝（原贡献保留） | `retract_mismatch` |
| 对已撤回的 add 再撤回 | 拒绝 | `double_retract` |
| retract 到达时 add 还没来 | **暂存待匹配**（见 3.1） | — |
| 暂存区已有同 id 的 retract，又来一条 | 拒绝 | `duplicate_pending_retract` |
| 事件字段本身非法（负 value、坏 ts……） | 拒绝 | `invalid_event` |

### 3.1 提前撤回（retract 先于 add 到达）

采用**暂存待匹配**策略，而不是直接判非法：

1. retract 先到、找不到对应 add：放入暂存区，返回
   `status="pending_retract"`，不计非法，不影响任何聚合；
2. 对应 add 后到且 `key/ts/value` **完全一致**：立即配对抵消——add 标记为
   已撤回，其贡献**从不进入任何区间**，返回 `status="retracted"`、
   `pending_matched=True`、`windows=[]`；
3. add 后到但字段与暂存 retract **不一致**：暂存的 retract 判非法
   （`illegal_events +1`），add 正常生效，结果带 `warning` 说明；
4. 暂存 retract 直到会话结束都没等到 add：保持暂存、不计非法（无法判定它
   是不是真的会永远悬空），会随快照持久化；
5. 正常顺序（add 先、retract 后）匹配成功时，贡献从覆盖该 `ts` 的
   **全部**区间移除（数量等于 `window_size / slide`）。

无论 add 与 retract 以什么顺序到达，最终状态相同——这是乱序等价性保证的一部分。

## 4. 乱序与等价性

引擎不假设 `ts` 单调。内部状态只与"哪些 add 当前有效"这一集合有关，
与到达顺序无关：

* 每个 `(key, window_start)` 维护一个有序值多重集（`bisect` 插入/删除）；
* add 插入所有覆盖区间，retract 从所有覆盖区间删除；
* 因此 min/max 在撤回极值后仍正确，count/sum 随之更新。

测试里的 `reference_batch()` 是独立编写的排序批处理参考实现；
`test_aggregator.py` 用 60 组随机事件流（多种 size/slide、多 key、合法与
非法撤回、悬空 retract、随机打乱到达顺序）对四种聚合逐区间比对。

## 5. Watermark 与迟到事件

`advance_watermark(t)` 告诉引擎"`t` 之前的事件基本到齐了"：

* `t` 必须是非负整数，且只能**单调不减**（相等允许，回退抛 `ValueError`）；
  从未推进时 watermark 为 `None`，此时不 finalize 任何区间（包括负 ts 区间）；
* 区间 `[s, s+window_size)` 在 **`s + window_size <= watermark`** 时
  结构上关闭（closed）。边界上的点属于右侧新区间（左闭右开）。

### 5.1 迟到事件策略：接受 + 更新 + 标脏

watermark 推进后，`ts` 落在已关闭区间的事件**仍然被接受**，不丢弃、不抛异常：

* `IngestResult.late=True`，`dirty_windows` 列出被改动的已关闭区间起点；
* 受影响区间的查询结果：
  * `finalized_dirty=True`（**单调**：一旦被迟到写入改过就一直为 True）；
  * `finalized` **回退为 `False`**——明确表达"该区间虽然关闭过，但结果已
    变更，当前值不是当初 finalize 的值，需要重新查询/下发"。后续 watermark
    再推进也不会把它重置回 True；调用方用 `finalized_dirty` 去重下发；
  * 未被迟到改动的已关闭区间保持 `finalized=True, finalized_dirty=False`。
* `get_state()`：
  * `late_events`：迟到写入次数（迟到 add、迟到 retract 各计一次）；
  * `closed_active_windows`：结构上已关闭的活跃区间数（含被改脏的）；
  * `finalized_active_windows`：仍报告 `finalized=True` 的区间数
    （已关闭且未被改动）。

## 6. 查询

### `query(key, start, end, agg=None) -> list[WindowResult]`

返回查询范围内该 key 的区间结果，按 `window_start` 升序；`agg` 省略时用
构造引擎时的默认聚合。

**范围对齐策略：边界自动向 slide 网格"外扩对齐"**，保证与查询范围有交集的
区间一个不漏：

* `start` 向下取整到 slide 网格，`end` 向上取整；
* 例：size=10、slide=5，`query("k", 3, 7)` 覆盖网格区间起点 `0, 5`；
* 负边界同样成立：`query("k", -7, -1)` 给出起点 `-10, -5`；
* 空范围（`end <= start`）返回空列表；
* **网格内的每个区间都会返回一条结果，即使其中没有事件**
  （值为 0 / 0 / null / null）。

### `query_all(start, end, agg=None) -> list[WindowResult]`

返回所有 key 的区间结果，按 `(key, window_start)` 升序。只包含当前仍有活跃
贡献的 key；某 key 的贡献全部被撤回后不再出现。需要某 key 的全量网格
（含空区间）请用 `query`。

`WindowResult` 字段：`key, window_start, window_end, value, finalized,
finalized_dirty`。

## 7. `ingest` 返回值（`IngestResult`）

| 字段 | 含义 |
| --- | --- |
| `accepted` | 是否被接受（非法事件为 False） |
| `status` | `applied` / `retracted` / `pending_retract` / `rejected` |
| `windows` | 本次实际发生聚合变化的区间起点（升序）；提前撤回配对时为 `[]` |
| `late` / `dirty_windows` | 是否迟到写入 / 受影响的已关闭区间 |
| `pending_matched` | 本次 add 是否与一条暂存的提前 retract 配对抵消 |
| `error` / `error_kind` | 拒绝原因（中文消息 / 稳定的错误码） |
| `warning` | 非致命提示（如暂存 retract 与后到 add 不一致被忽略） |

## 8. 状态摘要 `get_state()`

```json
{
  "window_size": 10, "slide": 5, "default_agg": "sum",
  "watermark": 15,
  "accepted_events": 6,      // 接受的写入数（add + 生效 retract + 暂存 retract）
  "retracted_events": 3,     // 当前处于撤回状态的 add 条数
  "illegal_events": 0,       // 被记录并忽略的非法事件数
  "late_events": 3,          // 落在已关闭区间内的写入次数
  "pending_retracts": 1,     // 暂存区里等待 add 的 retract 条数
  "tracked_adds": 5,         // 已接受 add 的总条数（含已撤回）
  "active_windows": 4,       // 仍有活跃贡献的 (key, 区间) 数
  "active_keys": 2,
  "closed_active_windows": 3,
  "finalized_active_windows": 2,
  "dirty_windows": 1         // finalize 后被迟到改动的区间数
}
```

## 9. 持久化：JSON 快照

* `save(path)`：把 window 配置、watermark、计数器、**暂存 retract 区**、
  add 记录（含撤回标记）、每个区间的值多重集、脏标记集合写成 JSON
  （先写 `path.tmp` 再原子替换；`allow_nan=False`）。
* `load(path)` / `from_snapshot(dict)`：重建引擎并做**严格校验**，
  任何问题都抛 `SnapshotError`（`ValueError` 子类），绝不静默吞掉，包括：
  文件不存在 / JSON 损坏；`format`、`version` 不符；config 非法
  （slide 不整除 size 等）；watermark 不是 null 或非负整数；
  事件字段非法或 id 重复；区间起点不是 slide 整数倍；值非有限数；
  count/sum 冗余字段对不上；以及——**用事件记录重放一遍，区间多重集必须
  与快照完全相等**，否则拒绝加载。
* 暂存区也会被校验：暂存 retract 必须是 op=retract、id 不重复、且不能与
  已有 add 同 id。
* `replay(path, extra_events)`：从快照恢复后继续 ingest，返回
  `(引擎, [IngestResult, ...])`，结果与"不中断一次性处理"完全一致。
* 旧版本快照缺少 `stats.late_events` 时按 0 处理（向前兼容）。

## 10. 命令行（`main.py`）

每行一个 JSON 对象（JSON Lines），每行输出一条 JSON；空行忽略。
命令处理失败返回 `{"ok": false, "error": "...", "error_kind": ...}`；
非法事件被引擎拒绝时命令本身仍 `"ok": true`，但载荷里
`"accepted": false` 并带 `error`。

```bash
python main.py --window-size 10 --slide 5 --default-agg sum
```

| 命令 | 示例 |
| --- | --- |
| `config` | `{"cmd":"config","window_size":10,"slide":5,"default_agg":"sum"}`（重建空引擎） |
| `ingest` | `{"cmd":"ingest","event":{"event_id":"a","key":"k","ts":1,"op":"add","value":3}}` |
| `retract` | `{"cmd":"retract","event":{"event_id":"a","key":"k","ts":1,"value":3}}`（op 强制为 retract；事件字段也可平铺） |
| `query` | `{"cmd":"query","key":"k","start":0,"end":20,"agg":"sum"}` |
| `query_all` | `{"cmd":"query_all","start":0,"end":20,"agg":"min"}` |
| `watermark` | `{"cmd":"watermark","t":15}` |
| `state` | `{"cmd":"state"}` |
| `save` / `load` | `{"cmd":"save","path":"snap.json"}` |
| `dump` | `{"cmd":"dump"}`（输出完整快照 JSON） |

`query` / `query_all` 的结果在 `results` 字段中，元素即 `WindowResult`。

## 11. 边界情况一览

* 空引擎：`query` 返回对齐后的网格区间，值为 0/0/null/null；`query_all`
  返回空列表；watermark 为 `None`；
* 单事件：按重叠度写入 1 个或多个区间；
* `window_size` 不被 `slide` 整除 / 非正数：构造即报错；
* `ts` 为负：完全支持，区间网格向负方向无限延伸；
* `value` 为负 / NaN / Infinity：`Event` 构造抛错，字典路径记非法；
* 重复 `event_id` 的 add：拒绝；
* retract 不存在的 id：进入暂存区（见 3.1），永不配对则随快照保留；
* retract 已撤回的 add：`double_retract` 拒绝；
* watermark 回退 / 负数：抛 `ValueError`，CLI 以 JSON 错误返回；
* query 范围为空（`end <= start`）：返回 `[]`；
* query 范围不对齐 slide：自动外扩对齐（见第 6 节）；
* 区间内无事件的 min/max：`None`。

## 12. 测试

```bash
python -m unittest test_aggregator -v
```

覆盖：事件校验、窗口配置与区间覆盖、四种聚合正确性、key 隔离、retract
全部匹配路径（含提前撤回、字段不一致、双重撤回、重复 add）、watermark
边界与迟到标脏语义、查询对齐与空范围、快照往返与十余种损坏注入、
replay 等价性、CLI 全命令与错误 JSON，以及：

* 60 组随机乱序事件流 × 4 种聚合与排序批处理参考实现对拍；
* `sum` 在不同到达顺序下逐位相等；
* "提前撤回 + watermark 后迟到 + 中途快照往返"混合场景对拍
  （`RegressionTests.test_mixed_pending_late_snapshot_equivalence`）。
