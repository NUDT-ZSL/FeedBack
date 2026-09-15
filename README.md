# 连锁门店排班引擎

纯标准库实现（Python ≥ 3.8），完全离线运行，无需任何第三方依赖。

## 功能概览

| 需求 | 实现 |
|---|---|
| 数据维护 | `add_store / add_shift / add_employee`，班次含唯一标识、门店、起止时刻、所需技能；员工含技能集合、可用时段、工时上限 |
| 硬约束 | 技能覆盖、可用时段包含、同人班次不重叠、最短休息（默认 8h，可配）、工时上限 |
| 缺口报告 | 未覆盖班次给出逐员工原因（缺技能/不在可用时段/与已排班次重叠/休息不足/超工时上限），不影响其余班次 |
| 逻辑时钟与事件 | 可注入 `ManualClock`；`employee_leave` / `update_availability` 只解锁受影响班次局部重排，并以全量确定性重解校验，**保证与从头重排完全一致** |
| 公平性 | 在满足覆盖的前提下按字典序最小化：工时极差 → 夜班极差；`fairness_report()` 给出每员工工时、夜班数与相对均值的偏差 |
| 覆盖优先与决胜 | 目标字典序：覆盖数 > 工时极差 > 夜班极差 > 分配序列字典序（同分时按员工标识字典序打破平局），结果完全确定 |
| 查询 | `get_store_schedule` / `get_employee_schedule` / `get_shift_gap` / `fairness_report`，全部按稳定顺序返回 |
| 持久化 | `save / load / import_file`（JSON）。载入时校验标识唯一、时段合法、技能引用存在、排班无重叠且满足全部硬约束；任何错误抛出 `ValidationError` 且**失败后引擎状态不变** |

## 快速开始

```python
from datetime import datetime, timedelta
from scheduler import SchedulingEngine, ManualClock, TimeWindow

eng = SchedulingEngine(clock=ManualClock(datetime(2026, 9, 14)))
eng.add_store("st1", "一号店")
eng.add_shift("S1", "st1", datetime(2026, 9, 14, 8), datetime(2026, 9, 14, 16), ["cashier"])
eng.add_employee("E1", ["cashier"],
                 [TimeWindow(datetime(2026, 9, 14), datetime(2026, 9, 21))],
                 max_hours=40)

eng.schedule()                      # 全量排班
eng.assignments()                   # {'S1': 'E1'}
eng.get_store_schedule("st1")       # 门店班表
eng.get_employee_schedule("E1")     # 员工班次/工时/夜班
eng.fairness_report()               # 公平指标与偏差

# 员工临时请假：只重排受影响班次，结果与从头重排一致
eng.employee_leave("E1", datetime(2026, 9, 15), datetime(2026, 9, 16))

eng.save("schedule.json")           # 导出
eng2 = SchedulingEngine.load("schedule.json")  # 载入（完整校验）
```

## 求解器

`scheduler/solver.py`：确定性贪心取初解 + 带剪枝的深度优先分支限界，
按上述字典序目标求最优；节点数超过固定上限（默认 20 万）时返回当前最优解。
搜索顺序与比较规则完全确定，同一输入必然得到同一输出。

## 配置

```python
from scheduler import SchedulingEngine
from scheduler.models import Config

cfg = Config(min_rest_minutes=480,        # 最短休息
             night_start_minute=22 * 60,  # 夜班窗口 22:00
             night_end_minute=6 * 60)     #          ~ 次日 06:00
eng = SchedulingEngine(config=cfg)
```

班次与夜班窗口相交即计为夜班。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

## 目录结构

```
scheduler/
  models.py        # 门店/班次/员工/时段/配置
  solver.py        # 确定性求解器（贪心 + 分支限界）
  engine.py        # 引擎：约束、缺口分析、事件重排、查询、公平指标
  persistence.py   # JSON 导出/载入与校验
  errors.py        # ScheduleError / ValidationError / NotFoundError
tests/
  test_engine.py
  test_persistence.py
```
