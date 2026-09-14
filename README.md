# 分层令牌配额内核（Hierarchical Token Quota Kernel）

零依赖的纯 Python（3.10+）实现，解决"多个业务线共用一个扁平配额池、子级各自
没超但总和打穿父级"的问题。父级与子级额度之间存在明确的**借用、归还、竞争**
规则，任何时刻沿层级向上的记账约束都成立。

- `quota_kernel.py` — 内核 + 逐条操作调度器 + JSONL 命令行
- `test_quota_kernel.py` — 52 个 unittest（层级、竞争、借用归还、突发回落、
  删除/禁用回收、导出导入往返、损坏拒绝、确定性重放、400 步随机游走守恒）

## 1. 模型

每个节点是一个**双桶**：

| 桶 | 上限 | 补充 | 用途 |
|---|---|---|---|
| 稳态桶 `steady` | `capacity` | 按 `rate`（令牌/逻辑时间单位）连续补充，满则溢出 | 本层消耗、借给直接子节点 |
| 突发桶 `burst` | `burst_capacity` | **一次性，永不恢复** | 只供本层短时超速率消耗，不外借 |

### 一次请求在每一层怎么记账

请求 `n` 个令牌时沿路径**自根向叶**逐层判定，每一层都必须独立为整笔 `n`
持有足够令牌：

1. 本层先用自己的**稳态桶**支付本层份额 `n`；
2. 非根层稳态不足时，只允许向**直接父节点**借入父节点*付完自身份额之后*
   剩余的稳态令牌。父节点为一笔请求实际支出"自身份额 + 借给子节点"两份，
   但都出自同一个稳态桶，绝不可能超过自己的容量；
3. 只有请求到达的**目标节点**可以动用自己的突发桶（顺序为稳态→突发→借用）；
   祖先层突发桶永不参与子孙请求；
4. 令牌逐层可行后，还要通过一道**独立的准入检查**：自根向叶逐对父子校验
   落账后"同一父节点下所有子级已用之和 ≤ 父级容量"，第一道越界即整笔
   拒绝（根无父可借、父容量约束、祖先禁用分别给出明确原因码）。

整笔判定在临时账本上完成，任一层失败都不落任何账，拒绝返回从请求节点
一路到根的原因链（`ok / insufficient / disabled / not_evaluated`）。

为什么字面约束一定成立：借入即耗、不进入借入方稳态桶且**不得转贷**——
中间层绝不可能把从上游借来的令牌再借给下游；再加上独立的子级总额准入
检查（突发桶一次性、突发伤疤永久计入子级已用，即使父桶已被速率补满，
子级累计占用仍可能顶满父容量），跨级借用与突发场景都不能绕过
"子级已用之和 ≤ 父级容量"。

### 核心不变量（每个操作后测试都会校验）

- `0 <= steady`，且 `steady + 未还借出 <= capacity`（剩余加借出不超过容量）；
- 任一父节点：所有直接子节点该层已用之和 **`<=` 父级容量 `capacity`**
  （题面字面约束；由"借入不得转贷 + 独立准入检查"共同保证，跨级借用和
  突发场景都不放宽）；
- 全树借出总额 == 借入总额；每笔在途贷款余额为正；
- 所有令牌变化守恒：不存在凭空产生或消失（稳态桶满溢出是标准令牌桶语义；
  突发桶一次性、用尽不恢复）。

### 借用与归还

- 借用记录：借出方、借入方、数量、逻辑时刻，ID 单调递增（`L1`、`L2`…）。
- 时钟推进时，节点新补充的令牌**优先按 FIFO 还债**，剩余才注入自己稳态桶
  （注入上限 `capacity − 未还借出`）；偿还沿借用链继续向上传播。
- 偿还顺序确定：FIFO，按借用时刻、同刻按借用 ID；支持部分偿还。

### 突发与回落

突发桶只减不增。突发用尽后，该层消耗只能依赖稳态 `rate`，从而平滑回落到
稳态速率；突发只对请求到达的目标节点生效，子孙的突发再大也要受祖先链路与
父级容量约束（祖先层不用突发为子孙流量兜底）。

### 禁用与删除

- **禁用**：立即用稳态桶余额按 FIFO 偿还上游债务，还不起的部分冻结保留；
  禁用期间不补充（启用后也不追补），本节点及其子孙的请求被拒；还款可以
  穿过禁用节点继续向上传播；其他子节点不受影响。幂等。
