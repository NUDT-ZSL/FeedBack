# 离线分布式存储修复内核

一套**完全离线、仅依赖 Python 标准库**的条带存储修复内核：在部分数据块/校验块
丢失、损坏，甚至同一位置出现互相矛盾的多份候选内容时，把条带重建回一致状态，
并让重建结果可以被独立验证。所有判定都是**确定性**的——同样的初始状态与请求
序列，无论内部如何到达（含候选到达顺序不同），都得到相同的结论、修复记录与
最终内容。

- Python ≥ 3.10，只用标准库（`hashlib`、`json`、`base64`、`itertools`、`dataclasses`、`enum`、`argparse` …）。
- 不接真实网络，可完全离线运行。
- 公开代码全部带类型注解与 docstring，测试使用 `unittest`。

## 目录结构

```
storage_repair/
  coding.py        GF(256) 与 Cauchy 系统型 Reed–Solomon 编解码（MDS）
  models.py        数据模型、四态枚举、异常体系、块/条带/记录/报告序列化
  diagnosis.py     候选裁决 + 唯一最近码字诊断（纯函数）
  engine.py        StorageEngine：全部逐条操作、修复、只读验证
  persistence.py   JSON 快照导出/导入与严格校验（原子载入）
  cli.py           JSON-per-line 逐条请求接口
tests/             unittest 测试（编码/诊断/引擎/持久化/CLI/验收场景）
```

运行测试：

```bash
python -m unittest discover -s tests -v
```

## 1. 条带与校验关系

- 条带有**非空唯一标识**、`k`（数据块数，≥1）、`m`（校验块数，≥0，`k+m≤256`），
  `k/m` 创建后不可更改；总块数恒为 `k+m`，位置编号 `0..k+m-1` 连续，
  其中 `0..k-1` 为数据块、`k..k+m-1` 为校验块。
- 字节域为 **GF(256)**，本原多项式 `x^8+x^4+x^3+x+1`（`0x11B`），本原元 `3`。
- 编码采用 **Cauchy 矩阵构造的系统型生成矩阵 `G=[I|P]`**：
  `P[i][j] = 1 / (i xor (255-j))`。Cauchy 矩阵任意行列子集非奇异，因此
  `G` 的**任意 k 列线性无关（MDS）**：
  - **纠删能力**：任意 `k` 个完好块即可逐字节唯一重建全部块，最多容忍
    **`m` 个已知丢失/损坏块**；缺失数超过 `m` 明确判为不可重建。
  - 重建依据位置确定：取目标之外编号最小的 `k` 个完好块，并在修复记录中报告。
- 块按字节对齐；不等长数据块右侧补零，补零字节数按位置记录，重建短数据块后
  截回原逻辑长度。校验块不补零（按统一块长计算）。

## 2. 位置四态

| 状态 | 含义 |
| --- | --- |
| `intact` | 持有被信任的当前内容 |
| `missing` | 明确标记丢失，无当前内容（候选保留） |
| `corrupt` | 标记损坏；内容若还在也不被修复信任，仅用于诊断 |
| `conflict` | 多份候选互相矛盾且无严格多数，拒绝采纳 |

重复把同一位置标记为丢失/损坏是**幂等**的，不报错。

## 3. 候选内容信任规则（顺序无关）

某位置有 `N` 份候选（同一来源标签在该位置至多一份；同来源登记相同内容幂等，
登记不同内容报错）：

1. 按**内容字节**分组（不看顺序）。
2. 仅一组（逐字节全同）→ 采纳，`unanimous`。
3. 多组时取得票最多的组：
   - 得票**严格过半**（`count > N/2`）→ 采纳，`majority`；
   - 否则（平票或不过半）→ 判 `conflict`，**拒绝重建**该位置。
4. 并列入选用内容指纹 SHA-256 十六进制字典序打破，只影响记录里“代表来源”
   （组内来源字典序最小者），**不影响被采纳的字节**。

