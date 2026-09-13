# cdiff — 内容指纹与差分补丁引擎

一个**纯 Python 标准库**实现的离线数据分发工具：

1. 用基于内容定义的分块（Content-Defined Chunking, CDC）给任意字节内容
   计算稳定、可比较的**指纹**；
2. 对两份内容生成只含 `COPY` / `ADD` 两种指令的**最小化差分补丁**；
3. 在另一端只凭旧内容和补丁**精确还原**新内容，先校验版本指纹再应用；
4. 提供相似度报告、JSON 持久化和逐行 JSON 的命令行入口。

无第三方依赖、可完全离线运行，配套 `unittest` 测试。

## 目录结构

```
cdiff/
  __init__.py      包入口，公开全部 API
  chunking.py      buzhash 滚动哈希 + 内容定义分块
  fingerprint.py   块指纹（SHA-256）与整文件指纹的滚动合并
  delta.py         diff / patch、COPY/ADD 指令、补丁二进制编码
  report.py        compare 相似度与差异报告
  persistence.py   补丁的 JSON save/load 与严格校验
  errors.py        异常类型
main.py            命令行入口（stdin 逐行 JSON）
tests/             unittest 测试
```

## 快速开始

```python
from cdiff import fingerprint, diff, patch, compare, patch_size, save_delta, load_delta

old = open("old.bin", "rb").read()
new = open("new.bin", "rb").read()

fp = fingerprint(old)
print(fp.digest, fp.chunk_count, fp.chunk_sizes)

delta = diff(old, new)
print("patch bytes:", patch_size(delta), "vs new bytes:", len(new))

# 另一端：只凭 old + delta
assert patch(old, delta) == new

# 保存成 JSON，拷到对端后读回（读回时做全面一致性校验）
save_delta("delta.json", delta)
delta2 = load_delta("delta.json")
assert patch(old, delta2) == new

print(compare(old, new))
```

## 算法说明

### 1. 内容定义分块（`cdiff/chunking.py`）

- 自实现 **32 位 buzhash 滚动哈希**：维护 32 字节滑动窗口
  `h = XOR_j ROTL^(31-j)(table[b_j])`，窗口滑动只需一次循环左移和
  两次查表 XOR；`table` 由 GF(2) 多项式 `0x3DA3358B` 对 256 个字节
  确定性生成（256 项两两不同且非零，跨进程稳定）。
- 当 `h & mask == 0` 时切出内容定义边界，`mask = 2^ceil(log2(avg))-1`，
  平均块长约为 `avg_size`。
- `min_size` 内不切、`max_size` 强制切，避免极端块长。
- 边界只取决于窗口字节、与绝对位置无关：中间插入/删除/修改一个字节，
  只重切它所在的那一块，后续块整体平移、内容不变。

`ChunkConfig(avg_size, min_size, max_size)` 三个参数均可配置，非法配置
（`avg_size<=0`、`min_size>max_size` 等）抛 `InvalidConfigError`。

### 2. 指纹（`cdiff/fingerprint.py`）

- **块指纹**：每个块算 SHA-256（标准库 `hashlib` 是唯一使用的哈希黑盒，
  分块逻辑全部手写）。
- **整文件指纹**：把块指纹的十六进制摘要按序喂入一个 SHA-256 上下文，
  再追加块数和总长度（各 8 字节大端），最终化为 64 位十六进制摘要。
- 空内容有确定的固定指纹；同一内容在同一配置下结果逐字节稳定。

`fingerprint(data, config=None)` 返回 `Fingerprint`：

| 字段 | 含义 |
| --- | --- |
| `digest` | 整文件指纹（十六进制字符串） |
| `size` | 内容总字节数 |
| `chunk_count` / `chunk_sizes` | 块数量与各块长度 |
| `chunks` | `ChunkFingerprint(offset, length, digest)` 列表 |
| `config` | 分块配置 |

局部性：在 8 万字节数据中间翻转 1 个字节，通常只有 **1 个块指纹**变化，
其余块指纹原样保留，整文件指纹必然变化。

### 3. 差分补丁（`cdiff/delta.py`）

补丁指令只有两种：

- `COPY(offset, length)`：从**旧内容**的 `offset` 处复制 `length` 字节；
- `ADD(data)`：插入字面字节。

生成策略：新旧内容用同一配置切块并算块指纹；新内容中的块若强哈希
命中旧内容中的某个块，就发一条 `COPY`（旧侧每个块按出现次数消费，
重复块不会超量复用），块之间无法复用的缝隙合并成尽量少的 `ADD`；
相邻、引用区间相邻的 `COPY` 会合并，零长指令被丢弃。

补丁记录所依赖的**旧文件指纹**与目标**新文件指纹**。

`patch(old, delta)` 的执行顺序：

1. 先计算 `old` 的指纹，与补丁记录的旧指纹比对，不一致直接抛
   `FingerprintMismatchError`（异常上带 `expected`/`actual` 两个指纹，
   错误信息也同时包含二者），不产生任何输出；
