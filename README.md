# optcore：离线组合优化内核

纯 Python 标准库实现的一维分组装箱与资源约束排程内核。输入任务/物品
清单，输出可行分配方案，或给出明确的不可行证明（超限分组 / 依赖环）。

## 目录结构

```
optcore/                # 内核包
  errors.py             # 异常类型（InvalidInputError / PersistenceError）
  models.py             # Item / BinSpec / Task 与三类结果（to_dict/from_dict）
  validation.py         # 输入归一化与字段级校验
  packing.py            # 分组 FFD 启发式 + 分支定界最优性验证
  scheduling.py         # 拓扑列表调度 + 资源时间线 + 关键路径 + 环检测
  solver.py             # 统一入口 solve()、Problem
  persistence.py        # JSON 快照 save/load 与结果一致性校验
main.py                 # 命令行入口（逐行 JSON 协议）
tests/                  # 125 个 unittest 用例
```

## 快速开始

```python
from optcore import solve

result = solve(
    items=[
        {"item_id": "a1", "size": 6, "group": "A"},
        {"item_id": "a2", "size": 4, "group": "A"},  # 与 a1 同箱
        {"item_id": "b1", "size": 5, "group": "B"},
    ],
    bins=[{"bin_id": "x", "capacity": 10},
          {"bin_id": "y", "capacity": 10}],
    tasks=[
        {"task_id": "t1", "duration": 3, "resource": "r"},
        {"task_id": "t2", "duration": 2, "resource": "r",
         "deps": ["t1"], "release": 5},
    ],
)
result.feasible                       # True
result.packing.used_bins              # 2（A=10 一箱，B=5 一箱）
result.packing.lower_bound            # 2 = ceil(15/10)
result.packing.optimal                # True（分支定界证明）
result.schedule.assignments           # {'t1': (0, 3), 't2': (5, 7)}
result.schedule.makespan              # 7
result.schedule.critical_path         # ['t1', 't2']
```

不可行时不抛异常，而是给出结构化证明：

```python
r = solve(items=[{"item_id": "x", "size": 11, "group": "G"}],
          bins=[{"bin_id": "b", "capacity": 10}],
          tasks=[{"task_id": "a", "duration": 1, "resource": "r", "deps": ["b"]},
                 {"task_id": "b", "duration": 1, "resource": "r", "deps": ["a"]}])
r.feasible                  # False
r.packing.infeasible_groups # ['G']
r.schedule.cycle            # ['a', 'b', 'a']
r.reasons                   # 两侧原因分别带 [packing]/[schedule] 前缀
```

装箱与排程**独立求解**：一侧不可行不影响另一侧。全部输入为空时
`feasible=True`，两侧结果均为 `None`。

## 算法说明

### 装箱（`optcore.packing`）

1. 同 `group` 物品聚合成不可拆分的组物品（尺寸为组内之和）；
2. 体积下界 `ceil(总尺寸 / 最大箱容量)`；
3. 组按尺寸降序做 first-fit-decreasing，同组绝不拆箱；
4. 若 FFD 用箱数高于下界，用 DFS 分支定界验证/改进：
   - 同负载箱、同容量空箱的对称剪枝；
   - 已开箱剩余容量体积下界与“大组（>半箱）独占”下界；
   - 展开节点超过 50 万时停止并把 `optimal` 置为 `False`。

不可行证明：组尺寸超过最大箱容量（指出组名）、总体积超过总容量、
或穷举剪枝后仍无法放置。

### 排程（`optcore.scheduling`）

1. Kahn 拓扑排序，就绪任务用堆按 **duration 降序、task_id 字典序**选取；
2. 开始时间 = `max(release, 全部 deps 完成时间)`，再在该资源的时间线
   区间列表中找最早不冲突的空隙（半开区间 `[start, end)`）；
3. 两类不可行证明，用 `ScheduleResult.infeasibility_type` 区分：

   * `"cycle"`：依赖成环，DFS 三色标记给出环上 task_id 序列
     （`cycle` 字段，首尾相同）；
   * `"window_overload"`：release/deadline/资源时间窗冲突，冲突明细在
     `window_conflicts` 字段（见下）。

4. 关键路径：拓扑序上按 duration 加权的最长*依赖*链（资源等待不计入，
   因此其长度可以小于 makespan）。

