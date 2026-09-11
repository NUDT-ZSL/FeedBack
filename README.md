# stream_aligner — 流式带窗 DTW 序列对齐内核

一个**可嵌入、纯 Python 标准库**的流式序列对齐内核，用于传感器轨迹比对、
语音片段检索等场景：上游不断按时间推来两条数值序列，你可以随时查询
“到目前为止的最佳对齐路径和距离”，且**新数据到达时只做增量更新**，
绝不整段重算。

- 零第三方依赖，仅用 Python 3.8+ 标准库（`dataclasses` / `json` / `math`）。
- 离线可跑，不访问网络；带完整 `unittest` 与独立的全量 DP 参考实现做等价性验收。
- 命令行入口 `main.py`：标准输入逐行读 JSON 命令，逐行输出 JSON 结果。

## 文件

| 文件 | 作用 |
| --- | --- |
| `stream_aligner.py` | 内核：`Series`、`StreamAligner`、结果 dataclass、度量、增量带窗 DTW、JSON 持久化 |
| `main.py` | 命令行入口（行式 JSON 协议） |
| `test_stream_aligner.py` | 单元测试，内含独立的“整段全量带窗 DTW”参考实现 |
| `README.md` | 本文档 |

运行测试：

```bash
python -m unittest -v
```

## 快速开始

```python
from stream_aligner import StreamAligner

al = StreamAligner("mic", "ref", metric="sq", band=5)

# 上游按时间推数据（任意交织顺序，每条序列内部保持先后即可）
al.append("mic", 0.0)
al.append("mic", 0.9)
al.append("ref", 0.1)
al.append("ref", 1.0)

result = al.align()
print(result.distance)        # 最佳对齐距离（float）；不可达时为 None
print(result.path)            # [(0, 0), (1, 1), ...]，从 (0,0) 到 (n-1,m-1)
print(result.warping_ratio)   # len(path) / max(n, m)
print(result.band_violations) # 正常为 0

state = al.get_state()        # 长度、已填充单元格数、窗口利用率、上次距离
al.save("state.json")         # 快照
al2 = StreamAligner.load("state.json")  # 重建后可继续 append
```

## 数据模型

### `Series`

```python
Series(name: str, values: list[float])
```

- `name`：非空字符串。
- `values`：有限浮点数列表（接受 `int`，内部归一化为 `float`），长度 **≤ 4096**。
- 以下情况抛 `SeriesValidationError`：名字为空/非字符串、值为 `NaN`/`±inf`、
  值不是数值、长度超过 4096。
- `Series` 是不可变（frozen）dataclass。也可以不直接构造它，只用
  `StreamAligner.append` 增量喂数据；`StreamAligner.from_series(a, b, ...)`
  支持用两条已有 `Series` 初始化。

### 距离度量（构造时配置，不可变）

| metric | 单元格代价 |
| --- | --- |
| `abs` | `|x - y|` |
| `sq`  | `(x - y)^2` |
| `cos` | `1 - cos(prefix_A_i, prefix_B_j)`，见下 |

非法度量名抛 `MetricError`。

**cos 语义**：在单元格 `(i, j)` 上比较的是两条序列**前缀**（长度分别为
`i`、`j`）。内积只对“较短一方长度”内的对齐下标求和（长度不足时按短的
一方对齐）：

```
dot(k) = Σ_{t=0}^{k-1} A[t]*B[t],  k = min(i, j)
cost(i,j) = 1 - dot(min(i,j)) / sqrt( Σ_{t<i} A[t]² · Σ_{t<j} B[t]² )
```

任一前缀范数为 0（**零向量**）时余弦无定义，抛 `ZeroVectorError`。
由于前缀平方和只会随追加单调增大，零向量前缀只可能出现在“**序列首值为
0**”这一种情况；而任何 DTW 路径都必须经过某个 `i=1` / `j=1` 的单元格，
所以内核对 **cos 度量下首值为 0 的 append 在改动任何状态之前直接拒绝**
（错误信息明确指出是哪条序列）。首值非零后，序列内部再出现 0 完全合法。

## 带窗 DTW（Sakoe–Chiba band）

DP 表维度 `(n+1) × (m+1)`，第 0 行/列是边界，除 `D[0][0]=0` 外均为无穷。

