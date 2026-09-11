# 目录快照与三方合并内核

一棵目录树的快照存储、最小变更集计算与真正可用的三方合并内核，面向
配置同步与文件分发场景：上游把目录树状态拍快照，两端各自增删改后，
以共同祖先为基准做三方合并，冲突给出可解释的结构化结论而不是简单覆盖。

* 仅依赖 Python 标准库（要求 3.8+，开发环境 3.10）。
* 不接真实网络、不读墙上时钟；时间用**非负整数逻辑时钟**，由存储注入，
  测试完全确定。
* 所有持久化都是单个 UTF-8 JSON 文件。

## 文件

| 文件 | 作用 |
| --- | --- |
| `snapshot_kernel.py` | 内核：数据模型、校验、快照树、共同祖先、diff、三方合并、持久化 |
| `main.py` | JSON 命令行入口 |
| `test_snapshot_kernel.py` | `unittest` 测试套件 |

## 数据模型

### `Entry`

| 字段 | 约束 |
| --- | --- |
| `path` | 非空字符串；以 `/` 开头的绝对路径；规范化后不含 `.` / `..` 段；不允许反斜杠。`/a//b` 这类写法会被规范化为 `/a/b` |
| `kind` | `'file'` 或 `'dir'` |
| `content_hash` | `file` **必填且非空**；`dir` 必须为 `None` |
| `size` | 非负整数（`bool` 不被接受为整数） |
| `mode` | 非负整数（权限位） |

`Entry` 是不可变值对象。两个 file 条目以
`(kind, content_hash, size, mode)` 判定是否相同——内容哈希相同但
`size`/`mode` 不同仍算修改。

### `Snapshot`

| 字段 | 约束 |
| --- | --- |
| `snap_id` | 非空字符串，存储内全局唯一 |
| `parent_id` | 父快照 id；根快照为 `None` |
| `entries` | `path -> Entry` 的只读映射 |
| `logical_time` | 创建时由存储分配的整数逻辑时间 |

快照一经创建不可变（`entries` 是只读映射）。整棵快照必须满足结构不变量：

1. **路径无重复**（不同写法规范化后碰撞也算重复）；
2. **父目录存在**：每个非根路径 `/a/b/c` 的 `/a`、`/a/b` 都必须存在且为 `dir`；
3. **kind 与字段匹配**：file 必有 `content_hash`，dir 必无；
4. 任何条目都不能挂在一个 file 之下。

不满足时抛 `ValidationError`，错误信息包含问题路径，例如
`file 条目必须带非空 content_hash (path=/a/x)`。

根目录 `/` 本身作为一个 `dir` 条目出现；不含 `/` 的快照也合法（空树）。

### 快照树与逻辑时钟

`SnapshotStore` 维护一棵（或多棵）快照树：

```python
store = SnapshotStore(max_entries=100_000, max_snapshots=1000, initial_time=0)
base = store.create_snapshot(None, entries)             # 根
ours = store.create_snapshot(base.snap_id, entries2)    # 子节点
```

* 每次 `create_snapshot` 让逻辑时钟 `+1`，新快照得到该时间；
  不调用任何系统时间 API。
* 自动 id 形如 `snap-<逻辑时间>`；也可以通过 `snap_id=` 显式指定，
  重复 id 会被拒绝。
* `create_snapshot(parent_id, ...)` 的 `parent_id` 为 `None` 即建根；
  存储允许存在多棵独立的树。
* `store.children(snap_id)` 给出直接子快照；`store.ancestors_of(id)`
  给出沿父链到根的序列。

## 共同祖先

`find_common_ancestor(a, b)` / `store.merge(a, b)` 沿 parent 链找
**最近（最深）共同祖先**：

* `a`、`b` 自身可以互为祖先（快进场景），此时返回较浅的那个；
* 两个快照分属不同根、链上无交集时抛 `AncestorNotFoundError`；
* 引用不存在的 id 抛 `SnapshotNotFoundError`。

## diff（最小变更集）

`diff(a, b)` 返回 `Changeset`，路径一律按字典序排列：

* `added`：b 有 a 无；
* `removed`：a 有 b 无；
* `modified`：两边都有但 `(kind, content_hash, size, mode)` 不同。