任务支持可选的 `deadline`（正整数，半开区间，任务须在该时刻前完成；
缺省为无上界，且要求 `release < deadline`）。资源可声明可用时间窗：

```python
solve(
    tasks=[{"task_id": "a", "duration": 5, "resource": "r"},
           {"task_id": "b", "duration": 5, "resource": "r", "release": 100}],
    resources=[{"resource": "r", "windows": [[0, 10]]}],
)
# feasible=False, infeasibility_type="window_overload"
```

`window_conflicts` 中每个冲突条目的字段含义：

| 字段 | 含义 |
|---|---|
| `resource` | 发生冲突的资源 id |
| `window` | `[start, end)` 半开时间窗（资源时间轴上的区间） |
| `available` | 该区间内资源的可用时长（扣除不可用段） |
| `required` | 只能在该区间内执行的任务总时长；`required > available` 即无解 |
| `tasks` | 涉及的 task_id 列表 |

判据是 Hall 型区间能量条件：对资源上每个候选区间，所有可行集合
`[最早可开始时刻 E, deadline)` 被该区间完整包含的任务都必须在此区间内
串行执行；若其总时长超过区间可用时长则任何排法都不可行。`E` 在拓扑序
上由 release 与依赖链动态规划得到。该判据是可靠的充分条件（报告即
无解，不会误报）；列表调度因固定优先级错过 deadline 时，还会运行
非抢占式精确搜索（DFS 分支定界）兜底，能重排出可行解时正常返回，
穷尽时附带叶节点阻塞窗证明。两种判定都无法覆盖且搜索超限时，结果
仍为 `feasible=False`，但 reason 会显式说明“不构成形式化不可行证明”。

## 持久化

```python
from optcore.persistence import save, load_snapshot

save("snap.json", items, bins, tasks, resources)   # 求解并落盘
snap = load_snapshot("snap.json")                  # 重建 + 全量校验
snap.problem   # Problem(items, bins, tasks, resources)
snap.result    # SolveResult
```

加载时除重新执行全部输入校验（id 唯一/非空、size 与 capacity 为正、
duration 正整数、release < deadline、deps 存在/不自依/不重复、无环、
group 非空、资源时间窗合法）外，还会校验结果与输入一致：容量不超载、
同组不拆箱、物品无遗漏、依赖先后、release/deadline、任务区间位于资源
可用窗内、资源不重叠、makespan 与关键路径合法；对 `window_overload`
不可行快照还会验证 `required > available` 等证明结构。文件损坏、JSON
非法、字段缺失一律抛 `PersistenceError` 并在信息中定位字段。

## 命令行协议

`python main.py` 从标准输入逐行读取 JSON 命令（空行忽略），每行输出
一条 JSON 结果；也可 `python main.py commands.txt` 从文件读取。

| 命令 | 字段 | 说明 |
|---|---|---|
| `pack` | `items`, `bins` | 仅装箱 |
| `schedule` | `tasks`, `resources` | 仅排程 |
| `solve` | `items`, `bins`, `tasks`, `resources` | 统一求解 |
| `save` | `path`（可附带新输入） | 写入 JSON 快照 |
| `load` | `path` | 读取快照并载入会话 |
| `dump` | — | 输出当前会话快照 |

```bash
$ echo '{"cmd":"solve","items":[{"item_id":"a","size":9,"group":"G"}],"bins":[{"bin_id":"b","capacity":5}]}' | python main.py
{"ok": true, "command": "solve", "result": {"packing": {"bins": {}, ... "feasible": false, ...}}}
```

成功响应形如 `{"ok": true, "command": ..., "result": ...}`；任何错误
（非法 JSON、字段缺失、坏快照等）都返回
`{"ok": false, "error": "...", "error_type": "..."}`，不会静默吞掉，
也不会中断后续命令。问题不可行属于正常结果（`ok: true`，`result.feasible`
为 `false`）。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

覆盖：FFD/group 合并、容量恰好装满、下界剪枝与最优性、300+ 随机实例
对拍暴力枚举、拓扑调度与资源串行、release/deadline、资源可用时间窗、
时间窗过载的不可行证明、精确搜索重排、资源/release/依赖组合场景、
依赖成环证明、save/load 往返与逐字段篡改检测、坏文件错误信息、CLI
子进程协议。