- 单元格 `(i,j)` **可填充当且仅当 `|i-j| <= band`**；窗口外单元格保持
  “不可达”（无穷、无前驱），**绝不参与计算，回溯路径也不可能穿过它们**。
- 递推：`D[i][j] = cost(i,j) + min(D[i-1][j], D[i-1][j-1], D[i][j-1])`。
- 路径步长只能是 `(1,0)`（A 重复）、`(1,1)`（对角）、`(0,1)`（B 重复）。
- 平局时前驱按 **上 → 左上 → 左** 的固定顺序选择，保证路径确定、可复现。

`band` 语义：

- 必须是**非负整数**，构造时传负数会被拒绝（`ValueError`）。
- `band = 0`：只允许对角线，即逐点一一配对。
- `band >= max(n, m)`：窗口覆盖整张表，退化为**无约束 DTW**。
- 长度差 `|n-m| > band` 时，端点 `(n,m)` 落在窗外，**对齐不可达**。

### 不可达处理（不抛未捕获异常）

`align()` 在任何不可达情况下返回 `AlignResult(distance=None, path=[],
warping_ratio=0.0, band_violations=0, reason=<说明>)`，`reason` 区分：

- 两条序列都为空；
- 其中一条为空；
- 长度差超过 band；
- 理论上的“窗内无合法路径 / 回溯未能到达 (0,0)”。

用 `result.reachable`（`distance is not None`）判断即可。

## 增量更新（本内核的重点）

每次 `append`：

- 追加到 A：DP 表**新增一行**，只计算该行里 `|i-j| <= band` 的单元格；
- 追加到 B：所有历史行**扩展一列**，只计算该列里 `|i-j| <= band` 的单元格。

**历史单元格永不重算、永不修改。** 单次追加的时间复杂度为 `O(2·band+1)`，
空间复杂度为窗口内单元格总数（约 `(2·band+1)·min(n,m)`），与序列总长度
近似线性相关，而不是无约束 DTW 的 `O(n·m)`。

`append` 返回 `AppendResult(name, new_length, recomputed, distance)`：

- `recomputed` 恒为 `False`——本实现没有“整表重算”这种状态，字段保留以
  明确语义；
- `distance` 是追加后立即查询的当前对齐距离（不可达/数据不足时为 `None`）。

**正确性保证**：增量结果与“把当前两条完整序列从头做一次带窗 DTW”的
**距离和路径完全一致**（浮点逐格同序累加，连平局选择都一致）。测试用
独立参考实现在*每一次 append 之后的每个前缀*上随机交织核对（数百组、
数千个前缀，三种度量、多种 band、A 先/B 先/随机交织三种喂入顺序）。

## 内存上限 `max_cells`

构造时可选 `max_cells`：

- `max_cells=None`（默认）：**精确模式，无上限**，适合小规模对照与验收；
- `max_cells=<正整数>`：限定 DP 表“已填充单元格数”的硬上限。
- `max_cells=0` 或负数在构造时直接被拒绝。

**触发策略：拒绝本次 append（fail-closed，绝不静默丢弃数据）。**

- 每次 append 前先精确预估“本次将新增多少个窗口内单元格”；
- 若会使 `filled_cells > max_cells`，抛 `MemoryLimitError`，错误信息给出
  当前格数、新增格数与上限；
- **该次 append 完全不生效**：序列长度、DP 表、已填充格数都保持不变，
  aligner 仍可继续使用（例如先 `save` 落盘，或改用别的会话）。

注意一个直观但重要的细节：当某条序列大幅领先、新行/新列与窗口不相交时，
那次 append **新增 0 个单元格**，因此即使在很小的 `max_cells` 下也允许
（数据被保留，只是暂不产生可对齐的格子）；等到对侧追上、需要真正计算
新格子时才可能触发上限。这保证“拒绝”永远只发生在会超预算的那一刻。

## 查询接口

### `align() -> AlignResult`

| 字段 | 含义 |
| --- | --- |
| `distance` | 最佳路径距离（float）；不可达为 `None` |
| `path` | `(i, j)` 二元组列表，值坐标（0-based），从 `(0,0)` 到 `(n-1,m-1)`；不可达为 `[]` |
| `warping_ratio` | `len(path) / max(n, m)`，观察扭曲程度（无扭曲≈1） |
| `band_violations` | 路径上 `|i-j| > band` 的步数，正常为 0 |
| `reason` | 不可达原因字符串；可达为 `None` |

