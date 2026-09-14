# doctree — 离线优先树形文档编辑器内核

一个零第三方依赖、可完全离线运行的树形文档内核：维护任意深度嵌套的文档树、
跨层引用、拖拽移动、两种悬空引用处理策略、精确的撤销/重做，以及带完整校验的
JSON 持久化。仅使用 Python 标准库（Python 3.10+）。

## 目录结构

```
doctree/
  __init__.py      公开 API 汇总
  errors.py        全部异常类型
  model.py         不可变值对象：Node / ReferenceView / MoveResult / DeleteResult / DanglingPolicy
  history.py       撤销/重做命令：移动、删除、策略切换、新增节点、引用增删
  tree.py          DocumentTree 主内核（不变量自检、移动校验、引用、查询、undo/redo）
  persistence.py   JSON 序列化/反序列化、原子写文件、载入一致性校验
tests/             unittest 测试（含多层拖拽验收脚本与随机差分测试）
```

## 运行测试

在本目录（`workspace/`）下执行：

```bash
python -m unittest discover -s tests -t . -v
```

或直接：

```bash
python -m unittest discover -v
```

测试可重复执行、不依赖网络与第三方包。`tests/test_model_based.py` 使用固定种子
做随机差分测试：随机跨层拖拽、删除、引用增删、策略切换、撤销/重做与 JSON 往返，
每一步都与独立推导的参考状态比对完整结构、路径与受影响引用。

## 快速示例

```python
from doctree import DocumentTree, DanglingPolicy

tree = DocumentTree()                       # 默认级联清理策略
tree.add_node("doc")
tree.add_node("ch1", "doc")
tree.add_node("ch2", "doc")
tree.add_node("note", "ch1")

tree.add_reference("note", "ch2")           # 建立跨层引用
tree.add_reference("ch1", "ch2")            # 再建立一条来自子树外部的引用

# 把 note 整棵子树拖到 ch2 下的位置 0（先摘下再插入的下标语义）
result = tree.move("note", "ch2", 0)
result.moved_nodes          # ('note',)
result.old_paths["note"]    # ('doc', 'ch1', 'note')
result.new_paths["note"]    # ('doc', 'ch2', 'note')
result.affected_references  # note -> ch2（来源在被移动子树内）

tree.undo()                 # 精确回到移动前（结构、顺序、引用）
tree.redo()

# 删除：级联清理指向被删子树的引用，并记录在结果里。
# ch2 子树含 ch2、note；外部引用 ch1 -> ch2 被清理，
# note -> ch2 随来源一起消失，不出现在清理列表中。
deleted = tree.delete("ch2")
deleted.deleted_nodes          # ('ch2', 'note')
deleted.removed_references     # (('ch1', 'ch2'),)

# 或切换为“保留悬空引用并标记”
tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)
tree.dangling_references()  # Tuple[ReferenceView, ...]，dangling=True 明确标出
```

保存与载入（失败时原状态保持不变）：

```python
from doctree import save_to_file, load_from_file, load_into, dumps, loads

save_to_file(tree, "doc.json")              # 原子写入（临时文件 + replace）
restored = load_from_file("doc.json")       # 含结构与完整 undo/redo 历史
load_into(tree, "doc.json")                 # 原地替换；载入失败时 tree 不变
text = dumps(tree)                          # 也可直接序列化为 JSON 字符串
tree = loads(text)
```

## 关键语义

### 不变量（每次变更后自动校验）

- 父子关系双向一致：节点在父的 `children` 中 ⟺ 其 `parent` 指回父节点；
- 无环、无孤儿、无重复子节点；所有节点必须从某个根可达；
- 引用不自引用、不重复；`CASCADE` 策略下不允许悬空引用；
- 任何公共操作校验失败都**不产生部分修改**（校验先于变更）。

### 移动（拖拽）

`move(node_id, new_parent, index)` 把整棵子树原子地移到新位置：

- `new_parent=None` 表示根层级；
- `index` 是**先摘下、再插入**时目标兄弟列表的下标，合法范围 `0..len`（含端点）；
  同一父节点内重排遵循 Python `list.remove` 再 `list.insert` 的语义
  （`[a,b,c]` 中把 `a` 移到末尾传 `index=2`）；
- 目标父节点不存在、位置越界、移到自身或自己的后代之下，都会抛出带原因的异常
  （`NodeNotFoundError` / `InvalidPositionError` / `CycleError`）且零修改；
- 返回 `MoveResult`：被移动子树全部节点、每个节点旧/新路径、受影响引用
  （来源或目标位于子树内，含双方旧/新路径与归属标记）。

### 引用与悬空策略

- `add_reference` 只允许现存节点之间建立引用（不能自引用、不能重复）；
- 删除节点或其祖先时：
  - `CASCADE`（默认）：清理所有指向被删子树的引用，清理项记录在
    `DeleteResult.removed_references` 中，可随撤销恢复；
  - `KEEP_DANGLING`：引用保留并标记为悬空，可用 `dangling_references()` 查询；
- 查询：`references_of`（我引用谁）、`incoming_references`/`referrers_of`
  （谁引用我）、`all_references`、`dangling_references`，结果均按
  展示前序 + 出链顺序稳定返回；
- 从 `KEEP_DANGLING` 切回 `CASCADE` 会立即清理现存悬空引用，该操作同样可撤销。

### 撤销 / 重做

- 移动、删除、策略切换、新增节点、引用增删**全部**可撤销/重做；
- 撤销精确恢复树结构、子节点顺序与引用状态（引用删除后撤销会插回原位置）；
- 新编辑会清空重做栈（标准历史分叉语义）；
- 空栈撤销/重做抛出 `UndoRedoError` 且状态不变，可用 `can_undo`/`can_redo` 预判。

### JSON 文件

- 一次写入：先写同目录临时文件再 `os.replace`，不会产生半截文件；
- 载入先在临时树上完整重建并校验：字段完整、类型正确、标识唯一、
  父子双向一致、无环、无孤儿、引用合法（目标缺失时按策略拒绝或标记悬空）；
- undo/redo 历史会被**回放验证**：历史必须能从当前状态精确回放到最初、
  再逐步回到当前，且重做分支可用；任一不一致都拒绝载入；
- `load_into(tree, path)` 在临时树上完成全部校验后才覆盖 `tree`，
  因此载入失败时调用方原树（含历史）保持不变。