2. 逐条校验全部指令（`COPY` 非负且不越界、指令对象合法）；
3. 拼接还原，并再次校验结果与补丁记录的新指纹一致。

任何错误都抛 `CorruptPatchError` / `FingerprintMismatchError`，
**绝不返回半成品**。

`patch_size(delta)` 返回指令序列紧凑二进制编码（魔数 `CDF1` +
`COPY=0x01`/`ADD=0x02` 的定长记录）的字节数，用来衡量补丁大小。

**最小性**：高度相似的大内容（中间小插入/小修改）补丁通常只有新内容
的百分之几；测试硬性要求补丁小于新内容的一半。完全相同的内容生成
**仅一条** `COPY(0, len(old))`，补丁只有 21 字节。

### 4. 相似度与差异报告（`cdiff/report.py`）

`compare(old, new)` 返回 `DiffReport`：

- `common_bytes`：新内容中通过 `COPY` 从旧内容复用的字节数；
- `added_bytes`：`ADD` 引入的字节数（`common + added == len(new)`）；
- `deleted_bytes`：旧内容中未被复用的字节数（`len(old) - common`）；
- `changed_chunks`：只出现在一侧的内容定义块数量；
- `similarity`：相似度，定义如下。

**相似度定义（Sørensen–Dice 系数，按复用字节计）**：

```
similarity = 2 * common_bytes / (len(old) + len(new))
```

- 完全相同（含两份空内容）：`1.0`；
- 完全不同（没有任何可复用块）：`0.0`；
- 其余落在 `(0, 1)`，结果被夹在 `[0, 1]`。

`common_bytes` 直接取自补丁里 `COPY` 长度之和，报告与补丁严格一致。

### 5. JSON 持久化（`cdiff/persistence.py`）

`save_delta(path, delta)` 写出一个 JSON 文件，包含：补丁指令、
旧/新指纹、分块配置、统计信息，以及指令序列紧凑二进制编码的 base64
快照。`load_delta(path)` 读回时严格校验：

- 文件可读且为合法 JSON，顶层 `format`/`version` 正确，必需字段齐全；
- 每条指令类型合法；`COPY` 的 offset/length 非负且不超出旧内容；
  `ADD` 的 base64 可解码；
- 指纹格式合法（64 位十六进制）、块偏移连续、长度求和自洽，并且
  **整文件指纹必须能由块指纹重新合并得到**（防篡改）；
- 指令产出的总长度等于新指纹记录的大小；
- 二进制快照与 JSON 指令列表逐条一致（防局部篡改/截断）；
- 记录的 `patch_size` 与实际编码长度一致。

任何不符都抛带明确说明的 `CorruptPatchError`，不会静默吞掉异常。
save 后 load 得到的补丁可直接再次 `patch()` 应用。

## 命令行 `main.py`

从标准输入**逐行读取 JSON 命令**，每条命令输出**一行 JSON 结果**；
错误也输出一行 JSON，形如 `{"error": "...", "error_type": "..."}`，
指纹不匹配时还带 `expected` / `actual`。空行跳过，单行错误不影响
后续命令。字节内容用 `*_b64`（base64）或 `*_hex`（十六进制）表示，
可安全处理二进制数据。

| 命令 | 主要字段 |
| --- | --- |
| `fingerprint` | `data_b64` / `data_hex`，可选 `config` |
| `diff` | `old_b64`+`new_b64`（或 hex） |
| `patch` | `old_b64` + `delta`（内联补丁）或 `path`（补丁文件） |
| `compare` | `old_b64` + `new_b64` |
| `save` | `path` +（`delta` / `delta_path` / 直接给 old、new） |
| `load` | `path` |
| `dump` | `delta` 或 `path`：输出指令、指纹、配置、统计摘要 |

`config` 形如 `{"avg_size":1024,"min_size":256,"max_size":4096}`。

示例：

```bash
printf '%s\n' \
  '{"cmd":"fingerprint","data_hex":"48656c6c6f"}' \
  '{"cmd":"compare","old_b64":"aGVsbG8=","new_b64":"aGVsbG8h"}' \
  | python main.py
```

`diff` 的输出本身就是自包含补丁文档，可直接作为后续 `patch` /
`save` 命令的 `delta` 字段回传。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

覆盖：分块尺寸/边界与内容定义局部性、指纹稳定性与序列化校验、
补丁生成与全形态往返、最小性、相似度 0/1 边界、save/load 快照往返、
指纹不匹配/越界/截断/坏文件等错误路径，以及命令行协议。

## 错误类型

| 异常 | 触发场景 |
| --- | --- |
| `InvalidConfigError` | 分块配置非法 |
| `FingerprintMismatchError` | 补丁依赖的旧指纹与传入内容不符（带两个指纹） |
| `CorruptPatchError` | 指令非法、COPY 越界、补丁截断、字段缺失、文件损坏等 |

三者都继承自 `cdiff.CdiffError`。
