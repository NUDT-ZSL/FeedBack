# Columnar TSDB —— 面向时序数据的小型列式存储引擎

一个**零第三方依赖**（仅 Python 标准库）、可嵌入的时序存储内核。针对
“按时间范围扫描 + 按标签过滤 + 聚合”类查询做列式组织，支持追加写入、
**乱序回填**、**同时间戳后写覆盖**、逻辑删除与物理压缩、目录级快照持久化。

- Python 3.10+（使用 `X | Y` 类型注解；标准库 only，完全离线可用）
- 不接网络、不启线程、不写全局状态，适合直接 `import` 进进程内嵌使用

---

## 1. 目录结构

```
workspace/
├── tsdb/
│   ├── __init__.py     # 公开 API：ColumnarTSDB / Point / QueryResult / 异常
│   ├── model.py        # Point/QueryResult dataclass、输入校验、series_id、标签匹配
│   ├── encoding.py     # zigzag + varint、时间戳差分编码、IEEE-754 双精度
│   ├── block.py        # 列块二进制格式（含 CRC32）、懒解码、多列块合并（LWW）
│   ├── engine.py       # ColumnarTSDB 内核：写入/查询/删除/compact/save/load/stats
│   └── errors.py       # TSDBError / ValidationError / BlockFormatError / CorruptionError
├── main.py             # 命令行入口：stdin 逐行 JSON 命令 -> stdout 逐行 JSON 结果
├── tests/
│   └── test_tsdb.py    # 88 个 unittest 用例（含 10 万点性能基线）
└── README.md
```

---

## 2. 快速开始

### 2.1 作为库嵌入

```python
from tsdb import ColumnarTSDB, Point

db = ColumnarTSDB(shard_span=3600, block_size=1024)

# 追加写入（也接受等价 dict）
db.append([
    Point("cpu", {"host": "a", "rack": "r1"}, 100, {"usage": 0.5, "temp": 42.0}),
    Point("cpu", {"host": "a", "rack": "r1"}, 200, {"usage": 0.7, "temp": 44.0}),
])

# 乱序回填：直接写更早的时间戳即可，查询自动合并成时间有序序列
db.append([Point("cpu", {"host": "a", "rack": "r1"}, 50, {"usage": 0.2, "temp": 40.0})])

# 范围扫描（左闭右开）；tags_filter 中 "*" 表示该标签存在即可
results = db.query("cpu", {"host": "*"}, 0, 300)
r = results[0]
print(r.timestamps)            # [50, 100, 200]
print(r.columns["usage"])      # [0.2, 0.5, 0.7]

# 区间聚合：[start, start+step) ...，无数据的区间不输出
agg = db.query("cpu", {"rack": "r1"}, 0, 300, fields=["usage"], agg="avg", step=150)
print(agg[0].timestamps)       # [0, 150]
print(agg[0].columns["usage"]) # [0.35, 0.7]

# 删除（先逻辑标记）+ 物理清理 + 快照
db.delete_range("cpu", {"host": "a", "rack": "r1"}, 0, 100)
db.compact()
db.save("./snapshot")
```

### 2.2 命令行（JSON-lines 协议）

`main.py` 从 stdin 逐行读 JSON 命令，每行输出一个 JSON 结果；错误同样是
一行 JSON 且带 `"error"` 字段，**不会中断后续命令**。

```bash
python main.py <<'EOF'
{"op":"append","points":[{"metric":"cpu","tags":{"host":"a"},"ts":1,"fields":{"v":1.0}}]}
{"op":"query","metric":"cpu","tags_filter":{"host":"*"},"start":0,"end":10,"agg":"sum","step":5}
{"op":"stats"}
{"op":"save","dir":"./snap"}
{"op":"load","dir":"./snap"}
{"op":"compact"}
{"op":"dump"}
EOF
```

成功结果形如 `{"ok": true, "op": "query", "results": [...]}`，
错误形如 `{"ok": false, "op": "append", "error": "metric 必须是非空字符串"}`。

