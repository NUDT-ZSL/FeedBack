# doctree — 离线树形文档编辑器内核

一个**纯 Python 标准库**实现的可嵌套文档树内核，支持跨层拖拽、跨层引用、
引用级联清理 / 悬空策略、增量保存、版本 diff 与回滚。无第三方依赖，
可离线运行，自带 `unittest` 测试与行 JSON 命令行入口。

## 目录结构

```
.
├── doctree/
│   ├── __init__.py       # 公共 API 导出
│   ├── exceptions.py     # 错误类型（带稳定 code）
│   ├── model.py          # Node 节点模型、MoveResult
│   ├── tree.py           # DocumentTree：增删改、拖拽、引用、查询、分段历史、回滚
│   └── persistence.py    # 增量日志保存/加载/重放校验、VersionDiff
├── main.py               # 命令行入口（stdin 逐行 JSON -> stdout 逐行 JSON）
└── tests/                # unittest 测试
    ├── test_model.py
    ├── test_tree.py
    ├── test_persistence.py
    ├── test_cli.py            # 进程内 CLI 会话测试
    ├── test_cli_blackbox.py   # 子进程黑盒：真实喂坏文件/坏命令，断言不崩溃
    ├── test_integration.py
    ├── test_load_errors.py    # 坏文件/断序号/成环等 load 错误定位与原子性
    └── test_rollback_boundaries.py  # save 边界回滚、查询交错、跨回滚点 diff
```

要求 Python 3.8+（仅用标准库）。

## 快速开始

### 作为库使用

```python
from doctree import DocumentTree, POLICY_LENIENT
from doctree.persistence import save, load

t = DocumentTree()                       # 默认策略 cascade
t.add("root", None, "section")           # 根节点 parent_id=None
t.add("a", "root", "section")
t.add("b", "root", "note", content="hi")
t.add("a1", "a", "note")
t.add_ref("b", "a1")                     # b 引用 a1

r = t.move("a", "root", 1)               # 跨层/同父拖拽
print(r.moved_ids, r.old_path, r.new_path, r.affected_refs)

save(t, "tree.dtj")                      # 基准快照 + 变更记录
t.update_content("b", "hello")
save(t, "tree.dtj")                      # 只追加新增量

u = load("tree.dtj")                     # 重放重建，全量校验
```

### 命令行

`main.py` 从标准输入逐行读 JSON 命令，每行输出一条 JSON 结果；
错误也是 JSON 且包含 `error` 与 `code` 字段，会话不中断。

```bash
python main.py <<'EOF'
{"op":"add","node_id":"r","parent_id":null,"kind":"section"}
{"op":"add","node_id":"a","parent_id":"r","kind":"note","content":"hi"}
{"op":"add","node_id":"b","parent_id":"r","kind":"ref","refs":["a"]}
{"op":"path","node_id":"a"}
{"op":"move","node_id":"a","new_parent_id":"r","index":0}
{"op":"save","path":"tree.dtj"}
EOF
```

### 运行测试

```bash
python -m unittest discover -s tests -v
```

## 节点模型与不变量

每个节点（`doctree.model.Node`）含：

| 字段 | 类型 | 说明 |
|---|---|---|
| `node_id` | 非空 `str` | 全局唯一 |
| `parent_id` | `str \| None` | 根节点为 `None`，一棵树至多一个根 |
| `children` | `list[str]` | 有序列表，**顺序即展示顺序** |
| `kind` | 非空 `str` | 如 `section` / `note` / `ref` |
| `content` | `str` | 可为空 |
| `refs` | `set[str]` | 指向其他节点的引用；无自引用、无重复 |

任何时刻（每个操作成功后、每次 `load` 后）都保证：

- `parent_id` 与父节点 `children` **双向一致**；
- 没有孤儿节点（所有节点从根可达），没有环；
- `children` 无重复 id；
- `refs` 无重复、无自引用；悬空引用只允许出现在 `lenient` 策略下。

`DocumentTree.validate()` 会显式检查以上全部不变量（含内部反向索引一致性），
保存/加载/回滚路径都会调用它。

## 跨层拖拽 move

```python
t.move(node_id, new_parent_id, index)
```

- `index` 以“**先把该节点从旧位置摘下之后**”的目标 `children` 为准，
  合法范围 `0..len(目标 children)`；同父重排时最大下标比普通追加小 1；
  `index=None` 表示追加到末尾。
- 移动的是节点**及其整棵子树**。
- 拒绝：移到自身、移进自己的后代（会成环）、`new_parent_id` 不存在、
  `index` 越界。非法操作先报错、状态完全不变，也不产生版本号。
- 成功返回 `MoveResult`：
  - `moved_ids`：被移动子树的全部 id，**前序**；
  - `old_path` / `new_path`：移动前后根→该节点的 id 列表；
  - `affected_refs`：跨越被移动子树边界的引用
    （`{"owner","target","direction":"in"|"out"}`）。
    子树整体移动不改变引用指向，这里只提示“可能受关注”的边界引用。

## 引用与删除策略

