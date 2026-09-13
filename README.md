# 内存时序索引（TimeSeriesIndex）

纯 Python 标准库实现的内存时序索引，面向本地指标采集器：按时间范围快速查点、
按时间范围批量删点、对索引打快照并回滚到任意快照点。支持 JSON 持久化与
逐行 JSON 命令的命令行入口。**无第三方依赖，离线可跑。**

- Python 3.9+（仅用标准库：`dataclasses`、`json`、`math`、`random`、`tempfile` 等）
- 平台无关，Windows / Linux / macOS 均可运行

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `timeseries_index.py` | 索引核心：`Point`、`TimeSeriesIndex`、持久化 Treap、异常、JSON 持久化 |
| `main.py` | 命令行入口：stdin 逐行读 JSON 命令（按 utf-8-sig 解码，兼容 BOM），stdout 逐行输出 JSON 结果 |
| `test_timeseries_index.py` | `unittest` 测试套件（50 个用例，含 3 万点规模与快照开销两档对比） |
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

### 持久化 Treap（结构共享）

索引状态由三棵**纯持久化（persistent）Treap** 组成，节点一经创建不再修改：

1. **series 树**：键为 series 名，值为 `(数据树根, 点数)`；
2. **每 series 的数据树**：键为 `(ts, point_id)`，值为 `Point`；
3. **point_id 树**：键为 point_id，值为 `Point`，负责全局唯一性与
   `get_point`（O(log n) 查找）。

所有修改原语（upsert / erase / split / merge）都做 **path copying**：
只复制根到目标路径上 O(log n) 个节点，未触碰的子树原样共享。
`(ts, point_id)` 元组键天然全序，中序遍历即要求的排序，同 ts 的多点
靠 point_id 区分。

- 插入期望 **O(log s + log n)**；范围查询沿树定位下界后中序展开，
  **O(log n + k)**；单点删除期望 **O(log n)**。
- 范围删除：数据树用两次持久化 `split` + 一次 `merge` 切出左闭右开
  中段（O(log n + k)）；全局 point_id 树批量擦除时自适应——删点少则
  逐点擦除（O(k log n) 路径复制），删点多（如整桶）则线性重建一棵
  新树（O(m)，笛卡尔构树），避免删除半个索引时的平方级退化。
- Treap 由随机优先级维持平衡（固定随机种子，行为可复现），20000 个
  顺序键插入时树高仍为对数量级（测试中有断言保护）。

边界 `(start, "")` / `(end, "")`：point_id 恒为非空字符串，因此
`ts == start` 的键严格大于下界、`ts == end` 的键不小于上界，正好实现
`[start, end)`。

### 快照与回滚：成本与隔离规则

**成本**：索引任意时刻的完整状态就是三个根引用
`(series 树根, point_id 树根, 总点数)`。

- `snapshot(name)` 只保存这个三元组，**O(1) 时间、O(1) 增量内存，
  与总点数无关**。5 万点后连打 20 次快照旧实现需要整树深拷贝（秒级、
  内存翻倍），现在实测单次约 2µs、零额外数据内存。
- `rollback(name)` 只是把三个根引用换回去，**O(1)**。
- 代价模型变为：被快照保留的历史版本里，只有*与后来版本不同的路径节点*
  会持续占内存；每条插入/删除的增量是 O(log n) 个节点。也就是说
  "快照本身免费，变更才付费"，这是结构共享相对整树拷贝的核心取舍。
  `delete_snapshot` 只是删除根引用，只被该快照（及其独占分支）引用的
  节点随之成为垃圾（CPython 引用计数即时回收）。

**隔离规则（重要）**：

1. 快照是不可变的状态根；任何修改只产生新节点，**绝不就地改写旧节点**，
   所以快照不会被后续操作破坏。
2. `rollback` 仅切换当前根引用，不触碰任何快照。回滚之后相当于从历史
   点开出一条新分支：新分支上的插入/删除只在新分支分配节点。
3. **每个快照永远精确等于拍照那一刻的世界**，与创建时间先后无关。
   典型场景：快照 A → 插 C 打快照 B → 回滚 A → 在 A 分支插 D/E →
   再回滚 B，B 的世界严格是"A 的点 + C"，不会带入回滚期间插入的
   D/E；之后还可以在 A / B / 分支快照之间任意来回切换
   （见测试 `test_branch_isolation_after_rollback` 与
   `test_many_snapshots_with_edits_rollback_each_exact`）。
4. 交错删插精确恢复：快照点有 A、B，之后删 A 插 C，回滚后 A、B 在、
   C 不在（`test_interleaved_delete_insert_after_rollback`）。

### 持久化格式与 schema_version

单个 JSON 文件（UTF-8、缩进 2、`allow_nan=False`）：

```json
{
  "format": "timeseries-index",
  "schema_version": 1,
  "series": {
    "s1": [{"point_id": "A", "series": "s1", "ts": 1, "value": 1.0}]
  },
  "snapshots": [
    {"name": "base", "series": {"s1": [ ... ]}}
  ]
}
```

- 顶层带 `schema_version`（当前为 1）。`load` 先校验 `format` 与
  `schema_version` 是否受支持，再校验 `series` / `snapshots` 等必填
  字段；任何字段缺失都会在错误信息中点名，例如
  `缺少顶层字段: schema_version`。旧文件（无版本号或版本不支持）直接
  拒绝，不会落到 `KeyError`。
- `save` 先写同目录临时文件再 `os.replace` 原子替换，不会留下写一半的文件。
- `load` 校验通过后按有序键笛卡尔构树**线性重建**（不走逐条插入），
  5 万点量级约 0.3s。校验内容：顶层必填字段与 `format` / `schema_version`；
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

测试覆盖（50 个用例）：

- 点校验（空字段、bool 冒充 int、NaN/Inf、缺字段/多字段、不可变）
- 插入与重复 point_id、同 ts 多点、series 字典序与空桶回收
- 范围查询开闭区间、start == end、start > end、不存在 series、负时间
- 范围删除、删后立即查询、整桶删除后同名重建、同 ts 重插；
  start > end / 非整数边界报错且无副作用
- `insert_many` 原子性：与已有数据冲突、批内重复、非法点三种中途失败，
  失败后索引逐字段不变；迭代器输入与空批次
- 快照回滚：题目指定的交错删插场景、回滚后继续插入、缺失快照报错、
  嵌套/跨时间线来回回滚、恢复被整删的 series、空索引快照、重复回滚不损坏快照
- **持久化快照专项**：1 万 / 5 万两档下 snapshot 耗时不随点数线性增长
  （结构共享 O(1)）、快照保存的是共享根引用、回滚后开新分支再跳回更晚
  快照的隔离语义、20 个快照间夹删插后逐个精确回滚
- save/load 往返（含快照可继续回滚）、覆盖保存；坏文件清晰报错：
  JSON 语法错、非法 NaN 常量、缺各顶层字段（点名缺哪个）、format 错、
  schema_version 缺失/类型错/版本不支持（含只有旧 `version` 字段的文件）、
  ts 非整数、point_id 重复、快照 series 引用不匹配、快照重名
- CLI 全流程（错误 JSON、未知命令、错误不中断、save/load、`command`
  别名、空行），以及用子进程回归**首行带 UTF-8 BOM** 的输入
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