因此候选以任意顺序到达，分组、得票、结论与最终内容完全一致（有测试穷举排列）。

## 4. 数据块与校验块矛盾时的判定（唯一最近码字译码）

当“看似完好”的内容不满足校验方程时，系统按规模升序枚举**最小一致损坏集**
（删除后剩余内容自洽的最小位置集合），即寻找与接收字**最接近的码字**：

- 删除后剩余位置 **≥ k+1**（至少保留一个校验余力真正验证方程；只剩 k 个时
  任意内容都平凡自洽，不算被验证的解释）。
- 最小层上**唯一**集合 → 唯一确定坏位置：只含校验位置则以数据为准**重算校验块**；
  含数据位置则由其余块重建。
- 最小层上**多个**集合（`ambiguous`），或所有解释都落在“删后只剩 k 个”的
  不可验证层（`underdetermined`）→ **绝不挑选**，报告无法唯一确定，并在
  `inconsistent_positions` 中列出**全部互相矛盾的位置组合**（按字典序）。

**保证**：码距为 `m+1`，真实**静默**错误不超过 `⌊m/2⌋` 个时，真实码字唯一最近，
诊断必然唯一正确（有 200 组随机性质测试）。超过该半径：方程仍给出唯一最近码字
时确定性采纳；一旦并列或不可验证就拒绝。需要修复更多块时，应显式
`mark_missing/mark_corrupt`，把它们变成**已知纠删**，此时最多可重建 `m` 个。

- 只有校验块与其余块矛盾（数据块自洽）→ 唯一坏集只含校验位置，以数据重算。
- 多个数据块互相矛盾 → 出现多个等规模解释，拒绝并列出所有矛盾位置组合。

枚举设有组合数上限（`diagnosis.MAX_COMBOS_PER_LEVEL`，默认 100000），超限按
“无法唯一确定”失败，绝不猜测。

## 5. 完整性验证（只读、确定）

`verify_stripe()` 只读，不修改任何块内容或标记；对同一状态重复验证得到逐字段
相同、键顺序确定的报告。报告含：

- 每个位置的状态（`intact/missing/corrupt/conflict`）与一句话 `detail`；
- `reconstructable`：当前是否能完整重建；
- `inconsistent_positions`：发现的不一致位置组合（升序、去重）。

被标记完好但与校验矛盾、且坏位置可唯一诊断时，报告中该位置呈现 `corrupt`
（条带内的实际标记不变）。

## 6. 修复记录（确定性、可复演）

每次 `repair_stripe()` 都追加一条按条带连续编号（从 1 起）的记录，**失败也记录**：

| 字段 | 含义 |
| --- | --- |
| `sequence` | 条带内修复序号 |
| `trigger_reason` | `missing/corrupt/conflict/mixed/candidate_update/manual/none` |
| `target_positions` | 本次修复的目标位置（升序） |
| `used_positions` | 实际参与重建的依据位置（升序；纯候选采纳时为空，依据见来源） |
| `candidate_sources` | 位置 → 最终采用候选的来源标签 |
| `adopted_fingerprints` | 位置 → 最终采用内容的 SHA-256 指纹 |
| `inconsistent_positions` | 诊断出的矛盾位置组合 |
| `success` / `reason` | 是否成功；失败时的明确原因 |

修复在所有新内容计算成功后才一次性落地；失败不改任何块。相同初始状态重复修复，
记录与最终内容完全相同。

## 7. JSON 导出 / 导入

`persistence.export_engine(engine, path)` 写出 UTF-8、缩进、键排序（字节确定）
的快照；`import_file(engine, path)` 载入。快照含：格式名与版本、校验配置
（GF(256)/多项式/Cauchy-MDS）、条带结构、各位置内容或缺失标记、**候选内容**、
块长与补零、**修复历史**、导出时的**验证报告**。

导入时严格校验并给出可定位（条带/位置/字段）的错误：

