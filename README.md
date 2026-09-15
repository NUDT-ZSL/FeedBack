# 离线决策台账（Decision Ledger）

把个人复盘里反复回看的决策组织成**可追溯、可修正、可回看**的台账：
每条决策有唯一标识与状态机，决策前挂**依据**，决策后登记**结果**
（允许迟到很久回填），系统基于双方证据**推导结论并记录每次变化**，
结果与依据矛盾时**双方保留并生成冲突记录**，成形结论可固化为**经验**
供后续决策引用。

- 纯 Python 3.8+ 标准库实现，**零第三方依赖、完全离线**。
- 台账整体保存为单个 UTF-8 JSON 文件（原子写入），可直接用 Git 管理。
- 提供 Python API、中文命令行（CLI）、45 项验收测试和一个带自检的剧情演示。

## 快速开始

```bash
# 1) 验收测试（36 项，应全部 OK）
python -m unittest discover -s tests -v

# 2) 端到端剧情演示（含断言自检，结束后生成 demo_ledger.json）
python demo.py

# 3) 命令行实操
python -m decision_ledger --file my.json add-decision --topic "是否跳槽"
python -m decision_ledger --file my.json add-basis D-0001 \
    --source "offer 邮件" --weight 3 --stance supports --content "涨薪 40%"
python -m decision_ledger --file my.json choose D-0001 --option "跳槽"
# 结果可以晚很久才登记，--at 是结果实际发生时刻；--basis 可给多个
python -m decision_ledger --file my.json outcome D-0001 \
    --basis D-0001.B01 D-0001.B02 \
    --value "试用期通过" --stance supports \
    --weight 4 --source "直属主管" --at 2026-12-01T18:00:00 \
    --id OBS-2026-12-01     # 可选：客户端结果标识，同标识重提按幂等处理
python -m decision_ledger --file my.json show D-0001
python -m decision_ledger --file my.json trajectory D-0001
python -m decision_ledger --file my.json chain D-0001
python -m decision_ledger --file my.json conflicts D-0001
python -m decision_ledger --file my.json doctor          # 引用完整性体检
python -m decision_ledger --file my.json lesson D-0001 --title "经验标题" --content "经验正文"
python -m decision_ledger --file my.json cite D-0002 --lesson L-0001
python -m decision_ledger --file my.json lesson-refs L-0001
```

所有被拒绝的操作（非法流转、缺来源、权重非正、标识重复、引用不存在的
经验等）都会打印 `操作被拒绝：…` 说明原因并以退出码 1 结束，不会落盘。

## 核心概念

| 概念 | 说明 |
|---|---|
| 决策 Decision | 唯一标识 `D-0001`、主题、发生时刻；状态在 **待定 → 已选择 → 已复盘** 间单向流转 |
| 依据 Evidence(basis) | 待定阶段录入；同一决策内标识唯一（默认 `D-0001.B01`）；来源必填，权重必须为正；立场 supports/contradicts |
| 结果 Outcome | 决策作出后登记，带发生时刻、观测值、可信度和**对应的依据标识（可多条）**；可在已选择/已复盘阶段随时回填（含迟到结果）；支持客户端结果标识，**同标识重复提交按幂等处理** |
| 结论版本 ConclusionEntry | v0=待定；作出选择时基于依据形成初判；此后每登记一条结果重算，**仅在结论翻转时追加新版本** |
| 冲突 ConflictRecord | 结果与任何立场对立的既有依据逐对生成；旧依据原样保留，绝不静默覆盖 |
| 经验 Lesson | 由某次结论 + 获胜侧的依据/结果固化而成（`L-0001`），可被后续决策引用，反向引用链可查 |

### 结论推导规则（确定性、可解释）

```
支持分 = Σ 立场=supports 的证据权重   （依据与回填结果都参与）
反对分 = Σ 立场=contradicts 的证据权重
支持分 > 反对分 → 结论「成立」
反对分 > 支持分 → 结论「不成立」
双方相等/均为 0 → 结论「待定」
```

每个结论版本留存：版本号、结论、双方总分、触发它的结果（初判版为空）、
当时的证据链快照、可读备注。权重微调但结论不变不会污染轨迹。

### 稳定顺序约定

- 决策、经验、冲突列表：按标识升序；
- 推导依据链：先依据（标识升序），再结果（**发生时刻升序**，时刻相同按标识）；
- 结论轨迹：版本号升序；
- 经验被引用列表：决策标识升序。

`reasoning_chain(decision_id, version=n)` 可还原任意历史版本的证据快照，
晚于该版本到达的结果会标记为 `in_version_snapshot=False`。

## 需求与实现/验收对照

| # | 需求 | 实现位置 | 验收测试 |
|---|---|---|---|
| 1 | 决策条目、唯一标识/主题/时刻、三态流转、非法拒绝并说明 | `models.transition_state`、`engine.create_decision/mark_chosen/mark_reviewed` | `Requirement1DecisionStateTests`（含越级、回退、终态、重复流转、原因文案断言） |
| 2 | 多条依据、同决策内标识唯一、权重非正/来源缺失拒绝并指出位置 | `engine.add_basis` | `Requirement2BasisValidationTests` |
| 3 | 结果带时刻/观测值/对应依据，迟到结果回填到对应决策 | `engine.record_outcome`（已选择/已复盘均可，按 `decision_id` 回填，`Outcome.basis_id` 强校验） | `Requirement3OutcomeBackfillTests`（复盘后近一年的迟到结果回填） |
| 4 | 基于依据+结果推导结论，每次变化记录触发结果与前后结论 | `engine._recompute_conclusion`、`ConclusionEntry` | `Requirement4ConclusionEvolutionTests`（待定→成立→不成立、平局、双向翻转、不变不增版本） |
| 5 | 结果与依据矛盾时双方保留 + 可读冲突记录 | `engine._detect_conflicts`、`ConflictRecord` | `Requirement5ConflictTests`（逐条点名对立依据、不翻转也记录、旧依据原文仍在） |
| 6 | 经验由结论+支撑依据/结果固化，可被引用；引用不存在即拒绝 | `engine.crystallize_lesson/cite_lesson`、`Lesson` | `Requirement6LessonTests` |
| 7 | 当前结论、推导链、变化轨迹、经验反向引用，稳定顺序 | `current_conclusion/reasoning_chain/conclusion_trajectory/lesson_references` | `Requirement7QueryStabilityTests` |
| — | 离线可验收、可持久化 | `store.save/load`（JSON + 原子替换） | `PersistenceTests`、`CliSmokeTests`、`demo.py` 内置断言 |

