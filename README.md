# 流式 Top-K 频繁项检测内核

一个可嵌入、可离线运行的流式热点探测 / 异常突增告警内核，**纯 Python 标准库**实现，
无第三方依赖、不接网络。提供：

- **全量 Top-K**：Space-Saving 算法，K 个槽位、有误差上界、内存 O(K)；
- **滑动窗口重频检测**：按逻辑时间维护当前窗口与前一窗口的**精确**带权计数；
- **突增检测**：当前窗口相对前一窗口的增长率告警（支持"从 0 到有"）；
- **精确模式**：保存全部 key 的真实计数，用于小规模对照 / 测试；
- **显式内存上限**：`max_memory_bytes`，超限**拒绝插入并报错**，不静默丢弃；
- **摘要合并**：`merge` 两个分片 tracker；
- **JSON 快照**：`save` / `load`，带严格一致性校验；
- **逐行 JSON 命令行入口**：`main.py`，便于用管道、脚本离线驱动。

## 文件

| 文件 | 说明 |
| --- | --- |
| `topk_kernel.py` | 内核：`Record`、`AddResult`、`TopKEntry`、`TopKTracker` 与异常类型 |
| `main.py` | 命令行入口，stdin 逐行 JSON 命令、stdout 逐行 JSON 结果 |
| `test_topk.py` | `unittest` 测试套件（79 个用例） |
| `README.md` | 本文档 |

环境：Python 3.10+（只用标准库）。

## 快速开始

### 作为库嵌入

```python
from topk_kernel import TopKTracker, Record, MemoryLimitError

t = TopKTracker(k=100, window_size=60, max_memory_bytes=16 * 1024 * 1024)

t.add(Record("user-7", weight=1, ts=1001))
t.add(Record("user-7", weight=3, ts=1002))   # weight 是本次贡献的正整数计数

t.top(10)                # [TopKEntry(key='user-7', estimated_count=4, error_bound=0), ...]
t.estimate("user-7")     # (4, 0)  -> (估算计数, 误差上界)
t.heavy_hitters(threshold=1000)   # 当前窗口内精确计数 >= 1000 的 (key, count)
t.burst_detect(ratio=2.0)         # 相比前一窗口增长 >= 200% 的 (key, growth, cur, prev)

t.save("state.json")
```

### 命令行

```bash
python main.py <<'EOF'
{"cmd": "init", "k": 3, "window_size": 5}
{"cmd": "add", "record": {"key": "a", "weight": 2, "ts": 0}}
{"cmd": "add", "record": {"key": "b", "ts": 1}}
{"cmd": "top"}
{"cmd": "heavy", "threshold": 2}
{"cmd": "burst", "ratio": 1.0}
{"cmd": "stats"}
{"cmd": "save", "path": "state.json"}
EOF
```

每行输出一个 JSON 对象。成功：

```json
{"ok": true, "cmd": "top", "result": [{"key": "a", "estimated_count": 2, "error_bound": 0}]}
```

失败（错误同样是一行合法 JSON，必含 `error` 字段）：

```json
{"ok": false, "cmd": "add", "error": "record.weight 必须是正整数，收到 0", "error_type": "ValidationError"}
```

## 核心数据结构与语义

### Record

`Record(key: str, weight: int = 1, ts: int = 0)`，frozen dataclass。校验：

- `key` 必须是非空 `str`（支持任意长度，包括极长 key）；
- `weight` 必须是正整数（0、负数、float、bool 一律拒绝）；
- `ts` 必须是非负整数（逻辑时间，由调用方注入）。

### Space-Saving 全量 Top-K

维护最多 K 个槽位，每槽 `(key, estimated_count, error_bound)`：

- 新 key 命中已有槽位：`count += weight`；
- 新 key 且表未满：开新槽，`count = weight`、`error = 0`；
- 新 key 且表满：淘汰 `count` 最小的槽位（平局按 key 升序），
  新槽 `count = 被淘汰槽 count + weight`，`error = 被淘汰槽 count`。

