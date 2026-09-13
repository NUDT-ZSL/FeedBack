# 内存时序索引（TimeSeriesIndex）

纯 Python 标准库实现的内存时序索引，面向本地指标采集器：按时间范围快速查点、
按时间范围批量删点、对索引打快照并回滚到任意快照点。支持 JSON 持久化与
逐行 JSON 命令的命令行入口。**无第三方依赖，离线可跑。**

- Python 3.9+（仅用标准库：`dataclasses`、`json`、`math`、`random`、`tempfile` 等）
- 平台无关，Windows / Linux / macOS 均可运行

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `timeseries_index.py` | 索引核心：`Point`、`TimeSeriesIndex`、Treap、异常、JSON 持久化 |
| `main.py` | 命令行入口：stdin 逐行读 JSON 命令，stdout 逐行输出 JSON 结果 |
| `test_timeseries_index.py` | `unittest` 测试套件（44 个用例，含 3 万点规模测试） |
| `README.md` | 本文档 |

## 快速开始

### 作为库使用

```python
from timeseries_index import TimeSeriesIndex, Point

idx = TimeSeriesIndex()

# 插入（Point 对象或等价 dict 均可）
idx.insert(Point("p1", "cpu.usage", 100, 0.82))
idx.insert_many([
    {"point_id": "p2", "series": "cpu.usage", "ts": 100, "value": 0.91},
    {"point_id": "p3", "series": "cpu.usage", "ts": 105, "value": 0.77},
])

# 范围查询 [start, end)，按 (ts, point_id) 升序
idx.range_query("cpu.usage", 100, 105)   # -> p1, p2（同 ts 按 point_id 排）

# 范围删除，返回删除点数
idx.range_delete("cpu.usage", 0, 105)    # -> 2

# 快照与回滚
idx.snapshot("before-deploy")
idx.insert({"point_id": "p9", "series": "cpu.usage", "ts": 200, "value": 1.0})
idx.rollback("before-deploy")            # p9 消失，此前删掉的点恢复

idx.save("index.json")
idx2 = TimeSeriesIndex.load("index.json")
```

### 命令行

```bash
# 交互 / 管道：每行一条 JSON 命令，每行输出一条 JSON 结果
echo '{"cmd":"state"}' | python main.py

# 批量命令文件
python main.py < commands.txt
```

示例会话：

```jsonl
{"cmd":"insert_many","points":[{"point_id":"A","series":"s","ts":1,"value":1.0},{"point_id":"B","series":"s","ts":2,"value":2.0}]}
{"cmd":"snapshot","name":"s1"}
{"cmd":"delete","series":"s","start":1,"end":2}
{"cmd":"insert","point":{"point_id":"C","series":"s","ts":3,"value":3.0}}
{"cmd":"rollback","name":"s1"}
{"cmd":"query","series":"s","start":0,"end":10}
{"cmd":"state"}
```

输出：

```jsonl
{"ok": true, "inserted": 2}
{"ok": true, "name": "s1"}
{"deleted": 1}
{"ok": true}
{"ok": true, "name": "s1"}
{"points": [{"point_id": "A", "series": "s", "ts": 1, "value": 1.0}, {"point_id": "B", "series": "s", "ts": 2, "value": 2.0}]}
{"series_count": 1, "total_points": 2, "series_points": {"s": 2}, "snapshots": ["s1"]}
```

任何错误都输出带 `error` 字段的一行 JSON，不会中断后续命令：

```json
{"error": "point_id 重复: A", "cmd": "insert"}
{"error": "start(10) 不能大于 end(5)", "cmd": "query"}
```

## CLI 命令一览

