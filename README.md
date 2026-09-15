# 焦点顺序引擎（focus_order）

离线键盘无障碍交互层的**焦点顺序核心模块**：维护可聚焦元素及其带方向的
顺序关系，处理方向键推进、成环检测与拒绝、弹层容器接管、动态增删后的
增量一致性，以及可预测、可追溯的稳定查询。

- **零第三方依赖**，仅使用 Python 3.8+ 标准库；
- 配套 **50 个 unittest 验收用例**（含 400 步随机差分测试）与一个演示脚本；
- 单文件核心实现位于 `focus_order/engine.py`。

## 目录结构

```
workspace/
├── focus_order/
│   ├── __init__.py        # 包入口，公开 API
│   └── engine.py          # 核心引擎（数据模型 + FocusEngine）
├── tests/
│   ├── __init__.py
│   └── test_focus_order.py  # 与 7 条需求一一对应的 50 个验收用例
├── demo.py                # 对应 7 条需求的可运行演示
└── README.md
```

## 快速验收

在本目录下（无需安装任何东西）：

```bash
python -m unittest discover -s tests -t . -v   # 全部测试
python demo.py                                 # 看 7 条需求的实际行为
```

两条命令退出码为 0 即验收通过（demo 内部带断言，语义被破坏时会非零退出）。

## 模型与 API

### 元素与方向

`FocusEngine(directions=("up","down","left","right"))` 的方向集合可自定义，
方向按注册位置形成固定全序，查询时严格按该顺序返回。

元素四元组：`id`（唯一）、`container`（所在容器）、`focusable`（可否聚焦）、
`disabled`（是否禁用）。`usable = focusable and not disabled`。

| 操作 | 说明 |
| --- | --- |
| `add_element(id, container, focusable=True, disabled=False)` | 注册元素，重复 id 抛 `duplicate-element` |
| `update_element / set_disabled / set_focusable / move_to_container` | 局部更新 |
| `remove_element(id)` | 删除元素并**同步清理所有相关边**（出边与所有指向它的入边），不留悬空关系 |
| `add_relation(source, direction, target)` | 添加方向边；**同一元素同一方向至多一个目标** |
| `remove_relation(source, direction)` | 删除单条关系 |
| `configure(elements=..., relations=..., reset=False)` | 批量配置，**非法时整体回滚**（原子） |

### 为什么推进是唯一且可预测的（对应需求 3）

每个方向上每个元素至多一条出边，因此每个方向的关系图是**函数图**
（functional graph）：从任一元素出发的轨迹是数学函数的迭代，与内部
遍历顺序无关。配合以下全序约定，所有结果与配置到达顺序无关：

- 方向的全序 = 构造时的方向注册顺序；
- 元素的全序 = id 的稳定全序（数值按数值序、字符串按字典序、混合类型按
  固定档位；见 `_id_key`）；
- 多环结果按 `(方向注册序, 环起点)` 排序，环序列从环上最小 id 开始。

`graph_snapshot()` 返回只取决于终态的声明式结构；测试枚举所有插入
排列（6×6 组）断言：**快照相同、连串按键的接受/拒绝序列与落点完全相同**。

### 方向键 `advance(direction)`

单次按键只跨越一条直接关系，按以下**固定优先级**判定（前者优先），
失败返回 `MoveResult(accepted=False)` 且**当前焦点绝不变**：

1. `unknown-direction` — 方向未注册；
2. `no-current-focus` — 还没有初始焦点；
3. `no-relation` — 当前元素在该方向上没有配置目标；
4. `target-missing` — 目标不存在（公共 API 不会产生，防御性分支）；
5. `target-disabled` — 目标被禁用；
6. `target-not-focusable` — 目标不可聚焦；
7. `scope-escape` — 目标在当前接管容器之外；
8. `cycle` — **这条边本身位于环上**（target 沿同方向能回到 source）。

> **环的精确语义**：只有当待跨越的边位于环上（按方向迭代会回到自身）
> 时才以 `cycle` 拒绝，因为跨过去才会开始无限循环；只是"下游远处有环"
> 的汇入尾巴边允许走一步到环口，此时连续成功推进仍**永远不会重复经过
> 节点**，不存在死循环。已存在的环任何时候都可通过 `find_cycles()` 列出。

### 环检测 `find_cycles(direction=None)`

- 返回 `Cycle(direction, nodes)` 列表，`nodes` 已规范化为**从环上最小
  id 开始**的有序序列（自环返回单元素元组）；
- 环允许配置存在，不静默忽略，也不阻止其它方向/其它分量的正常推进；
- 基于函数图的"单次遍历 + 位置表"检测，每个弱连通分量至多一个环。

### 容器接管（弹层焦点陷阱）

| 操作 | 语义 |
| --- | --- |
| `enter_scope(container, initial_focus=None)` | 压栈接管；不指定初始焦点时取容器内 id 最小的可用元素；容器无可用元素时焦点为 `None` 并建立丢失锚点 |
| `exit_scope(container=None)` | 必须**后进先出**（可传容器名校验栈顶）；焦点回到接管前元素 |
| `active_container / scope_depth / scope_stack()` | 查询接管状态 |

接管期间：

