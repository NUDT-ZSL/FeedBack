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

参与比较的某个前缀范数为 0（**零向量**）时余弦无定义，该次比较非法，
抛 `ZeroVectorError`。规则只看“**参与比较的前缀**”，因此：

- **首值为 0 不会在数据刚进来时被拒绝**。如果此刻对侧还是空序列，新行/列
  与窗口不相交、没有任何单元格会被计算，这个 0 会被正常暂存；之后追加
  非零值可使该侧更长前缀的范数恢复为正。
- 一旦某次 append 新增的窗内单元格需要用到零范数前缀——可能是本侧的新
  前缀，也可能是对侧的某个历史前缀（例如对侧进第一个点时，单元格
  `(1,1)` 必须拿长度为 1 的前缀做比较）——就会在**改动任何状态之前**
  抛 `ZeroVectorError`，本次 append 完全不生效，调用方捕获后可继续追加
  别的值。
- 首值非零后，序列内部再出现 0 完全合法（前缀平方和一旦为正就不会回零）。

> 说明：标准 DTW 路径必然经过首行/首列，所以当两条序列都非空时，长度为
> 1 的零前缀迟早会被比较。允许“零首值暂存”只是把报错推迟到它**真正参与
> 比较**的那一刻，严格对应“向量长度不足时按短的一方对齐、只有参与比较的
> 零向量才报错”的语义。

## 带窗 DTW（Sakoe–Chiba band）

DP 表维度 `(n+1) × (m+1)`，第 0 行/列是边界，除 `D[0][0]=0` 外均为无穷。

- 单元格 `(i,j)` **可填充当且仅当 `|i-j| <= band`**；窗口外单元格保持
  “不可达”（无穷、无前驱），**绝不参与计算，回溯路径也不可能穿过它们**。
- 递推：`D[i][j] = cost(i,j) + min(D[i-1][j], D[i-1][j-1], D[i][j-1])`。
- 路径步长只能是 `(1,0)`（A 重复）、`(1,1)`（对角）、`(0,1)`（B 重复）。
- **平局规则**：当多个前驱取得相同最小值时，前驱按
  **上 `(i-1,j)` → 左上 `(i-1,j-1)` → 左 `(i,j-1)`** 的固定优先级选择
  （实现上是严格 `<` 的比较链，平局不覆盖已选中的前驱）。这与验收用的
  全量参考实现逐格一致：即使某格“上”和“左”相等且都小于“左上”，也稳定选
  “上”。平局不影响 `distance`，只决定路径走向；`warping_ratio` 与
  `band_violations` 每次 `align()` 都由当前路径实时派生，不会残留旧路径的值。

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

**从不可达中恢复是自动的**：`align()` 不保存任何“上次不可达”的标记，
每次都根据当前 DP 表即时判断端点。典型场景——两条序列长度差超过 band 时
返回 `distance=None`，之后继续 append 让对侧追上来、长度差回到 band 以内，
下一次 `align()` 立即给出与全量参考一致的正确 `distance`/`path`，不会残留
旧的不可达状态或旧路径（可在 `可达 → 不可达 → 可达` 的反复切换下保持正确）。

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
  - `last_distance` 与重算结果一致；一旦存储的值会让某个窗内单元格用到
    零范数前缀（cos）、或现有格数超过 `max_cells` 等不一致也会被拒绝。
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
度量非法（拒绝）、cos 零向量（**仅当参与比较的前缀为零向量时报错**；零首值
在对侧为空时允许暂存，报错时 append 原子失败、状态不变）、`max_cells=0`
（构造拒绝）、内存上限触发（拒绝且原子，格数/利用率不变）、不可达后随
append 自动恢复、save/load 往返一致并可继续 append（含平局路径与 cos
边界）、损坏/缺字段/篡改单元格的快照报清晰错误。

## 设计取舍与可复现性

- 平局前驱的固定优先级（**上 → 左上 → 左**，严格 `<` 比较链）不是含糊
  约定，而是与“整段从头算、同优先级”的全量参考实现**逐格相同**的确定性
  规则：任意平局下 `distance` 与 `path` 都与该参考逐点一致。测试用一个
  手工构造的 `up==left<diag` 平局（`a=(0,1,0), b=(1,0,1)`）和小字母表
  穷举（上千网格）做防回归。若你的验收参考采用别的平局顺序，距离仍相同，
  但等价最优路径可能不同——本内核承诺的是“上→左上→左”这一确定规则。
- 距离为同一递推顺序下的浮点累加值；测试用 `isclose` 与精确相等结合核对。
- DP 表用嵌套 list 存储以保证回溯指针清晰；在固定 `band` 的持续流式场景
  下，内存随 `band·长度` 线性增长，请用 `max_cells` 设好预算。