| 命令 | 输入字段 | 成功输出 |
| --- | --- | --- |
| `insert` | `point` | `{"ok": true}` |
| `insert_many` | `points: [...]`（原子） | `{"ok": true, "inserted": n}` |
| `query` | `series`, `start`, `end`（`[start,end)`） | `{"points": [...]}` |
| `delete` | `series`, `start`, `end` | `{"deleted": n}` |
| `snapshot` | `name` | `{"ok": true, "name": ...}` |
| `rollback` | `name` | `{"ok": true, "name": ...}` |
| `state` | — | series 数、总点数、每 series 点数、快照列表 |
| `get` | `point_id` | `{"point": {...}}` 或 `{"point": null}` |
| `list` | — | `{"series": [...]}`（字典序） |
| `save` | `path` | `{"ok": true, "path": ...}` |
| `load` | `path` | 替换当前内存索引并返回其 state |
| `dump` | — | 完整 JSON 数据（与 save 文件内容相同） |

命令名字段用 `cmd`，也兼容 `command`。空行跳过。

## API 参考（`timeseries_index.py`）

### `Point(point_id, series, ts, value)`

不可变（frozen dataclass），构造时即校验：

- `point_id` / `series`：非空字符串
- `ts`：整数（逻辑时间，不要求单调；`bool` 不被接受，负数与 0 可以）
- `value`：有限数值（`NaN` / `Inf` / `-Inf` 拒绝），内部统一存为 `float`

### `TimeSeriesIndex`

| 方法 | 说明 |
| --- | --- |
| `insert(point)` | 插入一个点；`point_id` 重复抛 `DuplicatePointError` |
| `insert_many(points)` | 原子批量插入：先全量校验再写入，失败时索引不变；接受列表或迭代器 |
| `range_query(series, start, end) -> list[Point]` | `[start,end)` 查点，按 `(ts, point_id)` 升序；series 不存在返回 `[]`；`start > end` 抛错 |
| `range_delete(series, start, end) -> int` | 删除 `[start,end)` 的点并返回数量；series 不存在 / 空区间返回 0 |
| `snapshot(name)` | 记录当前全部桶状态；名称非空且唯一 |
| `rollback(name)` | 恢复到快照；之后的插入丢弃、删除恢复；不影响其它快照 |
| `delete_snapshot(name)` | 删除一个快照 |
| `list_snapshots()` | 快照名列表（字典序） |
| `get_point(point_id)` | 点详情或 `None` |
| `list_series()` | 所有 series 名（字典序）；桶清空后自动消失 |
| `series_count(series)` | 某 series 点数 |
| `get_state()` | `series_count` / `total_points` / `series_points` / `snapshots` |
| `save(path)` / `load(path)` | JSON 持久化与带校验的重建 |

异常层级：`TimeseriesError` 之下有 `InvalidPointError`、`DuplicatePointError`、
`InvalidRangeError`、`SnapshotError`（`SnapshotNotFoundError` /
`SnapshotExistsError`）、`IndexFormatError`。它们同时继承相应的内置类型
（`ValueError` / `KeyError`），方便按需捕获。

## 设计与复杂度

### 桶内平衡结构：随机 Treap

- 索引按 `series` 分桶；每个桶是一棵 **Treap（树堆）**，键为 `(ts, point_id)`。
  元组键天然全序，中序遍历即查询要求的 `(ts, point_id)` 排序，同 ts 的多点
  靠 point_id 区分。
- Treap 由随机优先级维持平衡（固定随机种子，行为可复现），20000 个顺序键
  插入时树高仍为几十的量级（测试中有断言保护）。
- 插入、单点删除期望 **O(log n)**；范围查询沿树定位下界后中序展开，
  **O(log n + k)**。
- 范围删除用两次 `split` 切出区间中段、再一次 `merge` 缝合：
  `split((start,""))` → `split((end,""))`，中段恰好是左闭右开区间，
  总期望 **O(log n + k)**，不做整桶线性扫描。
- 另有全局 `point_id -> Point` 字典：保证全局唯一，并支撑 O(1) 的
  `get_point` 与删除时同步清理。

边界 `(start, "")` / `(end, "")`：point_id 恒为非空字符串，因此
`ts == start` 的键严格大于下界、`ts == end` 的键不小于上界，正好实现
`[start, end)`。