`refs` 是跨层的：任何节点可引用任何其他节点。删除一棵子树时，
所有“**子树外 → 子树内**”的入边引用按当前策略处理（子树内部互指的引用
随节点一起消失，不算入边）：

| 策略 | 删除行为 |
|---|---|
| `cascade`（默认） | 逐条清理入边引用，并在 `RemoveResult.removed_refs` 记录 |
| `strict` | 存在任何入边引用就抛 `DanglingReferenceError`，**整次操作回滚** |
| `lenient` | 保留引用，成为悬空引用；查询时打 `dangling` 标记 |

- 构造时指定：`DocumentTree(ref_policy="lenient")`；
  运行时切换：`set_ref_policy("strict"|"lenient"|"cascade")`。
- `lenient` 下也允许直接 `add_ref` 到尚不存在的目标；
  当目标节点后来被重新创建，悬空自动消除。
- 切到 `strict` 时若当前存在悬空引用，报错且**不切换**；
  切到 `cascade` 会立即清理全部悬空引用（每条都进变更日志）。
- `get_dangling_refs()` 返回 `[{"owner","target"}]`。
- `resolve_refs(node_id)` 返回每条引用的详情：
  `{"target","exists","dangling","node"}`。

## 查询与顺序保证（稳定顺序）

- `get_path(node_id)`：根→节点的 id 列表。
- `get_subtree(node_id, max_depth=None)`：子树 id 的**前序（pre-order）**
  列表；`max_depth=0` 只含自身。
- `find_by_kind(kind)`：匹配节点，按**全树前序**。
- `preorder_ids()`：全树前序。
- 所有集合型输出——节点 `refs` 序列化、`get_dangling_refs()`、
  `resolve_refs()`、删除/移动结果里的引用边、`VersionDiff` 各列表——
  一律按 **字典序**（引用边按 `(owner, target[, direction])`）排序。
- 空树的集合查询返回空列表，`root_id` 为 `None`。

## 增量保存格式（`.dtj`，JSON Lines）

`save(path)` 不写全量状态快照，而是写**逐行 JSON** 日志：

| 记录 | 作用 |
|---|---|
| `header` | 首行，格式标识 `doctree-journal` 与格式版本 |
| `snapshot` | 某分段的基准快照（含 `segment` 下标、`base_version`） |
| `change` | 一条变更：`seq`（文件内全局连续序号，从 1 起）、`segment`、`base_version`（变更前版本）、`version`（变更后版本）、`change`（操作体） |

- 首次 `save`：header + version 0 的**基准快照** + 至今全部变更记录；
- 之后对**同一路径**的 save：只 `append` 上次保存之后的新记录；
- `load(path)`：逐行解析 → 从基准快照重放变更 → 整树 `validate()`。

变更操作体的 `op` 有：`add`、`remove`、`move`、`content`、
`ref_add`、`ref_remove`、`policy`。级联删除在日志里展开为
多条 `ref_remove` 后接一条 `remove`，因此删除本身可直接重放。

### 加载原子性与错误定位

`load` 是**原子**的：解析与重放全部发生在新建对象上，只有文件里每条记录
都合法、最终树通过 `validate()` 时才返回；任何一步失败都只抛异常、不返回
半成品。CLI 会话在 load 失败时保持**加载前状态**，后续命令照常工作。

`load` 对以下情况一律报错（绝不静默跳过），错误信息定位到
**文件行号 / 第几条变更 / op / node_id / 被破坏的约束**：

- 非 JSON 行（带列号）、空行、记录缺字段或字段类型错误；
- `seq` 不连续（消息给出上一序号、实际序号与期望序号：正缺口提示文件被
  截断/缺记录，负缺口提示某行被复制/插入导致序号重叠）；
- 快照 `version` 与记录 `base_version` 不匹配；分段 checkpoint 引用未知历史版本；
- 变更在其所属分段的快照之前出现、分段记录交错（分段必须顺序写完再开下一段）；
- 变更引用不存在的节点（cascade/strict 下）、自引用、重复引用；
- `move` 形成环、父不存在、index 越界；
- 变更 `base_version` 与重放状态不衔接、版本号重复或不严格递增；
- 快照内父子关系不双向一致、有孤儿/环、cascade/strict 快照含悬空 refs；
- 重放结束后整棵树不满足任一不变量。

`InvalidChangeError` 除消息外还结构化暴露 `change_no`（1 基“第几条变更”，
跨全文件计数）、`change_index`（0 基）、`line_no`、`op`、`node_id`，
其 `to_dict()`（即 CLI 错误输出）也带这些字段，便于程序化定位：

```json
{"code":"invalid_change",
 "error":"change #5 (index 4) at line 7: constraint violated while replaying 'move': move change: moving 'a' into its own subtree creates a cycle [op='move', node_id='a']",
 "change_no":5,"change_index":4,"line_no":7,"op":"move","node_id":"a"}
```

文件尾部被截断但剩余记录序号连续、链完整时，会重建到最后一个一致状态
（不跳过任何仍在文件中的记录）；链一旦断裂，从断裂点起报错。

## 版本、diff 与回滚

