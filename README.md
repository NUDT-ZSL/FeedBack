# CAS：内容寻址块存储 + 差分同步内核

一套离线文件分发工具的底层存储：把文件切成固定大小的块，以内容 SHA-256
为块 ID 去重存储，并在两端之间只同步发生变化的块。**仅使用 Python 标准
库，不依赖第三方包，不接真实网络**，可离线运行、可用 `unittest` 直接测试。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `cas.py` | 内核：切块/哈希、`Manifest`、`SyncPlan`、`ContentStore`、`diff`、快照持久化 |
| `main.py` | 命令行入口：标准输入逐行读 JSON 命令，标准输出逐行写 JSON 结果 |
| `test_cas.py` | `unittest` 测试，69 个用例覆盖全部功能与边界 |
| `README.md` | 本文档 |

运行环境：Python 3.8+（用到 `dataclasses`、`typing` 等，均为标准库）。

## 快速开始

### Python API

```python
from cas import ContentStore, diff

local = ContentStore(block_size=4096)              # 无上限（精确模式）
remote = ContentStore(block_size=4096)

data_v1 = b"..."        # 旧版本文件
data_v2 = b"...(少量修改)"
m1 = local.add_file("report.bin", data_v1)
m2 = remote.add_file("report.bin", data_v2)

plan = diff(m1, m2)
print(len(plan.fetch_ids))          # 只需传输的变化块数，远小于总块数
content = local.apply_diff(plan, remote)   # 拉缺失块并重建
assert content == data_v2                    # 与远端文件逐字节一致
local.adopt_remote_manifest(plan)            # 登记新清单、替换旧版本
local.gc()                                   # 清理不再被引用的旧块
print(local.stats())
```

### 命令行（行式 JSON 协议）

```bash
python main.py
```

每行输入一条 JSON 命令（必须含 `cmd` 字段），每行输出一条 JSON 结果；
出错时输出 `{"error": "...", "error_type": "..."}`，进程不退出。
字节内容用 Base64（字段 `data_b64` / `content_b64`）传递。

```bash
$ printf '%s\n' \
  '{"cmd":"new_store","block_size":4096,"max_bytes":null}' \
  '{"cmd":"add_file","path":"a.txt","data_b64":"aGVsbG8="}' \
  '{"cmd":"stats"}' \
  '{"cmd":"save","dir":"./snap"}' | python main.py
{"ok": true, "block_size": 4096, "max_bytes": null}
{"manifest": {...}}
{"block_count": 1, "total_bytes": 5, ...}
{"ok": true, "dir": "./snap"}
```

## 核心模型

### 块与块 ID

* 文件按固定大小（默认 **4096 字节**，可配置）切块，最后一块允许更短；
  空文件切成 **0 个块**。
* 块 ID = `sha256(块内容)` 的十六进制字符串（64 字符）。
* 存储以块 ID 为键：相同内容物理上只存一份。`put_block` 幂等——重复
  写入不产生第二份数据，但每次调用都新增一个引用，可通过返回后的
  `ref_count(block_id)` 观察。
* 空块（0 字节）是合法块，同样有确定的 SHA-256，可去重。

### 清单 Manifest

每个文件对应一份清单，JSON 字段如下：

```json
{
  "path": "dir/a.bin",
  "length": 12307,
  "block_size": 4096,
  "block_ids": ["<sha256>", "..."],
  "content_hash": "<sha256 of 所有 block_id 顺序拼接>"
}
```

* `content_hash = sha256("".join(block_ids))`，描述块**序列**而非字节，
  用于校验清单自身完整性及重建结果。
* `Manifest.to_json()` / `Manifest.from_json(text, validate=True)`
  往返后字段完全一致；反序列化时缺字段、类型错、整体哈希不符都会抛
  `ManifestValidationError`。

### 引用计数、去重统计与 gc

* 每写入一个块、每被一个清单位置引用，引用计数 +1（同一清单内重复出现
  的块按出现次数计）。
* `stats()` 返回：
  * `block_count`：去重后的物理块数；
  * `total_bytes`：物理块内容总字节数（**实际占用**）；
  * `logical_bytes`：按引用次数累计的逻辑字节数；
  * `saved_bytes = logical_bytes - total_bytes`：去重节省的字节；
  * `ref_distribution`：引用计数 → 块数的分布摘要（含 `"0"`：待回收块）；
  * `manifest_count`：登记的清单数。
