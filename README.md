# 流式分片布隆过滤器内核（bloom-kernel）

一个零第三方依赖、可离线运行的**流式集合成员判定与集合运算内核**，面向
日志去重、权限位图计算这类“上游持续推标识、随时要问成员关系与集合规模、
内存必须有硬上限”的场景。

* 纯 Python 标准库实现（`hashlib` / `json` / `dataclasses`），Python 3.10+。
* 每个来源分片（`tag`）独立维护位数组与哈希配置，互不串扰。
* 成员判定**零假阴性**，假阳性率可理论估算、可观测。
* 基于位数组的 union / intersect / difference，不修改原内核。
* `max_bits` 硬内存上限：超限**拒绝插入并抛明确错误**，绝不静默丢弃。
* JSON 快照持久化，加载时做完整一致性校验，损坏文件报清晰错误。
* 附带精确 `set` 内核与 `track_keys` 精确跟踪模式，便于小规模对拍验收。

## 文件

| 文件 | 说明 |
| --- | --- |
| `bloom_kernel.py` | 内核：`Item`、`BloomKernel`、`ExactKernel`、异常体系 |
| `main.py` | 命令行入口：stdin 逐行 JSON 命令，stdout 逐行 JSON 结果 |
| `test_bloom_kernel.py` | 57 个 unittest 用例 |
| `acceptance_check.py` | 验收演练：4 tag × 3 万随机 key 对拍精确 set |

## 快速开始

```bash
python -m unittest test_bloom_kernel -v   # 跑单测
python acceptance_check.py                # 跑大规模验收演练
```

作为库使用：

```python
from bloom_kernel import BloomKernel, Item, CapacityError

# 默认：每 tag 2^20 位（128 KiB）、7 个哈希；所有 tag 总位数上限 8 MiB
k = BloomKernel(default_m=1 << 20, default_k=7, max_bits=8 << 20)

k.insert(Item(key="user-42", tag="shard-a", seq=1))
k.contains("shard-a", "user-42")   # True（插过必命中）
k.contains("shard-a", "ghost")     # False（小概率假阳性，见下）

k.false_positive_rate("shard-a")   # 当前填充率下的理论 FPR
k.estimate_cardinality("shard-a")  # 由填充率反推不同 key 数
k.stats()                          # 每个 tag 的完整指标
k.save("state.json")
```

## 数据模型

```python
@dataclass(frozen=True)
class Item:
    key: str   # 非空；UTF-8 编码后 ≤ 256 字节
    tag: str   # 非空；来源分片，字符集 [A-Za-z0-9_./-]
    seq: int   # 同一 tag 内从 1 开始单调递增
```

任一约束不满足都抛 `ValidationError`（`ValueError` 子类），错误信息指明字段。
`Item` 不可变、可哈希。

## 哈希方案（离线可复现）

对每个 key 计算一次 `sha256(key.encode("utf-8"))`，取摘要的前 16 字节
得到两个 64 位整数 `h1`、`h2`，再按 Kirsch–Mitzenmacher 双散列派生出
`k` 个散列位置：

```
h_i(key) = (h1 + i * h2) mod m,   i = 0 .. k-1
```

相同输入在任何机器上得到完全一致的位布局（测试 `test_reproducible_hashes`
逐字节校验）。不使用随机盐，因此快照可跨进程复现；如果需要对抗恶意构造
key，应在 key 中混入业务侧前缀（本内核定位为离线去重而非防对手结构）。

## 成员判定与精度

* `contains(tag, key)`：k 个位置全为 1 才返回 `True`。
  **不存在假阴性**；假阳性只可能在过滤器接近饱和时明显。
* `false_positive_rate(tag) = fill_ratio ** k`，其中
  `fill_ratio = 已置位数 / m`。
* 容量选型：填充率建议控制在 ~0.25 以下。默认 `m=2^20, k=7` 时，
  每 tag 约可放 3 万元素且 FPR ≈ 6e-6（见验收演练实测）。
  经典最优参数 `k = (m/n)·ln2`，构造时可按需配置。
* 边界：`m=1`、`k=1` 均合法。`m=1` 时插入任意 key 立即饱和
  （FPR=1，任何查询都命中），这是退化结构的预期行为。

## 基数估算

`estimate_cardinality(tag)` 用填充率的极大似然估计：

