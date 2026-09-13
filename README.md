# 排期引擎内核（纯 Python 标准库）

离线可验收的排期引擎：资源可用区间、任务拖拽移动、同资源冲突检测、
依赖约束下的级联顺延（菱形去重、阻塞回退）、JSON 快照持久化、行式
JSON 命令行。**仅依赖 Python 3.10+ 标准库。**

## 文件

| 文件 | 说明 |
|---|---|
| `schedule.py` | 引擎内核：`ScheduleEngine`、`MoveResult`、`Conflict`、`Adjustment`、`BlockedTask` |
| `main.py` | 命令行入口：标准输入逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_schedule.py` | unittest 验收测试（37 个测试方法，覆盖全部要求场景） |

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
- 菱形依赖（A→B、A→C、B+C→D）中的每个任务只处理一次，汇合点
  取所有依赖的最晚 `end`。
- 顺延落点超出资源可用区间、或与任何任务（含已顺延任务和未处理
  任务的真实位置）冲突时：该任务**回退原位**并记入 `blocked`
  （含尝试落点、原因 `conflict` / `out_of_availability`、冲突明细），
  它及其下游不参与本次联动；兄弟分支不受影响。

### 快照一致性校验（load）

重建时校验：task_id / resource_id 唯一且非空、依赖存在、无自依赖 /
重复依赖、依赖图无环、resource_id 存在、`start < end`、任务整体位于
资源某个可用区间内、依赖时序满足、同资源无初始冲突、资源可用区间
本身合法且互不重叠。文件不存在、JSON 损坏、字段缺失 / 类型错误均
抛出带定位信息的 `SnapshotError`，不会静默吞掉。

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
