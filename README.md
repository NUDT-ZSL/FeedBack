# propverify — 离线属性验证工具

在大批量确定性生成的输入上检查声明的不变量，违反时自动收缩出最小反例。
纯 Python 标准库实现，不访问任何外部服务，可完全离线运行与验收。

## 快速开始

```bash
python -m propverify check examples/counter.json --json report.json
python -m pytest tests -q     # 34 个验收测试
```

退出码：`0` 全部通过；`1` 存在违反或冲突；`2` 配置被拒绝（原因打印到 stderr）。

## 配置格式（JSON）

```json
{
  "seed": 20260918,
  "input_count": 200,
  "objects": ["counter"],
  "objects_config": {
    "counter": {
      "fields": {
        "balance": {"type": "int", "min": -100, "max": 100, "edge_weight": 0.3},
        "tags":    {"type": "list", "element": {"type": "int", "min": 0, "max": 9},
                    "min_len": 0, "max_len": 6}
      },
      "constraints": ["balance != 0"]
    }
  },
  "invariants": [
    {"id": "余额非负", "target": "counter", "check": "balance >= 0", "when": "delta > 0"}
  ]
}
```

- 取值域类型：`int` / `float` / `bool` / `choice`（可带 `weights`）/ `string` / `list`；
- `edge_weight`：以该概率生成边界代表值（0、上下界、空串、空列表等）；
- `check` / `when` / `constraints` 是安全表达式（AST 白名单求值，支持算术、比较、
  布尔运算与 `abs/min/max/len/sum/round/sorted` 等白名单函数，以及 `true/false/null`），
  不执行任意代码，配置可安全地来自离线文件。

## 七条需求的实现位置

| # | 需求 | 实现 | 测试 |
|---|------|------|------|
| 1 | 不变量登记：唯一标识、适用对象、判定条件；重复标识 / 未登记对象拒绝并指出位置 | `registry.py`、`errors.SpecError(path, reason)` | `test_registry.py` |
| 2 | 生成配置：取值域、约束、权重；空域 / 约束互斥拒绝并说明原因 | `domains.py`、`gencfg.py`（边界代表值笛卡尔探测 + 大空间确定性采样） | `test_gencfg.py` |
| 3 | 批量生成与判定；结论与生成顺序无关 | `generator.py`：每个字段的随机源由 `SHA256(seed, 对象, 序号, 字段)` 派生；汇总按键排序 | `test_determinism.py` |
| 4 | 反例收缩：每步有依据、可复现、复验仍违反 | `shrink.py`：无随机性的贪心收缩，步骤记录 `(字段, 旧值, 新值, 依据)`，结果复验 | `test_shrink.py` |
| 5 | 约束不满足 → 跳过并说明原因，不计入通过 | `runner._judge`：约束不满足 / 前置条件为假 → `skip` + 原因 | `test_skip.py` |
| 6 | 多来源矛盾判定：双方保留 + 可读冲突记录 | `verdicts.py`：按来源存档，矛盾时生成 `ConflictRecord`，对外结论为 `conflict` | `test_conflict.py` |
| 7 | 变更后只重判受影响输入，结果与全量重跑一致 | `runner.update_invariant / update_domain / update_constraint` | `test_incremental.py` |

## 关键设计决策

**逐字段独立子种子。** 字段 `f` 在第 `i` 个输入上的取值只由
`(seed, 对象, i, f)` 决定。因此：(a) 打乱生成顺序结果不变（需求 3）；
(b) 修改某字段取值域只改变该字段的取值，其余字段逐位不变，
增量重判可以精确界定“受影响输入”（需求 7）。

**约束不满足即跳过，不做拒绝采样。** 拒绝采样会让生成结果依赖约束内容，
破坏增量重判的精确性。改为生成后判定：违反约束的输入标记 `skip` 并附原因，
不计入通过（需求 5），也让“约束互斥”能在登记时通过可满足性探测被发现（需求 2）。

**增量重判的等价性由测试保证。** `test_incremental.py` 对
不变量变更 / 取值域变更 / 约束变更分别断言：增量结果与用新配置从头
全量重跑完全一致（含收缩结果），且未受影响键的判定对象是同一实例
（`id()` 不变），即确实未被重算。

**冲突不静默择一。** 判定按 `(不变量, 对象, 输入序号)` 分来源存档；
来源间结论矛盾时双方全部保留，生成人类可读的 `ConflictRecord`，
该键对外结论为 `conflict`，并计入报告与退出码（需求 6）。

## 程序内 API 示例

```python
from propverify import Registry, GenConfig, Runner
from propverify.domains import IntDomain

reg = Registry()
reg.register_object("counter")
reg.register_invariant("余额非负", "counter", check="balance >= 0", when="delta > 0")

cfg = GenConfig(seed=42, input_count=200)
cfg.add_field("counter", "balance", IntDomain(-100, 100))
cfg.add_field("counter", "delta", IntDomain(-20, 20))

runner = Runner(reg, cfg).run()
print(runner.conclusion())

# 外部来源提交矛盾判定 → 自动保留双方并生成冲突记录
from propverify.verdicts import Verdict, FAIL
runner.submit_external("复核系统", "余额非负", "counter", 0, Verdict(FAIL, "复核判为违反"))

# 变更不变量 → 只重判该不变量
from propverify.registry import Invariant
runner.update_invariant(Invariant("余额非负", "counter", "balance >= -10"))
```

## 目录结构

```
propverify/
  errors.py      SpecError(path, reason) —— 所有拒绝都带位置
  expr.py        AST 白名单安全表达式
  domains.py     取值域：校验 / 生成 / 边界值 / 收缩候选
  registry.py    对象与不变量登记
  gencfg.py      生成配置 + 约束可满足性探测
  generator.py   逐字段独立子种子的确定性生成
  shrink.py      确定性反例收缩（步骤带依据，结果复验）
  verdicts.py    多来源判定存档与冲突记录
  runner.py      批量判定、跳过、增量重判
  report.py      文本 / JSON 报告
  loader.py      JSON 配置加载
  __main__.py    CLI：python -m propverify check CONFIG.json
tests/           34 个验收测试，按七条需求组织
examples/        示例配置
```