- 每次成功变更 `version += 1`；内容没变化（如重复 set 同样的 content）不涨版本。
- `history()` 列出当前文件中可回放的全部版本号。
- `diff_versions(v1, v2)` 返回 `VersionDiff`：
  - `added` / `removed`：节点 id（v2 相对 v1）；
  - `moved`：两版本都存在但父节点或兄弟下标变化的节点
    （同父重排时，被拖动节点与发生位移的兄弟都会出现），附旧/新父节点、
    下标与路径；
  - `content_changed`、`refs_added`、`refs_removed`。
  - 注意：`moved` / `content_changed` / `refs_*` 只统计**两版本都存在**的
    节点/边；新增节点携带的引用只体现在 `added` 里。
- `state_at_version(v)`：从日志重放出任意历史版本的树（不影响当前状态）。
- `rollback(v)`：把内存状态恢复到版本 `v`（内部就是重放）；
  版本不存在抛 `VersionNotFoundError`。回滚到**当前版本**是空操作
  （不新增分段、不占版本号）；回滚点恰好是某次 save 边界、以及回滚后
  只做查询再编辑，都不影响一致性——只读操作（`get_path` / `get_subtree` /
  `find_by_kind` / `resolve_refs` / `get_dangling_refs` / `history` /
  `diff_versions` / `state_at_version` / `dump_state`）不产生变更、不涨版本。

### 回滚后再编辑：版本号单调、历史不覆盖

回滚会开启一个新的**分段（segment）**：起点是目标版本的 checkpoint 快照，
之后新变更的版本号从“本会话曾分配过的最大版本号 + 1”继续分配，
**不复用被回滚分支的版本号**（因此版本号可能跳号），旧分段原样保留——
加载后仍可 `diff_versions` / `state_at_version` 到任何旧版本。回滚本身
不是变更：它不占版本号，同一版本不会在 `history()` 里出现两次。
回滚后对同一文件 `save` 时，只追加新分段的 checkpoint 快照与新变更记录
（回滚点恰好等于已落盘版本时只追加 checkpoint）。跨回滚点 `diff_versions`
比较的是两个**版本状态**而非变更序列，因此旧分支与新分支之间的增删、
移动、内容与引用差异都按实际状态计算，回滚动作不会被误当成一次变更。

## CLI 命令一览

每条命令是一个 JSON 对象，`op` 区分：

| op | 参数 | 说明 |
|---|---|---|
| `add` | `node_id, parent_id, kind, content?, refs?` | 新增叶子节点 |
| `remove` | `node_id` | 删除子树（按策略处理入边） |
| `move` | `node_id, parent_id`(或 `new_parent_id`), `index?` | 跨层拖拽 |
| `update_content` | `node_id, content` | 改内容 |
| `add_ref` / `remove_ref` | `owner, target` | 维护引用 |
| `policy` | `policy?` | 不传=查询；传=cascade/strict/lenient 切换 |
| `path` | `node_id` | 根→节点路径 |
| `subtree` | `node_id, max_depth?` | 前序 id 与节点详情 |
| `find` | `kind` | 按 kind 前序查找 |
| `resolve` | `node_id` | 引用目标详情（标悬空） |
| `dangling` | — | 全部悬空引用 |
| `history` | — | 可回放版本号 |
| `save` / `load` | `path` | 增量保存 / 加载替换会话状态 |
| `diff` | `v1, v2` | 版本差异 |
| `rollback` | `version` | 回滚 |
| `dump` | — | 完整状态（含前序、悬空、历史、版本） |

成功结果含 `"ok": true`；错误结果形如：

```json
{"error":"cannot move 'a' into its own subtree (would create a cycle)","code":"validation_error"}
```

错误码：`invalid_json`、`invalid_command`、`unknown_op`、`missing_field`、
`validation_error`、`node_not_found`、`dangling_reference`、
`invalid_change`（结构化带 `change_no` / `change_index` / `line_no` / `op` /
`node_id` 字段，见“加载原子性与错误定位”一节）、`version_not_found`、
`file_not_found`、`internal_error`。每个错误响应都保证包含 `error`（人类可读
消息）与 `code`（机器可读码），进程**不会**因单条坏命令退出，始终退出码 0。

## 边界情况覆盖（已在测试中）

空树、单节点树、第二根节点拒绝、移到自身、移进后代、index 越界（含同父
重排边界）、删除带入边引用的子树（三种策略）、悬空引用策略来回切换、
悬空目标重建后自动恢复、删根后重建、变更序号不连续、基准版本错配、
快照字段缺失 / 孤儿 / 环 / 父子不双向一致、分段交错写入、回滚到不存在版本、
回滚到当前版本（空操作）、回滚点恰好落在 save 边界、回滚后只查询再编辑、
连续回滚、回滚到 v0 后重建、回滚后直接 save、回滚后再编辑再 save/load、
跨回滚点 diff（增删 / 移动 / 引用）、save 后 load 状态逐字段一致、
加载后继续编辑追加日志、坏文件带行号与第几条变更报错、load 失败后会话
保持加载前状态——其中坏文件与 CLI 错误契约同时由 `tests/test_cli_blackbox.py`
用真实子进程黑盒验证。