| op | 参数 |
|---|---|
| `append` | `points: Point[]` |
| `query` | `metric, tags_filter, start, end, fields?(默认全部), agg?(默认 none), step?` |
| `delete_series` | `metric, tags` |
| `delete_range` | `metric, tags, start, end`（左闭右开） |
| `compact` | 无 |
| `save` / `load` | `dir` |
| `stats` | 无 |
| `dump` | 无，输出内部布局清单（不含列块 payload，用于排查） |

Point JSON：`{"metric": "cpu", "tags": {"host": "a"}, "ts": 1, "fields": {"v": 1.0}}`

---

## 3. 数据模型

| 概念 | 约束 |
|---|---|
| `metric` | 非空字符串 |
| `tags` | `str -> str` 字典；**键和值都不能为空字符串**；允许空字典（无标签 series） |
| `ts` | 整数逻辑时间（方便测试注入；支持负数） |
| `fields` | `str -> 有限浮点数`，**至少一个字段**；拒绝 `NaN/Inf/-Inf`；int 会归一化为 float |

**series 与 series_id**：同一 `(metric, tags)` 构成一个 series。`series_id`
由 `metric` 与按 key 排序后的 `k=v` 列表做规范化后取 **SHA-256 前 16 字节**
（128 bit 十六进制），因此：

- 与 tags 字典插入顺序无关，跨进程/跨语言可复现；
- 加载快照时会用 metric/tags **重新计算并比对**，被篡改立刻报错。

---

## 4. 存储布局

```
shard（时间 // shard_span，地板除，负时间也成立）
└── series（series_id）
    └── field（字段名）
        └── ColumnBlock 列表（按写入顺序；乱序回填/覆盖会产生多个列块）
```

- **时间分片**：固定 `shard_span`（默认 3600）。查询时只展开与
  `[start, end)` 相交的 shard，其余 shard 完全不触碰。
- **列式块**：每个 shard 内，一个 series 的一个字段独立成列。查询只解码
  `fields` 指定的列，不读其它字段。
- **块大小**：一次 append 中同一 (shard, series, field) 的点排序后按
  `block_size`（默认 1024）切块；**新数据永不改写旧块**，只追加新块。

### 4.1 列块二进制格式

```
偏移  长度  字段
0     4    magic = b"TSDB"
4     1    version = 1
5     1    时间戳编码（1 = delta+zigzag+varint）
6     1    数值编码（2 = IEEE-754 大端双精度）
7     1    flags（保留，0）
8     8    min_ts (i64)
16    8    max_ts (i64)
24    4    count (u32)
28    4    ts_payload 长度 (u32)
32    …    ts_payload：首个 ts(zigzag-varint) + 相邻差值(zigzag-varint)
…     …    value_payload：count * 8 字节大端 double
末尾  4    以上全部字节的 CRC32
```

列块对象在内存中只持有上述字节，头部元信息（min/max/count）可直接用于
时间裁剪；**时间戳和数值在首次需要时才懒解码**并缓存。

### 4.2 编码选型与压缩率

**时间戳列：差分 + zigzag + varint（必须体现差分思想，本实现是真编码而非存列表）**

- 相邻时间戳先转差值。规则采样（每秒/每 10 秒一个点）时差是小的正整数，
  varint 通常 1~2 字节；zigzag 保证乱序块里的负差值也能短编码。
- 自描述长度，顺序解码即可，无需额外字典或长度数组；配合 varint 对未来
  换成更密集采样零成本。
- 实测：1000 个连续秒级时间戳，时间戳列平均 **约 2 字节/点**（裸 i64 是 8 字节）。

**数值列：定长 IEEE-754 双精度（8 字节/点）**

- 指标浮点值基数通常很高，字典编码命中率低，反而要额外付出“字典 + 索引”
  开销并失去随机访问能力；
- 定长 8 字节可以用 `struct` 直接解包、按偏移切片（范围裁剪只读子段），
  CPU 开销最低，且精确无损地保留浮点值。
- 代价是压缩率一般：综合时间戳列后，整体约 **9 字节/点、约 1.8×**
  （相对 “8B 时间戳 + 8B 数值” 的裸布局；实测见第 9 节）。若未来数值
  以整数/低基数为主，可以在头部 `enc_value` 字节上扩展字典编码或
  Gorilla 式异或压缩，格式已为版本演进留了字段。

---