结果带缓存，新的 append 会使缓存失效。

### `get_state() -> StateResult`

| 字段 | 含义 |
| --- | --- |
| `length_a` / `length_b` | 两条序列当前长度 |
| `filled_cells` | DP 表已填充单元格数（只含窗口内实际计算的格子） |
| `window_utilization` | `filled_cells / (n·m)`，窗口相对无约束全表的占比；无数据为 0.0 |
| `last_distance` | 最近一次对齐距离（未对齐过/不可达为 `None`） |

## JSON 持久化

- `save(path)`：把两条序列的值、名字、`metric`、`band`、`max_cells`、
  上次距离，以及 **DP 表窗口内每个单元格的值与回溯指针**写为 UTF-8 JSON
  （`allow_nan=False`，不会写入非法 JSON 浮点）。
- `load(path)`：读取后做**严格一致性校验**再返回可用的 aligner。校验包括：
  - 顶层是对象、格式标识为 `stream-aligner-v1`、必需字段齐全；
  - 序列名非空、值全部为有限数、长度 ≤ 4096；
  - `band` 非负整数、`metric` 合法、`max_cells` 为正整数或 null；
  - DP 维度 `(n+1)×(m+1)` 与序列长度匹配；
  - 每个存储单元格坐标合法、**都在窗口内**、无重复、窗口单元格无遗漏；
  - 用序列**逐格重算**，与存储的值和回溯指针逐一比对；
  - `last_distance` 与重算结果一致；cos 零首值、现有格数超过 `max_cells`
    等不一致也会被拒绝。
- 文件无法读取、JSON 损坏、字段缺失/类型错误、任何一致性失败，都抛
  `SnapshotError`，错误信息指明具体位置和原因，**绝不静默吞掉**。
- 往返后继续 append 的结果与“从未落盘”的实例逐格一致（有测试覆盖）。

## 命令行入口 `main.py`

从标准输入逐行读取 JSON 命令，每行输出一条 JSON 结果（离线、无网络）。

```bash
python main.py < commands.txt
```

成功：`{"ok": true, "cmd": ..., ...}`；失败：
`{"ok": false, "cmd": ..., "error": "<信息>", "error_type": "<异常类>"}`。
单条命令失败**不会中断进程**；空行不产生输出。

### 命令

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `new` | `name_a`,`name_b` 必填；`metric`(默认 abs), `band`(默认 4096), `max_cells`(默认 null) | 创建/重置会话 |
| `append` | `series`, `value` | 追加一个值；返回 name/new_length/recomputed/distance |
| `align` | — | 返回完整 `AlignResult` |
| `state` | — | 返回 `StateResult` |
| `save` | `path` | 写快照 |
| `load` | `path` | 读快照并替换当前会话 |
| `dump` | — | 输出当前完整快照字典 |

示例会话：

```json lines
{"cmd":"new","name_a":"mic","name_b":"ref","metric":"sq","band":5,"max_cells":100000}
{"cmd":"append","series":"mic","value":0.0}
{"cmd":"append","series":"ref","value":0.1}
{"cmd":"align"}
{"cmd":"state"}
{"cmd":"save","path":"state.json"}
{"cmd":"load","path":"state.json"}
{"cmd":"dump"}
```

## 边界情况一览（均有测试）

空序列、单点序列、长度差超过 band、`band=0`、`band` 为负（拒绝）、
度量非法（拒绝）、cos 零向量（拒绝零首值，状态不变）、`max_cells=0`
（构造拒绝）、内存上限触发（拒绝且原子）、save/load 往返一致并可继续
append、损坏/缺字段/篡改单元格的快照报清晰错误。

## 设计取舍与可复现性

- 平局前驱的固定优先级（上→左上→左）是内核与参考实现的共同约定；如果
  你的验收参考实现用了不同平局顺序，距离仍相同，但等价路径可能不同——
  对齐内核支持的是“同一确定性规则下的最优路径”。
- 距离为同一递推顺序下的浮点累加值；测试用 `isclose` 与精确相等结合核对。
- DP 表用嵌套 list 存储以保证回溯指针清晰；在固定 `band` 的持续流式场景
  下，内存随 `band·长度` 线性增长，请用 `max_cells` 设好预算。