## 目录结构

```
decision_ledger/
  errors.py    # 异常体系（中文可读消息）
  models.py    # Decision / Evidence / Outcome / ConclusionEntry / ConflictRecord / Lesson + 状态机
  engine.py    # Ledger：校验、流转、回填、推导、冲突、固化、引用、查询
  store.py     # JSON 原子落盘 / 加载
  cli.py       # 中文命令行（python -m decision_ledger ...）
tests/
  test_ledger.py   # 36 项 unittest 验收测试
demo.py            # 端到端剧情 + 自检（创业公司 offer：初判成立 → 矛盾保留 → 迟到坏消息翻转 → 固化经验 → 新决策引用）
```

## Python API 速览

```python
from decision_ledger import Ledger, store

lg = Ledger()
d = lg.create_decision("是否加入创业公司", created_at="2026-01-20T09:00:00")
b = lg.add_basis(d.decision_id, "offer 说明会", 4, "supports", "期权承诺")
lg.mark_chosen(d.decision_id, "加入", chosen_at="2026-02-01T10:00:00")

# 返回三元组：(结果, 新冲突列表, 新结论版本或 None)
# basis_ids 可给多条（立场混合也允许）；outcome_id 为客户端稳定标识
outcome, conflicts, new_version = lg.record_outcome(
    d.decision_id, basis_ids=[b.evidence_id, b2.evidence_id],
    observed_value="融资砍半，期权缩水", stance="contradicts", weight=5,
    source="公司全员信", occurred_at="2026-09-20T19:00:00",
    outcome_id="OBS-2026-09-20")

# 同一 outcome_id + 相同载荷再次提交 → 幂等回放，不新增证据/冲突/轨迹版本；
# 载荷不一致则拒绝，防止覆盖已确认结果
lg.record_outcome(
    d.decision_id, basis_ids=[b.evidence_id, b2.evidence_id],
    outcome_id="OBS-2026-09-20",
    observed_value="融资砍半，期权缩水", stance="contradicts", weight=5,
    source="公司全员信", occurred_at="2026-09-20T19:00:00")

lg.current_conclusion(d.decision_id)     # 当前结论版本
lg.conclusion_trajectory(d.decision_id)  # 变化轨迹（触发结果+前后结论）
lg.reasoning_chain(d.decision_id)        # 推导依据链（稳定顺序+贡献分值）
lg.list_conflicts(d.decision_id)         # 可读冲突记录

lesson = lg.crystallize_lesson(d.decision_id, "口头期权按零计入", "……")
lg.cite_lesson("D-0002", lesson.lesson_id)
lg.lesson_references(lesson.lesson_id)   # {'cited_by': ['D-0002', ...]}

store.save(lg, "my.json")                # 原子落盘
lg = store.load("my.json")               # 重新加载
```

所有业务错误都是 `decision_ledger.errors.LedgerError` 的子类
（`ValidationError` / `StateFlowError` / `NotFoundError` / `ConflictError`），
消息为中文，直接面向使用者说明拒绝原因与位置。

## 设计取舍说明

- **结果也是证据**：登记结果时物化成一条 `kind=result` 的证据参与推导，
  与 Outcome 一一对应（`evidence.outcome_id` / `outcome.evidence_id` 双向可追溯）。
- **只在结论翻转时留版本**：避免同向结果刷屏；每次重算的双方总分在需要时
  可由依据链重算，历史版本的快照也完整保留当时的证据集合。
- **冲突是对称检测**：结果与任何立场对立的依据都成对记录（包括结果直接
  对应的那条依据，会特别标注）；矛盾不阻断录入、不删除任何一方。
- **经验固化取获胜侧**：固化当前结论时，纳入当下全部同向依据/结果；
  显式固化某个历史版本时严格限定在该版本快照内。
- **时刻与登记时间分离**：结果的 `occurred_at` 是事情实际发生时刻
  （决定依据链排序），结论版本的 `changed_at` 是它进入台账的时刻，
  因此迟到回填不会重写历史。
- **结果登记的三条收紧规则**：
  1. 引用的依据必须全部真实存在——任一缺失就整体拒绝，错误信息逐个列出
     缺失标识，且在任何写入之前完成校验，不留结果/证据/冲突半成品；
  2. 冲突记录只从真实依据对象生成，结果证据、结果、依据三方均可解析，
     `Ledger.referential_integrity()`（CLI `doctor`）可随时体检；
  3. 客户端结果标识用于幂等：同标识同载荷重放返回首次记录、不动结论与
     轨迹；同标识不同载荷直接拒绝。系统自动分配的 `O-xxxx` 也会避开
     已被客户端占用的标识。导出结构中 `basis_id`（主依据）与 `basis_ids`
     并存，旧导出文件可直接加载。
