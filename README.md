# 小队战术 AI 规划系统

玩家在网格地图上指挥一支 4 人小队执行任务。系统为每个角色生成候选行动计划，
按目标优先级 / 资源消耗 / 风险评分选优，环境变化时自动重规划，动作失败时
自动启用备选计划，用户可随时手动干预。

## 运行

```bash
python server.py 8000
# 浏览器打开 http://127.0.0.1:8000
```

仅依赖 Python 3 标准库，无需安装任何第三方包。

## 测试

```bash
python -m unittest discover -s tests
```

## 需求对应

| 需求 | 实现 |
| --- | --- |
| 1. 生成多种候选计划 | `engine/planner.py` `generate_candidates`：攻击/移动攻击/治疗/推进/掩体警戒/撤退，每个计划含动作序列与预期结果 |
| 2. 选优并给出理由 | `_finish` 按目标价值、AP 消耗、风险加权评分，`reason` 字段记录人类可读理由 |
| 3. 环境变化重规划 | `engine/game.py` `apply_event` / `_replan_after_change`：障碍出现、敌人移动后逐单位校验原计划，仍有效则保持（行为连贯），否则生成新计划 |
| 4. 界面查看计划 | 右侧面板展示当前计划、候选计划评分对比表，日志区显示重规划触发原因 |
| 5. 失败恢复 | `_exec_plan` 动作失败时记录原因到日志与计划状态，`_fallback` 自动启用下一个可行候选，无备选时原地待命避免卡死 |
| 6. 实时状态与手动干预 | 前端每 2 秒轮询刷新；点击候选计划的"采用"按钮立即切换计划，可取消当前计划 |

## 结构

```
engine/models.py       地图、角色、技能、动作、计划数据模型
engine/pathfinding.py  A* 寻路、可达域、视线判定
engine/planner.py      候选计划生成与评分
engine/game.py         回合执行、重规划、失败恢复、手动干预
server.py              HTTP API + 静态文件服务
static/                网格地图界面（Canvas）
tests/test_engine.py   8 项核心逻辑测试
```

