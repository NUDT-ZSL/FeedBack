# 排期引擎内核（纯 Python 标准库）

离线可验收的排期引擎：资源可用区间、任务拖拽移动、同资源冲突检测、
依赖约束下的级联顺延（菱形去重、阻塞回退）、JSON 快照持久化、行式
JSON 命令行。**仅依赖 Python 3.10+ 标准库。**

## 文件

| 文件 | 说明 |
|---|---|
| `schedule.py` | 引擎内核：`ScheduleEngine`、`MoveResult`、`Conflict`、`Adjustment`、`BlockedTask` |
| `main.py` | 命令行入口：标准输入逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_schedule.py` | unittest 验收测试（45 个测试方法，覆盖全部要求场景） |

## 跑测试

```bash
python -m unittest test_schedule -v
```

## 命令行用法

每行一个 JSON 对象，输出每行一个 JSON 对象：
成功 `{"ok": true, "result": ...}`，失败 `{"ok": false, "error": "..."}`。
输入输出统一 UTF-8。

```bash
python main.py < commands.txt
```

### 命令一览

```json
{"cmd": "add_resource", "resource_id": "r1", "availability": [[0, 12], [14, 20]]}
{"cmd": "add_task", "task_id": "a", "resource_id": "r1", "start": 0, "end": 2, "priority": 0, "deps": []}
{"cmd": "move", "task_id": "a", "new_start": 5, "new_end": 7}
{"cmd": "get", "task_id": "a"}
{"cmd": "list"}
{"cmd": "list", "resource_id": "r1"}
{"cmd": "timeline", "resource_id": "r1", "start": 0, "end": 10}
{"cmd": "chain", "task_id": "a"}
{"cmd": "save", "path": "snap.json"}
{"cmd": "load", "path": "snap.json"}
{"cmd": "dump"}
```

时间均为整数逻辑时间，区间一律左闭右开 `[start, end)`；端点相接
（一个任务 `end ==` 另一个 `start`）不算冲突。

## 核心语义

### move 结果

- **校验失败抛错**（CLI 中表现为 `ok:false`）：任务不存在、
  `new_start >= new_end`、时长改变、目标区间超出资源可用窗口、
  移动后早于自身依赖结束。
- **移动本身冲突**：`success=false`，`conflicts` 列出同资源上**全部**
  冲突方及重叠区间，引擎状态不变、**不做任何联动**。
- **成功**：`success=true`，`final=[start,end]`，`adjusted` 为级联
  顺延记录，`blocked` 为顺延受阻记录。

### 级联顺延

- 约束：`task.start >= max(dep.end)`，只向后推、保持时长。
- 范围：被移动任务的所有传递下游；已经满足约束的任务不动。
- 顺序：拓扑序；同一批就绪任务按**优先级降序、task_id 字典序升序**。
- 占位规则（先到者优先）：判定任务的顺延落点时，**不**把本次联动中
  “尚未处理任务”的旧位置当作障碍——这些位置本来就要重排。因此同一资源
  上两个原本相邻的下游任务竞争同一个空位时，严格按上述顺序先处理
  （高优先级 / id 靠前）的任务先占位；后处理者的首选落点被占后进入
  下面的 blocked 回退定位。
- 菱形依赖（A→B、A→C、B+C→D）中的每个任务只处理一次，汇合点
  取所有依赖的最晚 `end`。
- 任务的首选顺延落点超出可用区间，或与**已确认任务**（外部任务、
  已顺延落位、已阻塞落位、已冻结子树）冲突时，该任务进入 blocked。

### blocked 回退定位与 unresolved

首选落点不可行的任务并不会简单地留在原位（那样其下游会读出“依赖暂时
不满足”的矛盾状态），而是立即冻结整条下游子树后做一次**回退定位**，
在所属资源的可用区间内找一个**最近**的可行落点：

1. 起点下界取 `max(原start, max(依赖end))`——必须满足全部依赖；
2. 保持任务时长不变，整体落在资源的**某个**可用窗口内；
3. 不与**已确认任务**（此时未处理任务的旧槽位仍可占用）冲突；
4. 在每个窗口内从下界起做 earliest-fit：撞上已确认障碍就把起点推到
   该障碍之后，取第一个可行的最小起点；窗口放不下就查下一个窗口。

结果在 `blocked[]` 的新字段里给出（旧字段全部保留）：

```json
{
  "task_id": "b",
  "attempted_start": 6, "attempted_end": 8,
  "reason": "conflict",
  "conflicts": [ /* 首选落点的全部冲突，左闭右开 */ ],
  "resolved": true,
  "unresolved": false,
  "resolved_start": 8, "resolved_end": 10
}
```

- **resolved（`resolved: true`）**：任务已移到 `resolved_start/end`，
  自身依赖满足、在窗口内、与当时的已确认任务不冲突；它是“顺延受阻后
  重定位”的任务，所以仍在 `blocked[]` 而非 `adjusted[]`，其下游仍
  冻结、不参与本次联动。
- **unresolved（`resolved: false`）**：遍历所有可用窗口都放不下
  （例如唯一窗口在依赖要求的起点之前结束）。此时任务**保持原位**，
  结果中以 `"resolved": false, "unresolved": true` 明确标注，
  `resolved_start/end` 为 `null`，等待用户后续拖拽消解；其下游同样
  冻结。冻结子树可能暂时违反依赖 / 与该 unresolved 任务同槽，这种
  待处理中间态会在快照中显式标注（见下），不会被静默吞掉。

#### 相邻空位竞争在极端拥挤下的残留（限制说明）

先到者优先 + 回退定位覆盖了绝大多数相邻竞争，但在**同一资源、同一批
就绪任务、且存在外部障碍**的极端拥挤时序下仍可能留下冲突：先阻塞的
任务 X 回退时占用了“尚未处理”任务 Y 的旧槽（按规则该槽可占用），
随后 Y 的上游被阻塞，Y 作为冻结任务停在原槽，已落位的 X 与冻结的 Y
回归测试 `test_extreme_crowding_frozen_task_may_overlap_earlier_relocation`
构造了这一最小情形。引擎不会假装这种状态合法：冲突双方都会被动态
标注为 `unstable`（见下），且后续任意 move 重新满足约束后标记自动
消失；要从结构上彻底消除，需要把冲突任务也作为冻结边界或引入迭代
重排，代价是更大的调度复杂度，当前版本明确选择“标注 + 可往返”而非
自动消解。

### 快照一致性校验（load）

重建时校验：task_id / resource_id 唯一且非空、依赖存在、无自依赖 /
重复依赖、依赖图无环、resource_id 存在、`start < end`、任务整体位于
资源某个可用区间内、依赖时序满足、同资源无初始冲突、资源可用区间
本身合法且互不重叠。文件不存在、JSON 损坏、字段缺失 / 类型错误均
抛出带定位信息的 `SnapshotError`，不会静默吞掉。

**unresolved 残留态（`unstable` 字段）**：正常快照的任务对象只含
固定字段（`task_id/resource_id/start/end/priority/deps`），旧快照
照常加载。若某次 move 留下了 unresolved / 冻结残留（任务暂时违反
依赖时序或与其他任务同槽），save 时相关任务会**自动、动态**地带上
`"unstable": true`；load 时把这部分校验放宽为“未标注任务之间必须
互不冲突且各自满足依赖”，使待处理中间态可保存、可往返。标记不是
手写字段：状态恢复合法后下次 save 即不再写出，且标注集合必须恰好
等于实际违规集合（测试强制）。

## 作为库使用

```python
from schedule import ScheduleEngine

