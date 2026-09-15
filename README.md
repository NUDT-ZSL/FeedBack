# 离线复习调度模块（review_scheduler）

一套**只依赖 Python 标准库**、可完全离线运行的间隔重复（spaced-repetition）调度器：
学员每天复习若干内容，系统根据每次回忆质量自动调整下一次出现时机——
回忆顺利则拉长间隔，回忆失败则显著缩短。无需任何第三方包，`unittest` 直接可测。

## 环境要求

- Python 3.9+（仅标准库：`dataclasses`、`json`、`math`、`os`、`tempfile`、`typing`）

## 目录结构

```
review_scheduler/
├── __init__.py
└── scheduler.py        # 全部实现：状态、更新公式、时钟、排课、持久化
tests/
├── __init__.py
└── test_scheduler.py   # 52 个单元测试，按需求 1~8 分组
```

## 快速上手

```python
from review_scheduler import Scheduler, ManualClock

clock = ManualClock(0)                 # 可注入的逻辑时钟（单位：天）
s = Scheduler(clock=clock, daily_limit=20)

s.add_item("item-1", "数学", stability=1.0, difficulty=3.0)

# 登记复习：quality 为 0~5 的整数，>=3 顺利，<3 失败
r = s.review("item-1", quality=5)
print(r.scheduled_interval)           # 下次间隔（天）
print(r.stability_after, r.difficulty_after)

clock.advance(r.scheduled_interval)   # 逻辑时钟走到到期日
print(s.due_items())                  # ['item-1']，按紧迫度稳定排序

plan = s.plan_day()                   # 超过 daily_limit 时只留最紧迫的，其余顺延
for d in plan.deferred:
    print(d.item_id, d.reason, d.old_due, "->", d.new_due)

s.save("state.json")                  # 单文件原子存档
s2 = Scheduler.load("state.json")     # 完整重建（含逻辑时钟）
```

## 核心 API

| API | 说明 |
| --- | --- |
| `add_item(item_id, topic, stability, difficulty)` / `add_items([...])` | 维护学习内容；稳定度、难度必须为正，错误信息带定位（如 `items[2].difficulty`） |
| `review(item_id, quality, timestamp=None)` | 登记一次复习（质量 0–5），返回含时刻、实际间隔、更新前后状态的记录 |
| `due_items(now=None)` | 当前到期集合，纯查询，按 `(到期时刻, id)` 稳定排序 |
| `plan_day(day=None, limit=None)` | 当日安排；超上限只保留最紧迫内容，其余顺延一天并记录原因 |
| `status(item_id)` | 稳定度、难度、到期时刻、通过/失败次数 |
| `history(item_id)` / `interval_changes(item_id)` | 历史复习轨迹与逐次间隔变化 |
| `topic_stats(topic, now=None)` | 某主题到期内容数与平均间隔 |
| `save(path)` / `Scheduler.load(path)` / `to_dict()` / `from_dict()` | 单文件持久化 |

异常：`ValidationError`（输入非法，信息指出字段位置）、`PersistenceError`
（存档损坏/缺字段/版本不符，信息指出位置如 `records[0].quality`）。

## 设计要点（逐条对应需求）

1. **内容与记忆状态**：`Item` 含唯一 id、主题、记忆状态；稳定度、难度在加入与载入时
   都做正数/有限值/类型校验，`bool` 不会被当作数字。批量加入先整体校验后写入。
2. **复习记录与幂等**：每条记录保存质量、时刻、距上次的实际间隔 `elapsed`、复习后新间隔。
   同一内容在**同一时刻**重复提交直接返回已有记录，状态不变（幂等）；质量超出 0–5
   立即拒绝并说明；时钟不允许倒退。
3. **可复现的更新公式**（无任何随机量，相同输入序列必得相同结果）：

   - 顺利（q∈{3,4,5}）：`S' = min(S_max, S·(1 + f_q·min(1, √(3/D))))`，
     `f_q = {3:0.15, 4:0.25, 5:0.35}`
   - 失败（q<3）：`S' = max(S_min, 0.5·S)`
   - 难度向 3 回归并夹紧到 `[1.05, 5.0]`：`D' = clamp(D + 0.15·(3−q))`
4. **间隔拉长、上限与失败回落**：间隔由新稳定度导出（四舍五入取整）。顺利时保证
   逐次**严格拉长**（至少 +1 天），上限 `MAX_INTERVAL_DAYS = 365`；一次失败稳定度
   直接减半、间隔随之回落约 50%，严格大于任何一次顺利回忆的最大增幅（35%）。
5. **逻辑时钟与稳定排序**：时钟可注入（`ManualClock`），`due_items` 只做纯查询，
   排序键 `(due, item_id)` 保证同一时刻重复查询结果逐字节一致。
6. **日上限顺延**：`plan_day` 按紧迫度截断，未入选项 `due` 移到次日并追加
   `Deferral(item_id, day, old_due, new_due, "daily_limit_exceeded")`；
   顺延**只移动到期时刻**，稳定度、难度、次数、历史全部不变（有测试锁定）。
   顺延目标为 `max(day+1, clock.now()+1)`，因此即便用历史日期排课，顺延项也
   不会在当前再次冒充到期；顺延之后 `due_items()` 与 `topic_stats()` 严格一致。
7. **可查询性**：任意内容的状态、下次到期时刻、完整轨迹、逐次间隔变化；
   主题维度的到期数与平均间隔——两者都以**当前生效到期时刻 `due`** 为准
   （到期数 = `due <= now` 的条数；平均间隔 = 各已复习内容
   `due − last_reviewed` 的均值），因此与 `due_items()` 的应复习集合
   严格一致，顺延后按新到期时刻统计。
8. **单文件持久化**：JSON 存档包含内容、状态、复习记录、逻辑时钟、配置与顺延记录；
   保存用“临时文件 + `os.replace`”原子写入；载入走 `from_dict` 先完整构建新对象、
   全部字段校验通过才返回——损坏或缺字段时报错并带位置（如 `items[0].stability`），
   失败不会产生半成品，调用方现有状态不变。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

预期：`Ran 52 tests ... OK`。测试不联网、不写工作目录（存档用临时目录）。
