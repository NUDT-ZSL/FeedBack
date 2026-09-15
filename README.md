# experience_graph — 可追溯、可收敛的经验条目图谱

一个**零第三方依赖、仅用 Python 标准库**、可完全离线运行与验收的模块。它把团队
反复修订、互相引用的经验条目组织成一张可追溯的有向无环图，并在并发修订时给出
**确定性**的冲突消解结果。

## 运行要求

* Python 3.8+（仅标准库：`dataclasses`、`hashlib`、`json`、`tempfile`、`os`、`unittest`）
* 无需联网，无需 `pip install`

## 目录结构

```
experience_graph/
├── __init__.py        # 公开 API
├── errors.py          # 清晰的异常体系
├── merge.py           # 段落级 LCS 对齐 / 多方合并 / 行级 diff（纯函数内核）
├── graph.py           # 图谱核心：条目、DAG 引用、修订、冲突、时钟、查询
└── persistence.py     # 单文件 JSON 快照 + sha256 校验和 + 原子写入
tests/
├── test_merge.py      # 合并内核（含 200 例随机化全排列等价性）
├── test_graph.py      # 需求 1-6
└── test_persistence.py# 需求 7：往返、损坏、缺字段、失败原子性
demo.py                # 端到端演示（离线可直接运行）
```

## 运行测试与演示

```bash
# 在仓库根目录（本文件所在目录）执行
python -m unittest discover -s tests -v

python demo.py
```

Windows 控制台若需正常显示中文，可加 `-X utf8`：`python -X utf8 demo.py`。

## 七条需求是如何满足的

1. **条目与无环引用**：条目有唯一标识、主题、正文、单调版本号。引用必须指向已存在
   条目；自引用、重复引用、直接或传递成环都会被 `ReferenceError` 拒绝（新增边前做
   可达性判定）。
2. **修订不静默覆盖**：每次修订记录作者、基准版本、改动内容。基准版本落后于当前版本
   时抛 `StaleRevision`，其 `behind` 属性明确给出**落后了多少个版本**。
3. **同段冲突保留双方**：两个修订基于同一版本且改动同一段落（含"一改一删"）时，
   生成可读 `ConflictRecord`（含条目、双方作者、段落位置、双方原文），**条目不前进
   版本、绝不自动选边**。可用 `resolve_conflict` 人工收敛。
4. **不同段落自动合并**：改动不同段落时合并为**一条**新版本。合并基于各方对基准版本
   的编辑意图多重集合，结果与修订到达顺序无关；对不相交段落，其结果与"逐条串行
   rebase"在**任意排列**下完全一致（由确定性内核与随机化测试保证）。
5. **删除 / 拆分只重算受影响边**：操作仅拆除 / 重定向与该条目相关的引用边，返回受
   影响边清单；增量结果与 `rebuild_indexes()` 从头重建完全一致，且保证不存在悬空
   引用。

   * **删除**：条目连同其版本/修订/冲突记录一并清除，所有关联引用边收敛，导出不再
     引用已删条目，导出→导入可正常通过。
   * **拆分**：旧条目**不删除**，而是转为只读的「已拆分归档」——完整版本序列与修订链
     冻结在拆分点、仍可查询（`revision_chain` / `diff_versions`），锚定其历史版本的
     **冲突记录随旧条目归档保留**（`entry_id` 始终有效，不悬空）；每个**新分片从拆分
     点以自己的 v0 开始**独立计版本（元数据 `split_from`/`split_from_version`），
     干净起步、不携带旧冲突。旧归档不再是任何引用边的端点，`list_entries()` 默认只列
     活跃条目，加 `include_archived=True` 可连同归档枚举。载入时校验归档与分片的双向
     归属一致性，触及归档的边或缺失分片都会被明确拒绝。
6. **稳定查询**：`current_version` / `revision_chain` / `backlinks` /
   `diff_versions` 回答当前版本、完整修订链、被谁引用、任意两版差异；所有集合按
   标识字典序等稳定顺序返回。
7. **单文件持久化**：`persistence.save/load` 将条目、引用、修订历史、冲突记录、
   Lamport 逻辑时钟写入一个 JSON 文件（信封内含 `sha256` 校验和，写入为
   "临时文件 + fsync + 原子替换"）。载入时严格校验结构、版本连续性、悬空引用、环路
   与校验和；任何损坏或字段缺失都抛**清晰**的 `CorruptSnapshot`，且在临时对象上构建，
   **失败后既有对象状态不变**。

## 快速上手

```python
from experience_graph import ExperienceGraph, StaleRevision, MergeConflict
from experience_graph import persistence

g = ExperienceGraph()
g.create_entry("deploy", "部署", "准备\n发布\n验证", "alice")
g.create_entry("rollback", "回滚", "回滚步骤", "bob")
g.add_reference("deploy", "rollback")          # deploy -> rollback

# 不同段落：自动合并为 v1（与顺序无关）
g.integrate_revisions("deploy", [
    {"author": "bob",   "base_version": 0, "body": "准备-加强\n发布\n验证", "change": "强化准备"},
    {"author": "carol", "base_version": 0, "body": "准备\n发布\n验证-加观察", "change": "补充观察"},
])

# 过期修订：被拒绝并告知落后版本数
try:
    g.submit_revision("deploy", "dave", 0, "旧正文", "dave 的改动")
except StaleRevision as e:
    print(e.behind)        # 1

# 同段冲突：保留双方
try:
    g.integrate_revisions("rollback", [
        {"author": "u1", "base_version": 0, "body": "回滚-A", "change": "A"},
        {"author": "u2", "base_version": 0, "body": "回滚-B", "change": "B"},
    ])
except MergeConflict as e:
    print(e.records[0].rendered)

persistence.save(g, "graph.json")
g2 = persistence.load("graph.json")             # 完整往返
```

## 设计说明：为什么合并是确定的

正文按行切分为段落。对"基准版本 → 修订后正文"用 LCS 对齐，得到对基准每个段落槽位的
确定性意图（保留 / 删除 / 替换）及槽位间插入。多方集成时逐槽位归并：

* 只有一方修改 → 采用之（不同段落于是可干净合并）；
* 出现两种及以上互斥的非保留意图 → 该槽位冲突，保留全部主张方。

由于判定只依赖"各方意图的多重集合"（相同内容归一、各方按作者排序展示），结果不依赖
到达次序；冲突文本也因此稳定可复现。