engine = ScheduleEngine()
engine.add_resource("r1", [[0, 100]])
engine.add_task("a", "r1", 0, 2, priority=1)
engine.add_task("b", "r1", 2, 4, priority=0, deps=["a"])

result = engine.move("a", 5, 7)
print(result.success)                 # True
print([(x.task_id, x.new_start) for x in result.adjusted])  # [('b', 7)]
engine.save("snap.json")
restored = ScheduleEngine.load("snap.json")
```

## blocked 回退修复：前后行为对比

场景：资源 r2 上 `a→b(deps a)`，另有外部任务 `q=[6,8)`，把 `a`
从 `[0,2)` 拖到 `[4,6)`，b 的首选顺延落点 `[6,9)` 与 q 冲突。

| | 修复前 | 修复后 |
|---|---|---|
| b 的最终位置 | 留在原位 `[2,5)`，`start < a.end` | 回退定位到最近可行落点 `[8,11)` |
| 依赖一致性 | b 及下游读出的依赖约束**暂时不满足**，与 chain/timeline 自相矛盾 | b 自身满足 `start>=a.end`；下游冻结并被显式标注待处理 |
| blocked 记录 | 仅 attempted/reason/conflicts | 新增 `resolved/unresolved/resolved_start/resolved_end` |
| 无可行落点时 | 留原位，无任何区分 | `unresolved:true` 明确标注；任务在快照中带 `unstable` 标记可往返 |

相邻空位竞争场景：同资源 `a→lo(pri 1)、hi(pri 9)` 相邻排列，把 a
拖到两者都必须顺延到的同一空位。

| | 修复前 | 修复后 |
|---|---|---|
| 障碍集合 | 未处理任务的旧位置也算障碍 | 未处理任务旧位置**可占用**，先到者优先 |
| 结果 | 先处理的高优先级 hi 可能被 lo 的旧槽挡住而 blocked，低优先级任务反而占位 | hi 严格先占空位；lo 首选被占后回退定位到紧邻其后的位置，两者均满足约束、端点相接不冲突 |

外部接口未变：`move` 签名、`MoveResult` 既有字段名、CLI 十条命令、
快照既有字段全部保持兼容；blocked 对象与快照只**新增**可选字段。