## 5. 写入、乱序回填与覆盖语义（重要）

1. 一个批次先按 `(shard, series, field)` 聚合成 `{ts: value}`，
   **同批次内相同 ts 以靠后的点为准**；
2. 每个字段排序后按 `block_size` 切块，追加成新列块，并分配单调递增的
   写入序号 `seq`；
3. 查询把同一 `(shard, series, field)` 的多个列块按 seq 合并。

**覆盖语义（last-write-wins）**：不同列块出现相同 `ts` 时，**后写入
（seq 更大）的值覆盖先写入的值**。这同时适用于跨批次重复写、乱序回填
与 `compact()` 重写。合并结果时间戳严格升序、唯一。

删除后再写入同一时间戳：删除只作用于“删除时刻已经存在”的数据
（删除标记也带 seq，且 seq 大于被删点的 seq 才生效），因此
`delete_range` 之后重新 append 的同时间戳点**仍然可见**。

---

## 6. 查询语义

`query(metric, tags_filter, start, end, fields=None, agg="none", step=None)`

裁剪顺序（尽量少读）：

1. **shard 裁剪**：只展开与 `[start, end)` 相交且存在的 shard；
2. **metric 裁剪**：直接走 metric → series 索引；
3. **tags 过滤**：精确匹配，值为 `"*"` 表示该标签键存在即可；
4. **列裁剪**：只解码 `fields` 涉及的列（`None` = 全部字段）；
5. **列块裁剪**：`max_ts < start` 或 `min_ts >= end` 的块直接跳过，
   块内用二分取范围子段。

边界与返回约定：

- 时间区间统一**左闭右开**；`start >= end` 直接返回空列表；
- metric/series 不存在、过滤后无 series、fields 全部不存在：返回 `[]`；
  请求了但某 series 缺失的字段被忽略，不报错；
- 每个匹配的 series 返回一个 `QueryResult`（按 series_id 排序，顺序稳定）；
- `agg="none"`：`timestamps` 为原始时间戳，`columns[name]` 为等长值序列；
  若不同字段出现在不同时间点，按 ts 并集对齐，缺失位置为 `null`；
- 聚合：`sum / avg / min / max / count`（`count` 也以浮点返回）。
  不带 `step` 时对整个范围输出一个值，`timestamps=[start]`；
- 带 `step` 时按 `[start+k*step, start+(k+1)*step)` 分桶，
  `timestamps` 为各**有数据**桶的起始时间，**空桶不输出**，多字段列按桶对齐。

---

## 7. 删除与 compact

- `delete_series(metric, tags) -> bool`：把该 series 的全部现有列块标记
  删除（tombstone），查询立即不可见；底层字节仍在，等 `compact()` 回收。
  删除不存在的 series 是 no-op（返回 `False`）。删除后重新 append 同身份
  数据，series 复活且新数据可见。
- `delete_range(metric, tags, start, end) -> bool`：记录带 seq 的范围
  删除标记；被范围完全覆盖的列块立即整块标记，部分覆盖的块保留并在读取
  时逐点过滤。`start >= end` 为 no-op。
- `compact() -> {"rewritten_blocks": int, "reclaimed_bytes": int}`：
  物理重写——物化 LWW 与删除效果、合并乱序回填产生的碎块（超 `block_size`
  重新切块）、删除死 series/死 shard、清空已物化的范围删除标记。
  **compact 前后任何查询结果完全一致**，`stats()` 中
  `dead_blocks/dead_bytes/dead_series` 归零，幂等可重复执行。

---

## 8. 持久化（save / load）

`save(dir)` 的目录布局：

```
dir/
├── manifest.json      # 清单：格式/版本、shard_span、block_size、计数器、
│                      #       series 元信息、shard 索引、每个列块的
│                      #       文件位置/编码/min_ts/max_ts/count/size/删除标记、
│                      #       范围删除标记
└── blocks/
    ├── b1.blk         # 列块二进制（见 4.1），一个 entry 一个文件
    ├── b2.blk
    └── ...
```