* `gc()` 删除所有计数为 0 的块并返回清理数量；计数为 0 的块在 `gc`
  之前仍然保留且可读。`release_ref` 不允许把计数减成负数。

## 策略约定（重要）

### 1. 两端块大小不同 → 拒绝差分

`diff(local, remote)` 比较的前提是块边界一致。若两端清单的 `block_size`
不同，**直接拒绝**，抛 `BlockSizeMismatchError`（异常带 `local_size` /
`remote_size`），不做任何重切或近似匹配——因为不同块大小下块 ID 几乎
必然全部不同，"差分"会退化成整文件重传且结果具有误导性。需要同步时
应统一块大小后重新切块（例如整文件重新 `add_file`）。CLI 在 JSON 错误
中额外返回 `local_size`、`remote_size` 字段。

### 2. `max_bytes` 内存上限 → 拒绝本次写入（原子）

* `ContentStore(block_size=4096, max_bytes=N)`：`N` 限制的是**去重后
  物理块内容总字节数** `stats()["total_bytes"]`（重复块只算一份）。
* 一次写入（`put_block` / `add_file` / `apply_diff`）若会使占用超过
  上限，**整次写入被拒绝**，抛 `StorageLimitError`（带 `need`、`used`、
  `limit`），存储状态与引用计数保持不变，不静默丢弃任何数据。
* `max_bytes=None`（默认）为**无上限精确模式**，用于小规模对照实验。
* `max_bytes=0` 时不允许任何非空块；空块占 0 字节，仍可写入。
* 替换同路径文件（`add_file` 同名再写、`replace_manifest`）时，旧版本
  **独占**块释放后腾出的空间计入可用量预检；被其它文件共享的块不会被
  提前回收。预检在"替换完成后的最终块集合"上精确计算，通过后才提交，
  保证严格上限下物理占用永不超限。

### 3. `delete_ids` 只是建议

`diff` 返回的 `delete_ids` 表示"本地有、远端新版本没有"的块。是否真正
删除由**引用计数**决定：仍被其它文件共享的块不会被删。安全落地方式是
`apply_diff` 后调用 `adopt_remote_manifest(plan)` 替换清单，再视需要
`gc()`；旧版本独占块会被回收，共享块保留。

### 4. apply 只搬数据，清单登记显式进行

`apply_diff(plan, remote_store)` 只负责：校验 → 拉取本地缺失块 → 拼装
重建内容，返回文件字节。它**不改动任何清单或已有引用**（新拉来的块计数
为 0）。需要把远端版本纳入本地管理时，显式调用
`adopt_remote_manifest(plan)`（或先 `save` 再自行 `add_manifest`）。

## 差分同步：为什么拉取列表是最小的

`plan.fetch_ids` = **远端块 ID 集合 − 本地块 ID 集合**（按远端序列中
首次出现顺序去重）。因此：

* 内容未变的块 ID 相同且本地已存在，**绝不会**进入拉取列表；
* 每个需要的新块在列表中恰好出现一次（即使它在远端文件中重复出现）；
* 只改 1 个块就只拉 1 个块；插入/删除块也只拉真正新增的块。

最小性可直接验证：`set(fetch_ids) == set(remote.block_ids) -
set(local.block_ids)`。测试中用一个包装类对 `remote_store.get_block`
做调用计数，断言实际远端读取次数恰为变化块数（未变化块零传输）。

`plan` 还包含：

| 字段 | 含义 |
| --- | --- |
| `fetch_ids` | 需要从远端拉取的块（远端有、本地没有），去重有序 |
| `delete_ids` | 本地旧版本有、远端新版本没有的块（删除建议） |
| `rebuild_ids` | 按顺序重建远端文件的**完整**块 ID 序列（含重复） |
| `remote_length` / `content_hash` / `block_size` | 重建校验信息 |

### `apply_diff` 的保证

1. 块大小不匹配 → `BlockSizeMismatchError`；
2. 计划引用但**远端也没有**的块 → 一次性收集全部缺失 ID 后抛
   `MissingBlockError`（异常带 `missing` 列表），**绝不静默跳过**；
3. 远端块内容哈希与其块 ID 不符 → `BlockHashMismatchError`；
4. `rebuild_ids` 重算出的整体哈希与计划不符 → `ContentHashMismatchError`；
   长度不符同样报错；
5. 受 `max_bytes` 约束，容量不足整次拒绝；
6. **所有校验与远端读取在提交前完成**，任何失败都不会在本地留下半成品块；
7. 成功时返回的字节与远端文件逐字节一致（其 SHA-256 等于对整文件直接
   哈希的参考实现结果）。