```
n ≈ -(m / k) · ln(1 - X/m)      # X = 已置位数
```

重复插入不影响结果（幂等置位）。验收演练中 n=30000、m=2^20、k=7 时
相对误差在 0.1% 以内；常规填充率（< 0.5）下误差通常 < 10%。
位图全满（X=m）时公式无定义，返回 `distinct` 计数作为下界兜底。

## 集合运算语义（重要）

`union(other)` / `intersect(other)` / `difference(other)` **均返回新内核**，
两个原内核不被修改。要求两侧同一 tag 的 `(m, k)` 配置一致，否则抛
`ValidationError`；某 tag 只在一侧出现时，缺失侧按空集合处理。

有两条实现路径：

| 路径 | 触发条件 | union | intersect | difference |
| --- | --- | --- | --- | --- |
| 位图路径（默认） | 任一侧 `track_keys=False` | 位 OR，零假阴性 | 位 AND，零假阴性，FPR 不升高 | 位 `A & ~B`，**对 A 独有成员可能假阴性** |
| 精确路径 | 两侧都 `track_keys=True` | 精确集合并，重新散列 | 精确集合交，重新散列 | 精确集合差，重新散列，**零假阴性/无新增假阳性** |

**为什么纯位图差集可能漏报？** 布隆过滤器的按位差集是
`A_BF AND (NOT B_BF)`。若某个仅属于 A 的 key，它的 k 个散列位恰好被
B 中的*其他* key 全部置 1，则该 key 会被错误地从差集中抹掉。这是布隆
位图运算的固有数学局限（并集、交集不存在这个问题）。过滤器越空越难
触发，但无法在纯位图结构上消除。

需要对差集做强保证时（例如权限位图相减），有两个选择：

1. **`track_keys=True`**：内存在位数组之外额外用 `set` 保存全部 key，
   额外内存随不同 key 数线性增长；此时新增判定、`distinct`、基数估算
   全部精确，且两侧都开启时集合运算走精确路径。快照会包含全部 key，
   加载时还用 key 重散列核对位图，被篡改能检出。
2. **`ExactKernel`**：完全用 `set`，接口与 `BloomKernel` 对齐，
   适合测试对拍与小规模数据。

```python
a = BloomKernel(default_m=1<<18, default_k=7, track_keys=True)
b = BloomKernel(default_m=1<<18, default_k=7, track_keys=True)
# ... 插入 ...
d = a.difference(b)   # 精确差集：真实成员零漏报、零误报
```

## 内存上限策略

构造时传 `max_bits`（所有 tag 位数组**总位数**的硬上限）：

* 容量按**整分片预承诺**：新 tag 的首次插入若会使
  `total_bits + default_m > max_bits`，整次插入被拒绝，抛
  `CapacityError`，**内核状态完全不变**（连空分片都不会创建）。
* 已存在的 tag 继续插入永不触发上限——它的位数组在创建时就已按
  `default_m` 全额分配，置位不增加内存。
* `max_bits=0` 表示拒绝一切插入；`max_bits=None`（默认）不限。
* 不会静默丢弃、不会淘汰旧数据、不会自动缩容——策略是显式失败，
  由上游决定换分片还是落盘。错误信息包含当前用量与上限。
* `track_keys=True` 时的额外 set 内存不计入 `max_bits`（它只约束
  位数组这一确定性部分）；需要限制 key 侧内存可用 `ExactKernel(max_keys=...)`。

位数组裸内存 = `ceil(m/8)` 字节/tag，例如默认配置每 tag 128 KiB。
`stats()` 的 `memory_bytes` 给出该值。

## stats() 字段

```json
{
  "t1": {
    "m": 1048576,
    "k": 7,
    "set_bits": 190312,
    "fill_ratio": 0.1815,
    "false_positive_rate": 0.000006,
    "inserted": 30012,
    "distinct": 30000,
    "estimated_cardinality": 30010,
    "memory_bytes": 131072,
    "tracked_keys": null
  }
}
```

`inserted` 是插入尝试次数（含重复），`distinct` 是产生新置位的次数
（纯布隆模式在极端饱和下可能偏小；`track_keys` 模式精确）。

## 持久化（JSON 快照）

`save(path)` 原子写入（先写 `path.tmp` 再 `os.replace`），
`load(path)` 读取并**完整校验**：