对仍在表中的 key，保证

```
estimated_count - error_bound <= 真实计数 <= estimated_count
```

`top(k=None)` 按估算计数降序、同计数按 key 升序；`k` 缺省用构造 K。
`estimate(key)` 对不在表中的 key 返回 `(0, 0)`。

### 滑动窗口与越界记录策略（重要）

窗口是固定网格上长度 `window_size` 的**左闭右开**区间：

```
[window_start, window_start + window_size)
```

- 网格默认以 0 为起点对齐，可用构造参数 `start_ts` 指定对齐基准
  （必须是 `window_size` 的整数倍）；
- **第一条记录**到达时，按其 `ts` 向下对齐到网格，建立当前窗口；
- `ts` 进入下一个网格时，当前桶整体变为"前一窗口"（`cur → prev`），
  新桶为空；`ts` 一次跳过多个网格时，旧两桶全部清空（中间的空窗口 prev 为空）。

**落在当前窗口之外（过期 / 乱序晚到）的记录采用的策略是：**

> **仍然计入全量 Space-Saving Top-K，但不计入任何滑动窗口统计。**

这样全局热点视图不因迟到数据缺失，而窗口语义保持"严格只统计当前区间"。
被忽略的记录数计入 `stats()['rejected_out_of_window']`，
`add()` 返回的 `AddResult.in_window` 为 `False`、`windowed` 为 0。

`heavy_hitters(threshold)` 返回**当前**窗口内带权计数 `>= threshold` 的
`(key, count)`，按计数降序、同计数按 key 升序。窗口计数是**精确**的
（不经过 Space-Saving 近似），因此不会漏掉任何真实重频项。

`window_size` 必须是正整数——**0 不是合法窗口长度**，构造时直接报错。

### 突增检测

`burst_detect(ratio)` 比较当前桶与前一桶：

- `prev_count > 0`：增长率 `growth = (cur_count - prev_count) / prev_count`；
- `prev_count == 0 且 cur_count > 0`：增长率记为 `+∞`（从无到有即突增），
  排序时排在所有有限增长率之前；
- 当前窗口计数为 0 的 key（下降 / 消失）不参与；
- 返回 `(key, growth, current_count, previous_count)`，按增长率降序、
  同增长率按 key 升序。

`ratio` 必须是 `(0, +∞)` 内的**有限**数：0、负数、NaN、`+inf` 都报错
（`+inf` 下任何有限增长都无法命中，语义无意义）。
注意还没有前一窗口（内核刚建立、只有当前桶）时，桶内每个 key 都是"从 0 到有"。

### merge 合并

`a.merge(b)` 原地把 b 并入 a 并返回 a。前提：两个 tracker 观察的是同一流的
**不相交分区**（标准摘要合并语义，例如两台机器各处理一半分片）。

- **槽位按 key 对齐**：同 key 的估算计数相加、误差上界相加；只在一方出现的
  key 原样保留；
- 合并后槽位数若超过 K，按与 `top()` 相同的次序（计数降序、key 升序）
  **保留前 K 个**，其余槽位丢弃；保留槽的计数/误差不做修改。
  相加得到的 `est - err <= 真值` 保证继续成立，且最小保留槽计数不低于任一
  被丢弃槽计数，Space-Saving 最小槽上界不变式保持；
- **支配性质**：合并结果第 i 名的估算计数 `>= max(a 第 i 名, b 第 i 名)`，
  即合并后的 Top-K 次序统计量不弱于两者各自的较大者（有测试覆盖）。
  注意这是对**排名**的保证，不保证某一方的每个键在合并后仍留在表中；
- **`t.merge(t)`（同一对象）是空操作**：同一批数据不会被重复计入，
  估算不会"翻倍"。两个相互独立、内容恰好相同的 tracker 代表两个不相交分区时，
  按摘要语义相加（3+3=6），这是正确行为；若你想要的是幂等，合并同一个对象即可；
