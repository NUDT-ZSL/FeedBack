# interflow — 离线可验收的交互原型页面串联模块

纯 Python 标准库实现，**零第三方依赖**，完全离线可运行、可单元测试。
在多页面设计稿之间建立「点击 / 悬停 / 输入 → 跳转 / 返回 / 切状态 / 提交」
的可执行模型，维护变量快照、历史栈与迁移日志，并支持整批原子触发与
单文件保存 / 载入校验。

## 运行环境

* Python 3.9+（仅标准库：`json`、`copy`、`os`、`tempfile`、`unittest` …）
* 无需安装、无需联网。

```powershell
# 跑全部 57 个单元测试
python -m unittest tests.test_interflow -v

# 跑多页面多分支验收演示（条件跳转 / 返回恢复 / 整批回滚 / 坏文件载入）
python demo_acceptance.py
```

## 目录结构

```
interflow/
  __init__.py      # 公共 API
  errors.py        # 全部异常类型（均继承 InterflowError）
  models.py        # Page / PageState / InteractionElement / Action / 迁移记录
  engine.py        # PrototypeEngine：推进、历史、逻辑时钟、批量事务、查询
  persistence.py   # 单文件 JSON 保存 / 载入（重放校验）
tests/
  test_interflow.py
demo_acceptance.py
```

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `Page` | 页面，有全局唯一标识、入口状态、若干 `PageState` 与 `InteractionElement` |
| `PageState` | 页面状态：唯一标识 + 一组变量快照（`dict[str, 标量]`） |
| `InteractionElement` | 交互元素，页内唯一标识，可绑定多个带唯一标识的 `Action` |
| `Action` | 四种动作：`goto` 跳转、`back` 返回、`set_state` 切换本页状态、`submit` 提交输入（可附带跳转） |
| 目标引用 | `"页面标识"` 或 `"页面标识.状态标识"`；只给页面时落在其入口状态 |
| 历史帧 | 跨页离开时压栈：`(离开页面, 离开状态, 离开那一刻的变量快照)` |
| 逻辑时钟 | 从 0 开始，每成功应用一个动作 +1；迁移日志按 clock 连续编号 |

### 变量快照语义

* 跨页 / 同页导航落地时，活动变量 = **目标状态自带的快照**；
* `submit` 不导航时，把输入值写入当前活动变量并保留；
* `back` 返回时，活动变量 = **历史帧里离开那一刻的快照**（原样恢复）。

## 快速上手

```python
from interflow import (
    PrototypeEngine, Page, PageState, InteractionElement, Action,
    save_to_file, load_from_file,
)

engine = PrototypeEngine(start_page_id="home")

home = Page("home", "s0", [
    PageState("s0", {"role": "guest"}),
    PageState("s_admin", {"role": "admin"}),
])
btn = InteractionElement("btn_go")
# 条件分支：取值必须互斥；用 default_target 覆盖其余取值，
# 或在取值集合已列尽时传 exhaustive=True
btn.add_action(Action.branch_goto(
    "go", "role",
    [("guest", "login.s0"), ("vip", "vip.s0"), ("admin", "pay.s0")],
    default_target="denied.s0",
))
home.add_element(btn)
engine.add_page(home)
# ... add_page 其余页面；页面可按任意顺序注册 ...
engine.validate()
engine.reset()

record = engine.trigger("btn_go", "go")   # -> login.s0, clock=1
engine.current_position()                 # Location(page='login', state='s0')
engine.get_variables()                    # 按键名排序的变量快照副本
engine.history_depth()                    # 1
engine.which_branch("btn_go", "go", {"role": "vip"})
engine.reachable_paths("home")            # 结构可达简单路径（稳定顺序）
```

### 连续动作：稳定顺序 + 整批原子

同一时刻到达的多个动作先按 `(元素标识, 动作标识)` 稳定排序，再逐个应用；
任一步失败则**整批回滚**（位置、变量、历史栈、时钟、日志全部恢复），
抛出的 `BatchAbortedError` 带失败下标与原始原因：

```python
from interflow import TriggerStep
try:
    engine.trigger_batch([
        TriggerStep("btn_set", "become_admin"),
        TriggerStep("back_btn", "back"),
    ])
except BatchAbortedError as exc:
    print(exc.index, exc.reason)
```

## 拒绝规则（错误均可 `except InterflowError` 兜底）

* `DuplicateIdError` / `DefinitionError`：标识为空、含 `.`、作用域内重复；
* `TargetNotFoundError`：动作引用的目标页面 / 状态不存在（整体校验时报出）；
* `ConditionError`：分支取值不互斥、未覆盖全部取值（无兜底且未声明穷尽）、
  运行时取值不命中；
* `MissingVariablesError`：条件判定变量缺失（`.missing` 列出变量名），
  或提交动作未给输入值；
* `BackRejectedError`：历史栈为空时返回；
* `TriggerError`：当前页找不到指定元素 / 动作，动作有歧义未指定 id；
* `BatchAbortedError`：批次中某步失败，已整批回滚；
* `PersistenceError`：文件无法读取、JSON 非法、字段缺失、校验失败、
  日志重放与 runtime 不一致。

## 文件格式与载入校验

`save_to_file(path, engine)` 写出 UTF-8 JSON（原子替换，不会留下半文件）：

```json
{
  "format": "interflow", "version": 1,
  "start_page": "home",
  "pages": [ { "id", "entry_state", "states": [...], "elements": [...] } ],
  "runtime": {
    "current_page", "current_state", "variables",
    "history": [ {"page", "state", "variables"} ],
    "clock": N,
    "log": [ {"clock", "element", "action", "kind", "source", "dest", ...} ]
  }
}
```

`load_from_file(path)` 在**全新引擎**中重建定义，然后从起始页**逐条重放
迁移日志**，并比对：

1. 标识唯一（页面全局、状态/元素页内、动作元素内）；
2. 入口状态存在、所有跳转 / 分支 / 切换目标存在；
3. 条件分支互斥且覆盖全部取值（兜底或 `exhaustive`）；
4. clock 从 1 连续递增、与日志条数一致；
5. 每条日志的 `source/dest/branch/input` 与重放结果一致；
6. runtime 的当前位置、变量快照、历史栈（含每帧快照）与重放终态一致。

任何不一致都抛出带定位信息（如 `runtime.log[3] ...`）的
`PersistenceError`，新引擎被丢弃，调用方原有引擎的内存状态保持不变。