* `format` / `version` 正确；`default_m`、`default_k` 为正整数，
  `max_bits` 为 null 或非负整数，`track_keys` 为布尔值；
* 每分片：`m`、`k` 为正整数，`inserted`/`distinct` 非负且
  `distinct ≤ inserted`；
* 位数据为合法十六进制，字节数恰为 `ceil(m/8)`，超出 m 的衬底位为 0；
* `fill_ratio ∈ [0,1]` 且与重算值一致（容差 1e-9）；
* 各分片位数总和不超过记录的 `max_bits`；
* `track_keys=true` 时：key 列表无重复、无非法 key、`distinct` 与
  key 数一致，且位图必须**恰好**等于全部 key 重散列的结果。

任何不一致都抛 `PersistenceError`，信息指出具体分片与字段，
绝不静默吞掉或返回空内核。

## 命令行协议

```bash
python main.py [--m 1048576] [--k 7] [--max-bits 8388608] [--track-keys] [--exact]
```

stdin 每行一条 JSON 对象，必须含 `cmd`；空行跳过。stdout 每行一条 JSON：
成功 `{"ok": true, ...}`，失败 `{"ok": false, "error": "...", "type": "异常类名", "cmd": "..."}`。
单条命令出错不会中断进程。

| 命令 | 字段 | 说明 |
| --- | --- | --- |
| `insert` | `key`,`tag`,`seq` | 返回 `new`（是否首次出现） |
| `contains` | `tag`,`key` | 返回 `member` |
| `cardinality` | `tag`（可省略，或给 `tags` 数组） | 返回估算基数 |
| `stats` | — | 内核与各分片指标 |
| `save` / `load` | `path` | load 替换当前内核（自动识别布隆/精确格式） |
| `union` / `intersect` / `difference` | `other`（快照路径）, `save`（可选）, `replace`（可选） | 与文件中的内核运算；默认只返回结果，`replace=true` 时替换当前内核 |
| `dump` | — | 输出完整可序列化状态（单行 JSON） |
| `reset` | `m`,`k`,`max_bits`,`exact`,`track_keys`（均可选） | 重置一个全新内核 |

示例：

```bash
printf '%s\n' \
  '{"cmd":"insert","key":"alice","tag":"users","seq":1}' \
  '{"cmd":"contains","tag":"users","key":"alice"}' \
  '{"cmd":"stats"}' \
  '{"cmd":"save","path":"state.json"}' \
  '{"cmd":"load","path":"state.json"}' \
  '{"cmd":"union","other":"other.json","save":"u.json"}' \
| python main.py --m 1048576 --k 7 --max-bits 8388608
```

## 测试

```bash
python -m unittest test_bloom_kernel -v
python acceptance_check.py
```

单测（57 个）覆盖：Item 校验与多字节边界、插入幂等、成员判定零假阴性、
经验 FPR 对理论值的统计检验、基数估算误差、精确/位图两条集合运算路径、
与空内核及 tag 不相交场景的运算、配置不一致拒绝、`max_bits` 拒绝与
原子性、快照往返与十余种损坏形态、精确内核、以及子进程驱动的 CLI
协议（含错误 JSON 化、save/load/运算/reset、`--exact`、坏启动参数）。

验收演练实测（固定随机种子，可复现）：4 个 tag 各 3 万随机 key，
12 万真实成员零假阴性；经验 FPR 与理论值偏差在 5σ 内；基数估算相对
误差 ≤ 0.09%；精确路径并/交/差大小与精确 set 完全一致；
`max_bits` 触发行为与 save/load 往返全部符合本文档。

## 设计取舍速查

* **双散列而非 k 次 sha256**：一次摘要 + 模运算，快且分布性质有
  Kirsch–Mitzenmacher 支撑；牺牲了理论上极微小的独立性换取数倍吞吐。
* **容量按分片预承诺而非逐位计数**：实现简单、内存确定性强；
  代价是最后一个没创建的分片“浪费”一份配额。
* **超限显式失败而非淘汰**：去重/权限场景静默丢数据比报错危险得多。
* **位图差集的局限写进语义而不是偷偷打补丁**：需要强差集时用
  `track_keys` 或 `ExactKernel`，成本与收益由调用方选择。
