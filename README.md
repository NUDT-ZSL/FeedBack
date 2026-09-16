# 结算求解与解释引擎（离线可验收）

回答一笔订单在多张优惠券叠加下**最优怎么用、为什么这么用**的纯 Python 模块。
零第三方依赖，仅需 Python 3.10+（标准库）。

## 一分钟上手

```python
from settlement import SettlementEngine, CouponSpec, OrderLine, explain, dump_snapshot

eng = SettlementEngine()
eng.register_category("food", "食品")
eng.set_order([OrderLine.build("L1", "food", "60.00", 2)])

# 金额入参用“元”（int/float/str/Decimal），内部一律整数“分”
eng.add_coupon(CouponSpec.build("C1", threshold="50.00", discount="20.00",
                                applicable_categories=["food"],
                                exclusive_group="FOOD", priority=1))

result = eng.solve()
print(result.selected_ids(), result.total_discount_cents)   # ('C1',) 2000
print(explain(eng, result).render())                         # 中文解释
dump_snapshot(eng, "snapshot.json")                          # 持久化
```

运行端到端验收演示（覆盖需求 1–8，并生成 `out/settlement_snapshot.json`）：

```
python demo.py
```

运行全部测试（含 180 组随机实例与独立暴力枚举的逐项对照）：

```
python -m unittest discover -s tests -v
```

## 需求对照

| # | 需求 | 实现位置 |
|---|------|----------|
| 1 | 券维护：唯一标识、适用品类、门槛、额度、互斥组、优先级；门槛/额度必须为正，非法拒绝并指出位置 | `models.CouponSpec.build`、`money.to_cents`、`errors.ValidationError.path` |
| 2 | 订单行维护：唯一标识、品类、单价、数量；数量为正、品类须已登记 | `models.OrderLine.build`、`SettlementEngine.set_order/add_line` |
| 3 | 整体可行：互斥组至多一张、券只能用满足门槛与品类的行、行不得重复抵扣 | `solver._solve_component_exact`（位掩码 DFS + 互斥组位） |
| 4 | 总优惠最大；平局按券标识字典序；重复求解逐字节一致 | `solver.better`、`fingerprint`、随机种子固定的对照测试 |
| 5 | 同券多来源参数矛盾：双方全保留、可读冲突记录、不静默择一 | `SettlementEngine.issue_coupon/_assemble_coupon`、`ConflictRecord.render` |
| 6 | 解释：逐张命中行/抵扣额/门槛，以及每张未选券的落选原因 | `explain.explain/render_text`、反事实求解 `solve_component(force_include=...)` |
| 7 | 新增/撤销只重算受影响分量，结果与从头重解一致，未受影响抵扣不变 | `solver._components` 分解 + 按分量签名缓存；`ChangeReport`（含对象身份复用） |
| 8 | 整文件存取，载入严格校验，损坏/字段缺失清晰报错且**失败后状态不变** | `persistence.dump_snapshot/load_snapshot/load_into` |

## 核心语义（精确、可验收）

1. **金额**：内部全部使用整数分。入参金额最多两位小数（`"10.001"` 会被拒绝，不做静默四舍五入），
   必须为正、必须有限。
2. **券对行的命中**：券只能作用于适用品类的商品行；`applicable_categories` 为空表示全品类。
3. **门槛与占有**：一张中选券必须**整行占有**若干命中行，被占行商品额之和达到门槛；
   券实际抵扣 `min(额度, 被占行总额)`。一行在整个方案中至多被一张券占有（不重复抵扣）。
4. **互斥组**：同一 `exclusive_group` 在整单中至多中选一张（即使两券行不相交）。
5. **优化目标**：总抵扣额最大；并列时取“中选券标识排序元组”字典序更小者；
   再并列（同券集、不同占行）时按模块固定的行序裁决。全程无浮点、无集合迭代序依赖。
6. **逐行抵扣分摊**：一张券的抵扣额按被占行商品额比例，用**最大余数法**分摊
   （余数大者先补 1 分，并列按行标识），每行分摊不超过该行商品额。
7. **冲突**：同一 `coupon_id` 可被多个来源（`source`）发放：
   - 参数完全一致 → 正常（状态 `single`）；
   - 参数矛盾 → 生成 `ConflictRecord`（列出券、每个来源、版次与各自参数），该券**冻结**不参与求解；
   - `resolve_conflict(coupon_id, source)` 人工裁决后以指定来源参数为准，**双方记录仍保留**。
   同一来源用更大 `version` 更新参数；更旧版次回退、同版次改参数都会被拒绝。
8. **增量**：券按“同互斥组或命中行相交”连成连通分量，分量间券/行互不相交，
   以分量输入的 SHA-256 签名为缓存键。新增/撤销一张券只会重算签名变化的分量；
   未受影响分量的 `Application` 对象原样复用。`solve_from_scratch()` 清缓存重解，
   测试强制要求两者指纹与逐行方案完全一致。

## 未选券的解释原因码

| 原因码 | 含义 |
|--------|------|
| `threshold_not_met` | 即使独占全部适用行，行额仍低于门槛，当前订单上永远不可用 |
| `frozen_conflict` | 多来源参数矛盾已冻结（附双方来源），需人工裁决 |
| `dominated` | 强制使用它会得到更小的总优惠（给出反事实最优与差额、竞争的中选券） |
| `tie_lexicographic` | 强制使用总优惠相同，按券标识字典序落败（给出两个中选集合） |

反事实求解只用于**解释**，结果不回写方案，因此解释与求解结果必然一致。

## 持久化格式

单个 UTF-8 JSON 文件（`format_version: 1`），顶层包含
`categories / lines / coupons(含 issues 与 conflict) / conflict_seq / result`。

- **写入原子**：同目录临时文件 + `fsync` + `os.replace`，崩溃不会留下半截文件；
  键排序、固定缩进使同一状态写出的字节逐字节相同。
- **载入严格**：字段缺失/类型错误/标识重复/门槛非正/品类悬空/状态与冲突记录不自洽，
  一律抛 `SnapshotFormatError`，错误信息带 JSON 路径（如 `coupons[0].issues[1].spec.threshold_cents`）。
- **结果复核**：若带求解结果，载入时重新求解并复核订单指纹、券面指纹、
  逐行抵扣与结果指纹；任何篡改（含照抄旧指纹）都会被识别。
- **失败原子性**：`load_into(existing_engine, path)` 先在临时引擎上完成全部校验，
  通过后才整体替换状态；失败时原引擎逐字段不变。

## 目录结构

```
settlement/
  errors.py       异常与位置（path）渲染
  money.py        元→分的严格转换与格式化
  models.py       领域模型与构造期校验
  fingerprint.py  确定性 SHA-256 指纹
  solver.py       连通分量分解 + 位掩码精确求解 + 最大余数法分摊
  engine.py       状态维护、多来源冲突、分量缓存增量重算
  explain.py      结构化解释与中文文本
  persistence.py  JSON 快照原子写入 / 严格载入与指纹复核
tests/            unittest：校验、暴力枚举对照(180例)、冲突、增量、解释、快照
demo.py           需求 1–8 端到端演示
```

## 规模与边界

连通分量规模保护：单分量超过 20 张券或 22 行时抛 `SolveLimitError`（明确报错而非悄悄变慢）。
典型订单（券、行均为个位到十位数）的求解与反事实解释均为毫秒级。