- 窗口要求 `window_size`、对齐基准、**当前窗口起点**三者一致，否则报错
  （不同时间网格的窗口计数无法对齐）；一致时两桶按 key 相加；
- 空内核合并任意一方 = 直接采纳另一方；
- K、`window_size`、`exact` 模式必须一致，否则报错；
- 合并在临时结构上预演，**超内存上限时整体拒绝且 self 不变**（原子）。
  合并成功后 `max_memory_bytes` 取两者中较宽松者（None 视为无限）。

### 内存上限策略

构造时给 `max_memory_bytes`（int 字节数）：

- `None`（默认，或传负数）：不限；
- `0`：不允许任何 key 驻留，第一条插入即被拒绝；
- 正数：内核对内部状态（Space-Saving 槽位、堆条目、窗口两桶、精确 dict）
  做保守的字节记账，`stats()['memory_used']` 为当前估算占用。

**超限时的策略：拒绝本次插入，抛 `MemoryLimitError`，内核状态完全不变。**

- 被拒绝的插入不计入 `total_processed` / `total_weight`，窗口桶也不变；
  拒绝次数计入 `stats()['rejected_memory']`；
- **已有 key 的计数更新不申请新内存，永远不会被拒绝**；
- 表满淘汰换 key 时只可能新增"更长 key 字符串"的净差额，同样先预检、
  超限则拒绝且不发生淘汰；
- 懒删除堆会定期压缩（堆条目数有界，约 `4K` 量级），记账按摊销上限保守计入，
  因此长跑（几十万条以上）内存始终有明确上界。

记账口径是 64 位 CPython 对象大小的保守近似（宁高勿低），用于**可解释的额度控制**，
不是精确 RSS 测量。`estimate_record_size(record)` 可在调用方预估一条记录的大小。

### 精确模式

`TopKTracker(..., exact=True)`：

- 保存**全部** key 的真实计数（内部 dict，槽位数可以超过 K，不淘汰）；
- 槽位 `error_bound` 恒为 0，`estimate` 即真值，另有 `exact_count(key)`；
- 适合小规模数据下与近似模式做对照、单测、验收对拍；
- 精确模式同样受 `max_memory_bytes` 约束；只能与精确模式合并。

## 持久化（JSON）

`save(path)` 原子写入（临时文件 + `os.replace`），`load(path)` 读取并校验重建。
快照包含：版本号、配置（K / window_size / exact / max_memory_bytes / 对齐基准）、
槽位表、精确计数（仅 exact）、窗口两桶与起点、统计计数。

`load` 会做严格一致性校验，任何问题都抛 `SnapshotError`（不静默吞掉），包括：

- 文件不可读 / 不是合法 JSON / 顶层不是对象 / 版本号不支持；
- 必需字段缺失（逐字段报出位置与名称）；
- 近似模式槽位数超过 K；key 重复或为空；
- 估算计数不是正整数；误差上界为负或**超过估算计数**；exact 模式误差非 0；
- 窗口起点不是 `window_size` 相对对齐基准的整数倍；窗口计数为负；
  `start=null` 但桶非空；
- 统计计数为负；槽位估算总和超过累计权重；
  exact 模式精确计数与槽位/总权重不一致。

`save → load` 往返后状态完全相等，且**继续 add 的结果与原内核逐条一致**（有测试）。

## 命令行协议

`python main.py` 从 stdin 逐行读 JSON，每行一条命令；空行忽略；
无法解析的行返回 `InvalidJSON` 错误且不中断进程。所有响应为单行 JSON。

| 命令 | 字段 | 说明 |
| --- | --- | --- |
| `init` | `k`, `window_size`, `exact`, `max_memory_bytes`, `start_ts` | 初始化/重置内核（字段可省略，默认 k=100、window_size=10） |
| `add` | `record: {key, weight, ts}` | 插入；也可直接平铺 `key/weight/ts` |
| `top` | `k`（可选） | Top-K 列表 |
| `estimate` | `key` | `(estimated_count, error_bound)` |
| `heavy` | `threshold` | 窗口重频列表 |
| `burst` | `ratio` | 突增列表；`+∞` 增长率序列化为字符串 `"Infinity"` |
| `merge` | `path` 或 `snapshot` | 从快照文件或快照对象合并 |
| `stats` | — | 配置与运行统计 |
| `save` | `path` | 写快照 |
| `load` | `path` | 读快照并替换当前内核 |
| `dump` | — | 把完整快照对象作为结果返回 |