- 任何会把焦点带出栈顶容器的推进返回 `scope-escape`，焦点保持；
- `set_focus` 不能设置到容器外（`invalid-focus-target`）；
- 同一容器不得重复接管（`scope-already-active`），无接管时退出报
  `scope-not-active`，非栈顶退出报 `scope-mismatch`；
- 支持嵌套接管（两层弹层），内层结束时的回退被限制在外层容器内。

**恢复规则**：退出接管时，若接管前元素仍存在、可用且不违反外层接管，
则精确恢复；否则按下面的"最近可用"规则回退；接管前本就无焦点则保持无
焦点（不抢夺焦点）。

### 动态变更与"最近可用"回退

`remove_element` / 禁用 / 取消聚焦 / 移出容器发生在**当前焦点**上时，
以及退出接管而原元素失效时，按声明式规则回退：

1. 接管中：只在接管容器内候选；否则优先与锚点同容器，同容器一个可用
   元素都没有时才扩大到全局；
2. 候选按 id 全序排列，取 **id ≤ 锚点的最大者**（最近前驱），没有前驱
   时取 **id > 锚点的最小者**（最近后继）；
3. 一个候选都没有 → 当前焦点记为 `None`，同时建立丢失锚点；此后同范围
   内一旦出现可用元素（如弹层内容异步渲染），自动安全恢复。

该规则只取决于最终配置，可通过 `nearest_usable(anchor, container_hint=...)`
单独查询；删除后同 id 重新加入是**全新元素**，不继承任何旧关系。

### 查询、历史与拒绝原因（需求 7）

| API | 返回 |
| --- | --- |
| `is_focusable(id)` / `get_element(id)` / `get_container(id)` | 状态查询 |
| `get_target(id, direction)` / `targets(id)` / `relations_of(id)` | 各方向直接目标（方向按注册序） |
| `describe_element(id)` / `list_elements()` | 带关系的完整视图；列表按 id 全序稳定排序 |
| `current_focus` / `active_container` | 当前焦点与接管容器 |
| `history()` | 只包含**真正改变焦点**的事件（`focus/move/scope-enter/scope-exit/fallback/refocus`），序号单调 |
| `last_rejection` | 最近一次拒绝的机器码、中文原因、所在元素、目标、所属容器、环序列 |
| `graph_snapshot()` / `rebuild()` / `validate_integrity()` | 终态快照、按终态重建、不变量自检（悬空边/索引残留/焦点逃逸等） |

被拒绝的按键不入历史（焦点未变），但会更新 `last_rejection`，直到下一次
被拒绝为止（成功移动不清空它，保证"最近一次被拒绝的原因"始终可查）。

## 错误码与拒绝码速查

**配置类错误（抛 `FocusError`，带稳定 `code` 与 `context`）：**

| code | 触发场景 |
| --- | --- |
| `duplicate-element` | 重复注册同一 id |
| `element-not-found` | 查询/删除不存在的元素 |
| `relation-conflict` | 同元素同方向重复配置（context 含 `direction/existing_target/new_target`） |
| `relation-source-missing` / `relation-target-missing` | 关系端点不存在 |
| `unknown-direction` | 方向不在注册集合内 |
| `scope-already-active` / `scope-not-active` / `scope-mismatch` | 接管栈误用 |
| `invalid-focus-target` / `invalid-scope-target` | 显式置焦/接管初始焦点非法或越界 |

**运行时拒绝（`advance()` 返回 rejected，焦点不变）：**

`no-current-focus`、`unknown-direction`、`no-relation`、`target-missing`、
`target-disabled`、`target-not-focusable`、`scope-escape`、`cycle`。

## 关键设计决策

1. **按方向分片的函数图**：每个 (元素, 方向) 至多一条出边，推进路径是
   函数迭代而非集合遍历，从根上消除遍历顺序漂移。
2. **环不是配置错误，而是可查询的结构**：弹层等场景可能临时成环，引擎
   随时列出全部环，只在真的要跨上环边时拒绝，并附带环序列。
3. **增量 == 重建**：删除只动出边 + 反向索引中的入边，不做全局重算；
   结构上是否一致不靠"相信自己"，而由 400 步随机差分测试反复断言
   `rebuild().graph_snapshot() == 增量快照`。
4. **焦点回退是声明式的**：以丢失元素为锚点、容器优先、前驱优先的全序
   规则，保证与元素是先禁用后恢复还是直接删除无关。
5. **失败原子性与安全失败**：批量配置失败整体回滚；任何异常路径下当前
   要么停在原地，要么落在合法可用元素或明确的 `None` + 锚点上，绝不留
   下指向已删除元素的悬空关系（`validate_integrity` 可随时自检）。

## 最小示例

```python
from focus_order import FocusEngine, RejectCode

engine = FocusEngine()
engine.configure(
    elements=[
        {"id": "a", "container": "form"},
        {"id": "b", "container": "form"},
        {"id": "c", "container": "form", "disabled": True},
    ],
    relations=[("a", "right", "b"), ("b", "right", "c")],
)
engine.set_focus("a")
print(engine.advance("right").target)          # b
r = engine.advance("right")                     # c 禁用
print(r.accepted, r.code, engine.current_focus) # False target-disabled b
print(engine.last_rejection["message"])         # 中文原因
```
