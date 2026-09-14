# 结果流内核（Result Stream Kernel）

浏览器端查询结果面板的结果流内核：接收后端分批推送的结果，维护多个查询计划
各自的可见结果序列，在计划频繁切换、批次乱序交错到达的情况下保证展示顺序
稳定、不串数据。

- 纯 Python 标准库，零第三方依赖，完全离线运行（Python ≥ 3.9）。
- 公开 API 全部带类型注解与 docstring。
- 单元测试基于 `unittest`，可重复执行。

## 文件

| 文件 | 说明 |
| --- | --- |
| `result_stream_kernel.py` | 内核实现（数据类型、计划、内核、JSON 导入导出、操作分发） |
| `test_result_stream_kernel.py` | 39 个 unittest 用例 |
| `README.md` | 本文档 |

运行测试：

```bash
python -m unittest test_result_stream_kernel -v
```

## 核心概念

- **查询计划 `QueryPlan`**：全局唯一 `plan_id`、非空查询条件描述、状态
  （`running` / `completed` / `cancelled` / `failed`）和一份可见结果序列。
- **结果项 `ResultItem`**：全局唯一 `item_id`、排序键 `sort_key`、
  可 JSON 序列化的 `payload`。
- **批次 `receive_batch`**：后端一次推送的一组结果项，可乱序、可含重复。
- **当前计划**：任意时刻至多一个；`current_plan_id` 唯一。

## 确定性规则（验收依据）

### 1. 稳定排序

可见序列按 `(sort_key, item_id)` 升序排列；排序键相同时按 `item_id` 的
字典序打破平局。因此**任意到达顺序下最终顺序一致**。

排序键只接受 `int` / `float` / `str`：

- `bool` 非法（虽是 `int` 子类，但会污染数值排序）；
- 浮点数必须为有限值（`nan` / `inf` 会破坏全序）；
- 同一计划内排序键种类（数值 / 文本）必须一致，否则整个批次被拒绝
  （空计划收到种类不一致的批次同样被拒绝）。

### 2. 去重保留规则：先到达者胜出

同一计划内按 `item_id` 去重。按**批次到达顺序**、批次内按**列表顺序**，
第一次出现的版本被保留；之后出现的同标识结果项被丢弃并计入
`duplicates_dropped`。该规则只依赖到达顺序，与批次如何切分无关，因此
同一到达顺序重放必然得到同一结果。

### 3. 批次接收与迟到批次

| 计划状态 | 是否接收批次 |
| --- | --- |
| `running` | ✅ 接收 |
| `completed` | ✅ 接收（完成只表示后端推完，不禁止补发） |
| `cancelled` | ❌ 拒绝，抛 `BatchRejectedError` |
| `failed` | ❌ 拒绝，抛 `BatchRejectedError` |

- 批次声明的计划未注册：抛 `UnknownPlanError`，**绝不静默丢弃或自动创建计划**。
- 被拒绝的批次不改变任何计划的可见序列与统计。
- **批次原子性**：批次内任一结果项非法，整个批次被拒绝，计划状态不变。
- 空批次合法：批次数加一，可见序列不变。

### 4. 计划隔离

结果项只归属于接收它的计划。不同计划即使 `item_id` 相同，也各自独立
计数、独立去重、独立保存 payload，互不污染；非当前计划的批次永远不会
出现在当前计划的可见序列里。

### 5. 当前计划切换与取消

- `switch_current_plan` 把目标计划标记为当前计划，旧计划自动变为非当前
  （数据保留、可继续收批次）；重复切换同一计划是幂等 no-op。
- `cancel_plan` 幂等：重复取消同一计划无副作用；取消不存在的计划抛
  `UnknownPlanError`。
- 取消当前计划不会自动清除 `current_plan_id`（面板可继续展示已取消计划
  的既有结果，只是不再接收新批次）。
- 切换到不存在的计划抛 `UnknownPlanError`，当前计划标识不变。

### 6. 导出 / 导入

`export_to_file` 把全部计划、可见结果序列、批次记录、当前计划标识和
去重统计写成 JSON（格式版本 `version: 1`）。`import_from_file` /
`from_dict` 载入时校验：

- 计划标识全局唯一；
- 结果项标识在计划内唯一；
- 排序键类型合法（且计划内种类一致）；
- 状态取值合法；
- 批次记录引用的计划存在，且 `added + duplicates == received`；
- `current_plan_id` 为 `null` 或指向已注册计划；
- 所有必填字段存在、计数为非负整数。

任何校验失败都抛 `ImportValidationError`（错误信息定位到具体计划 /
结果项 / 字段），且**内存状态保持不变**——先在新对象上完成全部校验，
成功后才替换。JSON 解析失败、文件不存在同样抛 `ImportValidationError`。

## API 速览

```python
from result_stream_kernel import ResultStreamKernel, ResultItem

kernel = ResultStreamKernel()
kernel.register_plan("p1", "筛选: 状态码 200")
kernel.switch_current_plan("p1")
report = kernel.receive_batch("p1", [
    {"item_id": "a", "sort_key": 1, "payload": {"v": 1}},
    {"item_id": "b", "sort_key": 2},
])
kernel.get_plan_results("p1")   # 稳定排序的可见序列
kernel.get_current_results()    # 当前计划的可见序列
kernel.locate_item("a")         # ["p1"]
kernel.plan_stats("p1")         # 批次数 / 去重数 / 可见项数 / 状态
kernel.export_to_file("state.json")
kernel.import_from_file("state.json")
```

### 逐条操作请求 `apply_operation`

`apply_operation({"op": ...})` 支持：`register_plan`、`receive_batch`、
`switch_plan`、`cancel_plan`、`complete_plan`、`fail_plan`、
`get_plan_results`、`get_current_plan`、`get_current_results`、
`locate_item`、`plan_stats`、`export`、`import`、`snapshot`。
未知操作抛 `UnknownOperationError`；各操作的校验错误信息均包含具体的
计划标识或结果项标识。

## 异常体系

```
KernelError
├── UnknownPlanError        引用了未注册的计划标识
├── DuplicatePlanError      计划标识重复注册
├── InvalidPlanError        计划参数非法 / 非法状态迁移
├── BatchRejectedError      迟到批次（计划已取消 / 已失败）
├── InvalidItemError        结果项非法（空标识、非法排序键、批次原子性拒绝）
├── ImportValidationError   导入数据损坏或校验失败（内存状态不变）
└── UnknownOperationError   未知操作类型
```

## 测试覆盖

`test_result_stream_kernel.py` 共 39 个用例，覆盖：批次合并与去重
（含“先到达者胜出”）、任意到达顺序下的稳定排序、排序键平局打破、
计划隔离（同标识独立计数、非当前计划不串数据）、迟到批次拒绝、
未知计划拒绝、当前计划切换幂等、取消幂等、空系统 / 空批次 / 全重复
批次等边界、导出导入往返（含逐字节一致）、12 类损坏导入文件的状态
不变性、操作分发，以及多计划交错到达顺序与串行参考结果一致的验收
场景（30 个随机种子）。