### 快照与回滚

- `snapshot(name)` 深拷贝每棵 Treap 的节点（`Point` 不可变，直接共享），
  连同 point_id 表与计数一起保存。快照与工作区、快照与快照之间互不共享
  可变节点，任何后续修改都不会破坏已拍快照。
- `rollback(name)` 用快照内容的*新副本*替换当前工作区。因此：
  - 快照之后删的点恢复、插的点消失（交错删插也精确恢复，见测试
    `test_interleaved_delete_insert_after_rollback`）；
  - 快照之间可以任意来回、嵌套回滚；回滚到较早快照后，较晚快照依旧完整可用；
  - 回滚后继续插入 / 删除 / 再拍快照都正常。
- 代价：每次快照 O(n) 时间与内存（以当时总点数计）。这是为"快照永久有效、
  互相独立"付出的必要代价；实现简单且行为可预测。

### 持久化格式

单个 JSON 文件（UTF-8、缩进 2、`allow_nan=False`）：

```json
{
  "format": "timeseries-index",
  "version": 1,
  "series": {
    "s1": [{"point_id": "A", "series": "s1", "ts": 1, "value": 1.0}]
  },
  "snapshots": [
    {"name": "base", "series": {"s1": [ ... ]}}
  ]
}
```

- `save` 先写同目录临时文件再 `os.replace` 原子替换，不会留下写一半的文件。
- `load` 重建 Treap 并执行一致性校验：顶层字段 / format / version；
  JSON 不允许 `NaN` / `Infinity` 常量；每个点字段合法（ts 整数、value 有限）；
  **point_id 在 live 内、每个快照内分别全局唯一**；点的 `series` 字段与其
  所在桶一致（即快照引用的 series 都存在）；快照名非空且不重复。
  任何失败都抛带中文说明的 `IndexFormatError`，不静默吞错。

## 运行测试

```bash
python -m unittest -v
# 或
python test_timeseries_index.py
```

测试覆盖（44 个用例）：

- 点校验（空字段、bool 冒充 int、NaN/Inf、缺字段/多字段、不可变）
- 插入与重复 point_id、同 ts 多点、series 字典序与空桶回收
- 范围查询开闭区间、start == end、start > end、不存在 series、负时间
- 范围删除、删后立即查询、整桶删除后同名重建、同 ts 重插
- `insert_many` 原子性：与已有数据冲突、批内重复、非法点三种中途失败，
  失败后索引逐字段不变；迭代器输入与空批次
- 快照回滚：题目指定的交错删插场景、回滚后继续插入、缺失快照报错、
  嵌套/跨时间线来回回滚、恢复被整删的 series、空索引快照、重复回滚不损坏快照
- save/load 往返（含快照可继续回滚）、覆盖保存、10 类坏文件的清晰报错
- CLI 全流程（错误 JSON、未知命令、错误不中断、save/load、`command` 别名、空行）
- 规模：5 × 6000 = 30000 个随机点，与暴力实现对照 20 组范围查询、
  10 组范围删除；20000 顺序键下断言 Treap 高度保持对数级

## 边界情况约定速查

| 情况 | 行为 |
| --- | --- |
| 空索引查询 / state | 返回空列表 / 零值，不报错 |
| series 不存在 | `range_query` 返回 `[]`；`range_delete` 返回 0 |
| `start == end` | 合法，结果为空 / 删除 0 |
| `start > end` | 查询、删除均抛 `InvalidRangeError`（CLI 返回 error JSON） |
| 同 series 同 ts 多点 | 允许，按 point_id 区分与排序 |
| 重复 point_id | `insert` / `insert_many` 报错 |
| 批量插入中途非法/重复 | 整批回滚，索引保持调用前状态 |
| 回滚到不存在的快照 | 抛 `SnapshotNotFoundError` |
| 快照重名 | 抛 `SnapshotExistsError` |
| save 文件损坏 | 抛带具体原因的 `IndexFormatError` |