## 持久化：JSON 索引 + 块目录

`save(dir)` 写出如下布局（目录不存在自动创建）：

```
dir/
  meta.json            # {"version": 1, "block_size": ..., "max_bytes": ...}
  manifests.json       # 全部清单的列表
  refs.json            # 块 ID -> 引用计数
  blocks/
    index.json         # [{"id": <块ID>, "size": <字节数>}, ...]
    data/<块ID>         # 每个块内容按其块 ID 命名的独立文件
```

`ContentStore.load(dir)` 重建状态并执行完整一致性校验，任何问题都抛
`StoreCorruptionError` 并指出具体文件/字段/块 ID，**不静默吞错**：

* 必需文件缺失、JSON 损坏、顶层结构错误、字段缺失；
* 快照版本不支持；
* 索引中的块缺少内容文件、文件大小与索引不符；
* **块内容 SHA-256 与文件名（块 ID）不匹配**；
* 引用计数为负、不是整数、与块集合不一一对应；
* 清单缺字段、整体内容哈希与块序列不符、引用了不存在的块、
  清单长度与实拼块内容长度不符、同路径清单重复；
* 引用计数小于全部清单对该块的引用需求总和。

`save → load` 往返后 `stats()`、全部清单、块内容、引用计数完全一致，
可以继续进行 `add_file` / `diff` / `apply` / `gc` 等操作（测试
`test_continue_operations_after_load` 覆盖）。

## CLI 命令一览

| 命令 | 主要字段 | 说明 |
| --- | --- | --- |
| `new_store` | `block_size?`, `max_bytes?` | 重置进程内存储 |
| `put_block` | `data_b64` | 写块，返回 `block_id`、`ref_count` |
| `get_block` | `block_id` | 返回 `data_b64`、`size` |
| `add_file` | `path`, `data_b64`, `block_size?` | 切块写入并登记清单 |
| `remove_file` | `path` | 移除清单、释放引用（不自动 gc） |
| `manifests` | — | 列出全部清单 |
| `diff` | `local_path` 或 `local_manifest`；`remote_path` 或 `remote_manifest` | 返回 `plan` |
| `apply` | `plan`, `remote_dir?`, `adopt?` | 从远端快照目录（缺省用本进程存储）拉块重建；`adopt:true` 时同时登记清单 |
| `gc` | — | 返回 `{"removed": n}` |
| `stats` | — | 返回存储统计 |
| `save` / `load` | `dir` | 快照写入 / 恢复（load 替换当前存储） |
| `dump` | — | 完整可检视状态（统计、引用表、清单、块索引） |

错误统一形如：

```json
{"error": "可读原因", "error_type": "StorageLimitError"}
```

部分错误附带结构化字段，如 `MissingBlockError.missing`、
`BlockSizeMismatchError.local_size/remote_size`。

**离线模拟两端**：一个进程 `save` 到 A 目录，另一个进程 `save` 到 B
目录；同步方在 `diff` 命令里直接传对端 `manifests.json` 中的清单对象，
`apply` 时用 `"remote_dir": "B"` 指向对端快照目录即可（测试
`test_full_cli_workflow` 用真实子进程演示了完整流程）。

## 典型同步流程

```python
local  = ContentStore(max_bytes=100 * 1024 * 1024)
remote = ContentStore()                       # 远端，无上限

plan = diff(local.manifests["f"], remote.manifests["f"])
content = local.apply_diff(plan, remote)      # 只传变化块
local.adopt_remote_manifest(plan)             # 切换到新版本清单
local.gc()                                    # 回收旧版本独占块
local.save("./snapshot")                      # 落盘快照
```

## 运行测试

```bash
python -m unittest -v
```

覆盖范围：切块与块 ID 计算（空文件/单块/非整数倍/空块/非法块大小）、
清单与计划 JSON 往返、去重与引用计数生命周期、`gc` 与共享块保护、
差分最小性（含 get_block 计数器）、块大小不匹配拒绝、apply 重建整文件
哈希一致、远端缺块/坏块/坏整体哈希报错与失败原子性、`max_bytes`
（0、精确拒绝、去重只算一份、替换回收、apply 上限）、save/load 往返
后继续操作、10 种快照损坏情形、多文件参考实现综合验收、CLI 行式协议
（含两个真实子进程的端到端同步）。