未执行 `init` 时，第一条业务命令惰性创建默认内核。错误响应形如
`{"ok": false, "cmd": ..., "error": "...", "error_type": "..."}`，
`error_type` 取值如 `ValidationError` / `MemoryLimitError` /
`SnapshotError` / `UnknownCommand` / `InvalidJSON` / `MissingField`。

## 运行测试

```bash
python -m unittest -v test_topk
```

覆盖：Record 校验、Space-Saving 加权淘汰与误差界、平局排序、K=1、
K 大于实际键数、窗口左闭右开与滑动/跳跃、越界记录策略、重频排序与无漏报、
突增（含 from-zero、下降不算、ratio 校验、构造突增场景命中）、精确模式、
合并（空/不相交/重叠/裁剪/支配性质/自合并不翻倍/窗口与配置校验/原子拒绝）、
内存上限（0 预算、拒绝后状态不变、换长 key 拒绝、20 万条长跑有界）、
快照往返与十余种损坏形态、CLI 单元与子进程测试、十万级对拍验收。

## 验收脚本示例

```python
import random
from collections import defaultdict
from topk_kernel import TopKTracker, Record

rnd = random.Random(0)
N, K, W = 300_000, 50, 1000
ss = TopKTracker(k=K, window_size=W)
truth, win_truth = defaultdict(int), defaultdict(int)
start_bucket = (N - 1) // W
for i in range(N):
    # 倾斜分布才有稳定的"头部"：指数采样，少量键承担大部分流量
    key = f"k{min(499, int(rnd.expovariate(1 / 20.0)))}"
    w = rnd.randint(1, 5)
    ss.add(Record(key, w, i))
    truth[key] += w
    if i // W == start_bucket:
        win_truth[key] += w

# 1) 顺序不能乱；2) 误差界；3) 真正的头部键必须被捕获
est = ss.top(K)
assert all(est[i].estimated_count >= est[i + 1].estimated_count for i in range(K - 1))
for e in est:
    assert e.estimated_count - e.error_bound <= truth[e.key] <= e.estimated_count
ref_top5 = {k for k, _ in sorted(truth.items(), key=lambda kv: (-kv[1], kv[0]))[:5]}
assert ref_top5 <= {e.key for e in est}

# heavy_hitters 不能漏掉任何真实重频项，且计数精确
got = dict(ss.heavy_hitters(50))
for key, cnt in win_truth.items():
    if cnt >= 50:
        assert got.get(key) == cnt   # 上述种子下 23 个真实重频项全部精确命中
```

> 注意：Space-Saving 的捕获能力针对**倾斜（有热点的）流量**。若 key 在大 universe
> 上均匀出现，本来就不存在稳定头部，Top-K 重合度低是正常现象；此时误差界保证仍然成立，
> 需要精确答案请用 `exact=True`。

## 设计边界 / 注意事项

- 时间是**调用方注入的逻辑时间**，内核不读墙上时钟、不接触网络；
  对同一 tracker 建议单调递增使用，乱序记录按上文"越界策略"处理。
- Space-Saving 是近似算法：头部高频项估计准确且有严格误差界，
  尾部冷门键可能根本不在表中（`estimate → (0,0)`）。分布越倾斜越准；
  需要绝对真值时用 `exact=True`。
- 窗口只保留"当前 + 前一"两个桶（为突增检测服务）；更早的历史不保留，
  需要长期留存请在外部定时 `save` 或自行订阅 `heavy_hitters` 的结果。
- 合并面向**分片并行**场景设计，要求时间窗口对齐；它不是"任意两个历史
  快照随便相加"的通用工具。