- **删除**：只允许删除叶子（有子节点先删子节点）。先尽力偿还，仍无法偿还
  的（令牌已被消耗）由父节点**核销**，核销明细随结果返回；不影响其他节点。
- 操作不存在的节点一律报错并在错误中携带节点标识。

### 确定性与逻辑时钟

时钟由外部注入、只能单调前进（回退报 `ClockRollbackError`）。所有遍历按
节点 ID 字典序、请求逐条串行处理——同一操作序列重复执行，判定、拒绝原因
链、状态迁移顺序完全一致。

## 2. 作为库使用

```python
from quota_kernel import QuotaKernel

k = QuotaKernel()
k.create_node("root", capacity=10, rate=1, burst_capacity=2)
k.create_node("svc-a", capacity=6, rate=1, parent_id="root", burst_capacity=2)
k.create_node("svc-b", capacity=6, rate=1, parent_id="root")

d = k.request_tokens("svc-a", 8)   # 稳态6 + 突发2，成功
d.ok                                # True
d = k.request_tokens("svc-b", 9)   # 自身6，root 只剩4 → 拒绝
d.failing_node_id                   # 'root'
d.reason_code                       # 'ancestor_insufficient'
d.to_dict()["reason_chain"]         # svc-b → root 的逐层原因

k.advance_clock(1)                  # 推进逻辑时钟，补充 + FIFO 还债
k.node_status("root")               # 可用/已借出/已借入/突发剩余 ...
k.total_used()                      # 全树已用总和与逐节点明细
k.last_rejection("svc-b")          # 最近一次拒绝的完整原因链

data = k.to_dict()                  # 导出（或 k.export_json(path)）
QuotaKernel.from_dict(data)         # 完整校验后重建；失败抛 QuotaImportError
```

## 3. JSONL 操作流 / 命令行

每行一个操作 JSON，每行输出一个结果 JSON：

```bash
python quota_kernel.py < ops.jsonl
```

支持的操作（字段名与库 API 一致，多数操作可带 `"time"` 先推进时钟）：

| op | 必需字段 | 说明 |
|---|---|---|
| `create_node` | `id, capacity, rate` | 可选 `parent_id`、`burst_capacity`、`time` |
| `delete_node` | `id` | 仅叶子，返回偿还/核销明细 |
| `disable` / `enable` | `id` | 幂等 |
| `request_tokens` | `id, amount` | `amount` 为正整数；拒绝时 `error_type="denied"` 且带 `reason_chain` |
| `advance_clock` | `time` | 单调前进 |
| `node_status` | `id` | 单节点完整状态 |
| `total_used` | — | 全树已用 |
| `query_rejection` | `id` | 最近拒绝原因链 |
| `internal_state` | — | 时钟/节点/借用记录内部视图 |
| `export` / `import` | `path`（或 import 用内嵌 `data`） | JSON 快照往返 |

结构类错误在批处理中不抛出，返回
`{"ok": false, "error_type": ..., "node_id": ..., "error": ...}`；
单行 JSON 损坏返回 `MalformedJSON` 且不影响内核状态和后续行。

## 4. 边界行为

| 边界 | 行为 |
|---|---|
| 空层级 | `root_id()` 为 `None`，`total_used=0`；第一个无根节点成为根 |
| 单节点 | 正常工作；根唯一，再建无根节点报错 |
| 容量为 0 的子节点 | 全部消耗通过向父节点借入完成 |
| 速率为 0 | 永不补充；初始仍为满桶 |
| 突发容量为 0 | 纯稳态桶，突发支付恒为 0 |
| 父级恰好耗尽 | 再申请任意数量都在对应层被拒，拒绝不落账 |
| 借用后立即归还 | 时钟推进产生的新令牌先 FIFO 还债 |
| 逻辑时钟回退 | `ClockRollbackError`，同刻推进为幂等无操作 |
| 重复/空节点标识 | `DuplicateNodeError` / `InvalidConfigError` |
| 环 / 孤儿 / 多根 | 正常 API 无法构造；导入时被明确拒绝 |
| 损坏或字段缺失的导入 | `QuotaImportError`（信息定位到具体节点/字段），**内存状态不变** |

## 5. 运行测试

```bash
python -m unittest test_quota_kernel -v
```