**目录级删除连同子树处理**：b 相对 a 删除目录 `/d` 时，`/d` 与其下
每个路径都出现在 `removed` 中（`/d`、`/d/f`、`/d/sub/x` …），
即变更集是逐路径的最小集合，消费者不必自己展开子树。同理新增一个
此前完全不存在的目录时，目录与其下路径都在 `added` 中。

## 三方合并

`merge(ours_id, theirs_id)` 自动找共同祖先；也可显式调用
`three_way_merge(base_id, ours_id, theirs_id)`（传 `base_id=None`
表示“无共同祖先”空基合并）。逐路径裁决：

| 情况（相对 base） | 裁决 |
| --- | --- |
| 两边都没动 | 保留 |
| 只有 ours 改 / 增 / 删 | 采用 ours（记入 `auto_resolved`） |
| 只有 theirs 改 / 增 / 删 | 采用 theirs |
| 两边改成完全相同的结果 | 自动采用（`both-same`） |
| 两边都改了同一 **file** 且哈希不同 | `modify-modify` 冲突 |
| 两边各自新建同一路径且内容不同 | `add-add` 冲突 |
| 一边删除、另一边修改 | `modify-delete` / `delete-modify` 冲突 |
| 一边是 file、另一边是 dir | `file-dir` 冲突 |
| 同一目录双方都改了元数据且不一致 | `modify-modify` 冲突 |
| 父目录被删或父目录冲突未决 | 子孙成为孤儿，见下 |

**冲突不会被静默覆盖。** `MergeResult` 包含：

* `entries`：可自动合并部分构成的目录树；
* `conflicts`：每个冲突含 `path`、`kind`、`base`/`ours`/`theirs`
  三方值（`dir` 或 `file(hash=...)`）与一句中文解释；
* `auto_resolved`：路径 → 裁决来源（`ours` / `theirs` /
  `deleted-by-ours` / `deleted-by-theirs` / `both-same`）；
* `orphaned`：被剔除的孤儿路径；
* `has_conflicts`：是否存在冲突。

无冲突时 `entries` 保证通过完整的结构校验
（父目录存在、路径无重复、kind/字段匹配）。`merge --commit-as`
在有冲突时拒绝提交。

### 孤儿路径策略（重要）

目录级删除与子树内的修改/新增叠加时，区分两种情况：

1. **一边删除目录 D，另一边修改了 D 中既有的文件**：
   该文件本身产生 `modify-delete` / `delete-modify` 冲突，**默认不静默
   删除别人的修改，也不静默恢复目录**；冲突信息同时给出两边状态，
   由人工选择“保留修改”或“接受删除”。删除方删除的目录条目也不会
   进入自动结果，直到冲突被裁决。

2. **一边删除目录 D，另一边在 D 内新增了路径 P**（P 在 base 中不存在，
   删除方从未见过它）：P 无法在结果树中落位（父目录在删除方缺失），
   这种路径称为**孤儿**。策略是：**孤儿不进入合并结果、不伪装成成功
   合并，也不被悄悄丢弃**——它被列入 `orphaned`，并产生一个
   `parent-dir` 冲突，说明是哪个祖先目录的删除/冲突导致它无家可归。
   待父目录冲突被解决（恢复目录）后，这些路径才能重新落位。

3. 某个祖先目录自身存在未解决冲突（例如 file/dir 类型冲突）时，
   其全部子孙同样按孤儿处理并报 `parent-dir` 冲突，因为在父级类型
   确定前，子孙的语义无法成立。

合并的最后阶段会为保留下来的条目补齐必要的祖先目录
（优先取 ours，其次 base、theirs 的同名 dir；三方都没有时生成
`mode=0` 的默认空目录），因此“只新增文件、双方目录都还在”这类
正常场景永远不会误报孤儿。

### 无共同祖先

`three_way_merge(base_id=None, ours, theirs)` 把 base 视为空：
只在一边出现的路径视为该方新增；两边都有但不同则是 `add-add`
（类型不同则 `file-dir`）冲突。正常的 `merge()` 在跨根时选择直接抛
`AncestorNotFoundError`，不会把两棵不相关的树偷偷按空基合并。

