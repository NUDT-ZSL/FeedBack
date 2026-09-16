# envcompat —— 跨环境兼容性验证汇总模块

同一批用例要在多种运行环境组合下执行。本模块把**环境矩阵、用例登记、结果上报、
环境不可用、冲突保留、双维度汇总、维度变更后的增量重算**收敛到一个可复核的结论里，
解决三类人工比对问题：

- 某个环境组合**漏跑**；
- 失败被后跑的通过结果**盖掉**；
- 环境临时不可用被**当成通过**。

纯 Python 3.8+ 标准库实现，**不接任何外部服务、无第三方依赖、可完全离线运行与单元测试**。

## 运行测试与示例（离线）

```bash
# 全部单元测试（54 个），无需联网、无需安装依赖
python -m unittest discover -s tests -v

# 端到端示例
python -X utf8 demo.py        # Windows 控制台建议加 -X utf8 以正确显示中文
```

## 快速上手

```python
from envcompat import Matrix, CompatibilityRunner

# 1) 环境维度与矩阵：os(2) × browser(2) = 4 个唯一组合
matrix = Matrix([("os", ["linux", "windows"]),
                 ("browser", ["chrome", "firefox"])])

# 2) 分组与用例（case_id 唯一，分组必须已存在）
r = CompatibilityRunner(matrix,
                        groups=["login"],
                        cases=[("login_ok", "login"), ("pay", "login")])

# 3) 上报结果（source 标识执行来源）
r.record("login_ok", ("linux", "chrome"), "pass", source="ci-1")
r.record("pay",      ("linux", "chrome"), "fail", source="ci-1", reason="断言失败")
r.record("login_ok", ("linux", "chrome"), "pass", source="ci-1")  # 幂等：忽略

# 4) 两个来源结论矛盾：双方都保留，记冲突，绝不静默择一
r.record("login_ok", ("windows", "chrome"), "fail", source="ci-1")
r.record("login_ok", ("windows", "chrome"), "pass", source="ci-2")

# 5) 环境不可用：只把该组合下未上报的用例标“未执行”，不当通过
r.mark_unavailable(("windows", "firefox"), "节点维护，无法 SSH")

# 6) 可复核结论（结构化对象 + 可读文本）
summary = r.summary()
print(summary.render_text())

# 7) 维度新增取值：增量重算，并自证与从头重算完全一致
change = r.rebuild_matrix([("os", ["linux", "windows", "mac"]),
                           ("browser", ["chrome", "firefox"])])
ok, _, _ = r.verify_equivalence()
assert ok
```

## 七条需求的设计落点

| # | 需求 | 实现位置 / 机制 |
|---|------|----------------|
| 1 | 维度取值组成唯一矩阵；非法/重复定义拒绝并指出位置 | `matrix.Matrix`、`models.Dimension`：笛卡尔积 + 长度前缀防碰撞签名；维度名重复给出 `dimensions[i]` 双位置，取值非法给出 `dimensions[i].values` 位置 |
| 2 | 用例唯一标识、所属分组、期望结果；重复 ID / 未知分组拒绝并说明 | `registry.CaseRegistry`：整批**原子**校验，错误带 `cases[i]` 位置与已知分组列表（`DuplicateCaseError` / `UnknownGroupError`） |
| 3 | 同组合同用例重复上报幂等，不覆盖已有结论 | `runner.record`：同来源同结论返回 `idempotent` 且不留痕；上报**只追加**，历史结论永不被改写 |
| 4 | 结果上报前标记环境不可用 → 未上报用例记“未执行”，不当通过 | `runner.mark_unavailable`：只填充 `PENDING` 单元格；已执行结论保留；不可用后补报直接拒绝；`NOT_RUN` 不进通过率分母 |
| 5 | 区分已执行/未执行，按用例与组合双维度给通过率与失败明细，未执行单列、不进分母 | `runner.Summary/CaseStat/ComboStat`，`report.render_summary`：通过率 = 通过/已执行；失败（含超时）、未执行、待上报（疑似漏跑）、冲突分节列出 |
| 6 | 多来源矛盾结果双方保留，生成可读冲突记录 | 单元格出现两种结论即永久 `CONFLICTED`；`models.Conflict.render()` 指出用例、组合、双方来源及各自结果与原因 |
| 7 | 维度修改/新增取值只重算受影响组合，且与从头汇总完全一致 | `runner.rebuild_matrix`：未受影响组合**同一对象**原样迁移（`fingerprint()` 可逐格比对）；事件日志 `replay_summary_from_scratch()` 全量重放，`verify_equivalence()` 自证两者逐字段相等 |

## 关键语义（容易产生歧义处的明确口径）

- **通过率分母只含“已执行”**。未执行（环境不可用）与待上报（疑似漏跑）都单列，
  不进分母，因此环境挂掉永远不会“提高通过率”。
- **只有 `pass` 计通过**。`skipped`（执行后主动跳过，带原因）计入已执行但不通过；
  `timeout` 计入已执行并归入失败明细；`fail` 为普通失败。
- **冲突计入“已执行”**，但既不算通过也不算普通失败，单独进冲突清单等待人工复核。
- **“后跑的通过”不可能盖掉“先跑的失败”**：包括同一来源自我改判。
  同来源先 `fail` 后 `pass` 也会保留两条上报并记为冲突，而不是用新值替换旧值。
- **环境不可用不是“跳过”**：它是系统在“没有任何上报”时补标的 `not_run`，
  与用例执行器主动上报的 `skipped` 严格区分。

## 代码结构

```
envcompat/
  errors.py    # 带位置信息的校验/登记异常
  models.py    # Outcome/CellState、Dimension/Combination、Group/TestCase、Report/Conflict
  matrix.py    # 维度矩阵：笛卡尔积、唯一签名、坐标解析（需求 1）
  registry.py  # 分组与用例登记：原子校验、重复/未知分组拒绝（需求 2）
  runner.py    # 状态机：登记/幂等/冲突/不可用/汇总/增量重算/事件重放（需求 3-7）
  report.py    # 纯文本可复核报告（需求 5、6）
tests/         # 覆盖七条需求的 54 个 unittest，含随机序列等价性性质测试
demo.py        # 离线端到端示例
```

## 增量重算为何能保证与全量一致

在线登记与“从头重放”共用同一组纯状态转移函数
（`_apply_record` / `_apply_unavailable` / `_migrate_grid`），不存在两套易漂移的逻辑。
`rebuild_matrix` 对保留组合直接复用原单元格对象（只新增/删除组合），再通过：

1. `fingerprint()` 断言未受影响组合逐格不变；
2. `replay_summary_from_scratch()` 在空白状态重放整条事件日志；
3. `verify_equivalence()` 比较两个 `Summary` 值对象逐字段相等；

形成可复核的等价性证据。`tests/test_rebuild.py` 另用 60 组随机事件序列
（上报 / 不可用 / 新增 / 删除 / 改名取值）持续验证该性质。