- 列块文件先写 `*.tmp` 再 `os.replace` 原子替换，清单同理；
- 重复 save 到同一目录会清理不再被清单引用的旧 `.blk`；
- `load(dir)` 严格校验，任何问题都抛 `CorruptionError`（**绝不静默吞掉**）：
  - 清单不存在 / 非合法 JSON / 缺必需字段 / 格式标识或版本不符；
  - 清单引用的列块文件不存在、读不出；
  - 列块魔数/版本/编码未知、长度与声明不符、**CRC32 校验失败**；
  - 列块 `min_ts > max_ts`、时间范围不属于其所在 shard；
  - 列块的编码/边界/count/size 与清单记录不一致；
  - **series_id 与 metric+tags 重新计算结果不一致**；
  - 列块引用了未登记 series、shard 索引与实际列块不一致；
  - tombstone 记录结构非法或区间非正。
- 加载成功后才替换实例状态，损坏的快照不会污染当前内存。

---

## 9. stats() 与性能

`stats()` 返回：

```python
{
  "shards": 7,            # shard 数
  "series": 10,           # 存活 series 数
  "blocks": 232,          # 存活列块数
  "total_points": 200000, # 存活点数（按列计：10 万点 * 2 字段）
  "compressed_bytes": 1808672,  # 存活列块压缩后字节
  "dead_series": 0,       # 待 compact 回收
  "dead_blocks": 0,
  "dead_bytes": 0,
  "range_tombstones": 0,
}
```

本机实测（普通 Windows 笔记本，Python 3.13，10 series × 1 万点 × 2 字段
= 10 万测点 / 20 万列值，含约 2% 乱序点，整体 shuffle 后写入）：

| 操作 | 耗时 |
|---|---|
| `append` 10 万测点 | **~0.29 s** |
| 跨 10 series 的分桶聚合（`sum`, step=500，80 个桶） | **~0.006 s** |
| 单 series 原始范围扫描（1 万点） | **~0.002 s** |

存储约 **9 字节/列值**（含时间戳列分摊、头部与 CRC），相对裸
`i64 时间戳 + double 值`（16 字节）约 **1.8×** 压缩；规则时间戳列本身
约 2 字节/点。测试套件里的性能用例上限设为写入 10s / 查询 5s，
普通机器上有充足余量。

---

## 10. 运行测试

```bash
python -m unittest discover -s tests -v
```

88 个用例覆盖：

- varint/zigzag/差分/浮点编解码往返、截断与负值拒绝、真实压缩率；
- 列块往返、范围读取、魔数/版本/**CRC 损坏**/截断/长度篡改；
- series_id 与标签顺序无关、Point 各类非法输入；
- 不重叠乱序块合并、**同 ts 后写覆盖**（跨批次与批次内）、范围裁剪合并；
- 标签精确/通配符、shard 裁剪、fields 投影、五种聚合、分桶聚合与空桶跳过；
- `delete_series` / `delete_range`（含删除后重写可见）、compact 前后
  查询一致、空间回收、碎块合并、LWW 保持、幂等；
- save/load 往返查询与 stats 一致、compact 后往返、缺清单/坏 JSON/缺字段/
  缺列块文件/列块字节损坏/series_id 被篡改/版本不符等错误路径；
- CLI JSON-lines 协议（含坏 JSON 行与错误恢复）；
- 空存储、单点、空批次、`start>=end`、不存在 metric/field/series 等边界；
- 10 万点性能基线。

---

## 11. 已知取舍 / 非目标

- 纯 Python 标准库实现，目标是**可嵌入、可读、可测**，不追求与原生列存
  （Parquet/Arrow）同量级的极限吞吐与压缩（如 Gorilla 浮点压缩、RLE 字典）；
  列块头部的编码字节为后续扩展留了位置。
- 列块文件是“一个 entry 一个文件”，小数据集足够；超大规模可以演进为
  分片大文件 + 偏移索引，清单结构无需变。
- 删除标记按 shard 独立保存（**不做几何合并**：重叠的删除区间必须各自保留
  自己的 seq，否则会误杀两次删除之间回填的新点）；极端频繁的范围删除下，
  读取过滤为 O(点数 × 标记条数)。标记在 compact 时随删除效果物化到新列块
  而清除，不会无限增长。
- `count` 以浮点返回，是为了让所有聚合结果共享同一列类型。