## 限额

构造存储时可指定：

* `max_entries`：单个快照最大条目数；
* `max_snapshots`：存储中最大快照数。

策略：

* 创建/载入快照时，`len(entries) > max_entries` 抛
  `LimitExceededError`，错误信息含实际数量与上限，快照不写入；
* 创建前 `当前快照数 >= max_snapshots` 即拒绝（第 N+1 个无法创建）；
* **先校验、后限额**：非法输入永远报校验错误，不会因为撞上限而掩盖；
  限额不合法（0、负数、布尔）在构造存储时直接报错。
* `load(..., enforce_limits=False)` 可在只读检查场景跳过限额拒绝
  （结构校验仍然执行）。

## save / load 往返

`store.save(path)` 原子写入（先写 `path.tmp` 再 `os.replace`）：

```json
{
  "format": "snapshot-store-v1",
  "logical_time": 3,
  "limits": {"max_entries": 100000, "max_snapshots": 1000},
  "snapshots": [ {snapshot...}, ... ]
}
```

* 快照按父在前的拓扑顺序写出，加载时按序登记，因此**不需要先有
  完整存储也能逐帧重放**；
* 往返后逻辑时钟、全部快照内容保持不变，继续做 `diff` / `merge`
  的结果与保存前逐字段一致（测试覆盖）；
* 文件不是合法 JSON、顶层结构错误、缺少 `snapshots` / `snap_id` /
  `entries` 等必需字段、条目缺 `path`/`kind`/`size`/`mode`、
  父快照晚于子快照出现、结构不变量被破坏，都会抛
  `SerializationError`，信息指出第几个快照/哪条路径/什么字段；
* 文件中的限额默认在加载后继续生效，也可用构造参数覆盖。

## CLI（main.py）

全局参数 `--store PATH`（默认 `snapshots.json`），所有命令输出 JSON。

| 命令 | 作用 |
| --- | --- |
| `init [--max-entries N] [--max-snapshots N] [--force]` | 初始化空存储文件 |
| `root --entries FILE [--id ID]` | 创建根快照 |
| `create --parent ID --entries FILE [--id ID]` | 在父快照下创建快照 |
| `list` | 列出全部快照（id / parent / 逻辑时间 / 条目数） |
| `show --id ID` | 显示快照完整内容 |
| `ancestor --a ID --b ID` | 最近共同祖先 id |
| `diff --from ID --to ID` | 变更集 `added/removed/modified` |
| `merge --ours ID --theirs ID [--base ID] [--commit-as ID] [--commit-parent ID]` | 三方合并；无冲突时可选地提交为新快照（默认挂在 ours 下） |
| `validate --entries FILE` | 只校验 entries 文件 |

entries 文件：

```json
{
  "entries": {
    "/":          {"kind": "dir", "size": 0, "mode": 448},
    "/etc":       {"kind": "dir", "size": 0, "mode": 448},
    "/etc/hosts": {"kind": "file", "content_hash": "sha256:...",
                   "size": 128, "mode": 384}
  }
}
```

* 成功输出业务 JSON，退出码 `0`；
* 任何内核错误（校验、找不到快照、无共同祖先、超限、文件损坏）输出
  `{"error": "中文说明", "type": "异常类名"}`，退出码 `1`；
* 参数用法错误输出同样形态的 JSON（`type=ArgumentError`），退出码 `2`；
* JSON 输出使用 ASCII 转义，保证在任意编码的控制台下字节安全。

## 错误类型一览

| 异常 | 触发场景 |
| --- | --- |
| `ValidationError` | 路径/条目/快照不满足不变量（带问题路径） |
| `SnapshotNotFoundError` | 引用了不存在的快照或父快照 |
| `AncestorNotFoundError` | 两个快照分属不同根 |
| `LimitExceededError` | 超过 `max_entries` / `max_snapshots` |
| `SerializationError` | 文件损坏、JSON 非法、字段缺失、拓扑顺序错误 |
| `KernelError` | 上述异常的基类；重复 id、父链成环等 |

## 运行测试

```bash
python -m unittest test_snapshot_kernel.py -v
```