- 顶层字段、格式名与版本；
- 条带标识唯一、`k/m` 合法、块数等于 `k+m`、位置编号连续、状态枚举合法；
- 内容/候选可 base64 解码，候选复核 SHA-256 指纹，补零长度自洽；
- `intact` 必须有内容、`missing` 内容必须为 null、候选来源不重复；
- 修复历史引用的条带存在、序号从 1 连续、位置不越界、失败记录必须有原因；
- 验证报告引用的条带存在、位置键与状态合法。

载入先在局部对象中完成全部构建与校验，成功后才整体替换引擎状态——
**任何校验失败，内存状态保持不变**。

## 8. 逐条操作接口

### Python API

```python
from storage_repair import StorageEngine
from storage_repair import persistence

eng = StorageEngine()
eng.create_stripe("s", k=3, m=2, data_blocks=[b"AAAA", b"BBBB", b"CCCC"])
eng.mark_missing("s", 1)
rec = eng.repair_stripe("s")          # 逐字节重建，rec.used_positions 报告依据
report = eng.verify_stripe("s")       # 只读
eng.add_candidate("s", 0, "replica-a", b"AAAA")
persistence.export_engine(eng, "snap.json")
```

常用方法：`create_stripe / list_stripes / get_stripe / write_block /
mark_missing / mark_corrupt / add_candidate / repair_stripe / verify_stripe /
query_position / repair_history / internal_state / imported_report`。

### 命令行（JSON Lines）

```bash
python -m storage_repair.cli < requests.jsonl > responses.jsonl
python -m storage_repair.cli --file requests.jsonl
```

每行一个请求，每行一个响应 `{"ok": true/false, "op": ..., "result"|"error": ...}`；
单条失败不中断后续请求，`error` 含异常类型与可定位信息。内容统一用标准
base64 字段 `content_b64` / `data_b64`。支持操作：

`ping, help, create_stripe, list_stripes, write_block, mark_missing,
mark_corrupt, add_candidate, repair, verify, query_position, repair_history,
internal_state, export, import`。

示例：

```json
{"op":"create_stripe","stripe_id":"s","k":2,"m":1,"data_b64":["YWE=","YmI="]}
{"op":"mark_missing","stripe_id":"s","position":0}
{"op":"repair","stripe_id":"s"}
{"op":"verify","stripe_id":"s"}
```

## 9. 边界行为一览

| 场景 | 行为 |
| --- | --- |
| 空系统 | `list_stripes()==[]`，查询条带报 `StripeNotFoundError` |
| 单块条带 `k=1,m=1` | 数据↔校验可互相重建 |
| `m=0` | 无冗余，丢任意块即明确不可重建 |
| 全部数据块丢失 | 缺失数 > m 时明确失败，不返回错误结果 |
| 缺失恰为 `m` | 可重建（边界） |
| 缺失超过 `m` | 明确失败并说明“超出修复能力”，状态不变 |
| 候选逐字节全同 | 采纳（unanimous） |
| 候选严格多数 | 采纳多数内容（majority），与顺序无关 |
| 候选平票/不过半 | `conflict`，拒绝重建并记录 |
| 仅校验块矛盾 | 以数据为准重算校验块 |
| 多数据块矛盾 | 无法唯一确定，列出全部矛盾位置组合，拒绝 |
| 重复标记同一位置 | 幂等 |
| 导入损坏/缺字段文件 | 清晰 `SerializationError`，引擎状态不变 |

## 10. 异常体系

`StorageRepairError` 为根；条带/位置相关异常携带 `stripe_id`（及 `position`），
错误信息形如 `[stripe=s][position=3] ...`，便于定位。包括
`StripeNotFoundError / DuplicateStripeError / InvalidPositionError /
InvalidConfigError / InvalidContentError / ConflictError /
NotReconstructableError / SerializationError`，以及引擎层的
`DuplicateCandidateError`。
