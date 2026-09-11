# Radix Index —— 可嵌入的基数树前缀索引内核

用于配置中心 / 服务发现场景的纯 Python（仅标准库）前缀索引：上游不断注册、
注销带字符串键的条目，支持按前缀快速列举、按最长公共前缀分组统计、以及
从磁盘快照恢复整棵树。无第三方依赖，可离线运行、可单元测试、不接网络。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `radix_index.py` | 内核模块：`Entry`、`RadixIndex`、结果类型与异常体系 |
| `main.py` | 命令行入口：stdin 逐行 JSON 命令，stdout 逐行 JSON 结果 |
| `test_radix_index.py` | `unittest` 测试套件（含随机对照参考实现的 fuzz 测试） |

## 数据模型

```python
@dataclass(frozen=True)
class Entry:
    key: str      # 非空字符串，UTF-8 编码后 ≤ 256 字节
    value: Any    # 任意可 JSON 序列化的对象
    owner: str    # 非空字符串，表示注册方
```

条目由 **`(key, owner)` 二元组唯一标识**。key 为空、key 超长、owner 为空、
value 不可 JSON 序列化都会抛出 `EntryValidationError`，错误信息说明具体原因。

## 核心策略（验收相关，务必阅读）

### 覆盖策略

- **同一 `(key, owner)` 重复注册：后注册覆盖先注册。** `insert` 返回
  `InsertResult(overwritten=True, previous_owner=..., previous_value=...)`，
  其中 `previous_owner` 标记被覆盖条目的 owner（当前策略下即注册方本人），
  `previous_value` 为旧 value。覆盖不占用新的容量额度。
- **同一 key、不同 owner：共存。** 服务发现里同一服务 key 可由多个实例
  （owner）注册，互不影响；`remove(key, owner)` 只移除指定 owner 的那一条。
- 不同 key 之间完全互不影响。

### 容量策略（max_entries）

- 构造时传入 `max_entries=N` 即启用条目总数上限。达到上限后再注册**新**
  条目会抛出 `CapacityError`（错误信息含当前上限与被拒绝的 key/owner），
  **本次注册不生效，不静默丢弃、不淘汰旧条目**。
- 覆盖已有 `(key, owner)` 不受上限限制；`remove` 释放的名额可再使用。
- `max_entries=0` 表示拒绝一切新注册（合法配置）。
- `max_entries=None`（默认）为**精确模式**：无上限，用于小规模对照。

### 路径压缩不变量

除根节点外，**不存在“自身不挂条目且只有一个孩子”的中间节点**。插入时的
段分裂与删除时的叶子回收、单子节点合并都会维护该不变量。可随时调用
`idx.assert_invariants()` 主动校验（违反时抛 `AssertionError`），
`load` 时也会强制校验。

## Python API

```python
from radix_index import RadixIndex, Entry, CapacityError, SnapshotError

idx = RadixIndex(max_entries=100_000)   # 或 RadixIndex() 精确模式

res = idx.insert("svc/api/v1", {"port": 8001}, owner="agent-1")
# InsertResult(key, owner, overwritten, previous_owner, previous_value, size)

entries = idx.prefix_scan("svc/")        # 按 key 的 UTF-8 字节序升序；"" 返回全部
stats   = idx.common_prefix_stats("svc/")
# {"prefix", "lcp", "lcp_length", "count", "distinct_keys", "owners"}
# 前缀下无条目时返回全零结果（lcp 为空串），不抛异常

res = idx.remove("svc/api/v1", "agent-1")
# RemoveResult(removed, key, owner, entry, reason, size)
# 组合不存在时 removed=False 且 reason 说明原因，不静默成功

idx.stats()                              # {"entries", "distinct_keys", "nodes", "max_entries"}
idx.save("snapshot.json")                # 原子写入（临时文件 + os.replace）
idx2 = RadixIndex.load("snapshot.json")  # 重建并做完整一致性校验
idx.dump()                               # 导出整棵树结构（可 JSON 化）
idx.assert_invariants()                  # 主动校验路径压缩不变量
```

说明：

- `prefix_scan` 沿压缩前缀树走到最长匹配节点再收集子树条目，不做全量扫描；
  前缀可以结束在某个压缩段的中间。排序按 key 的 UTF-8 字节序（与码点序一致），
  同一 key 的多 owner 条目按 owner 升序。
- `common_prefix_stats` 的 `lcp_length` 按**字符**计（多字节 UTF-8 key 也是
  字符数）；`count` 计条目数（同 key 多 owner 分别计数），`distinct_keys`
  计不同 key 数。

## 命令行入口

```bash
python main.py [--max-entries N]
```

从标准输入逐行读取 JSON 命令，每条命令输出一行 JSON：

| 命令 | 字段 | 结果 |
| --- | --- | --- |
| `insert` | `key, value, owner` | `InsertResult` 字典 |
| `remove` | `key, owner` | `RemoveResult` 字典 |
| `prefix` | `prefix` | `{prefix, count, entries:[{key,owner,value}...]}` |
| `common` | `prefix` | 最长公共前缀统计字典 |
| `stats` | — | `{entries, distinct_keys, nodes, max_entries}` |
| `save` | `path` | `{path, entries}` |
| `load` | `path` | `{path, entries}`（用快照替换当前索引） |
| `dump` | — | 整棵树的 JSON 结构 |

成功输出 `{"ok": true, "result": ...}`；失败输出
`{"ok": false, "error": "...", "error_type": "..."}`（包括命令本身不是合法
JSON、未知 op、缺少字段、校验失败、容量超限、快照损坏等情况）。

示例：

```bash
$ printf '%s\n' \
  '{"op":"insert","key":"svc/a","value":{"port":80},"owner":"agent-1"}' \
  '{"op":"prefix","prefix":"svc/"}' \
  '{"op":"common","prefix":"svc/"}' | python main.py
{"ok": true, "result": {"key": "svc/a", "owner": "agent-1", "overwritten": false, "previous_owner": null, "previous_value": null, "size": 1}}
{"ok": true, "result": {"prefix": "svc/", "count": 1, "entries": [{"key": "svc/a", "owner": "agent-1", "value": {"port": 80}}]}}
{"ok": true, "result": {"prefix": "svc/", "lcp": "svc/a", "lcp_length": 5, "count": 1, "distinct_keys": 1, "owners": {"agent-1": 1}}}
```

## 快照格式与一致性校验

`save(path)` 写入的 JSON 结构：

```json
{
  "format": "radix-index-snapshot",
  "version": 1,
  "max_entries": 100000,
  "root": {
    "segment": "",
    "entries": [{"key": "...", "owner": "...", "value": ...}],
    "children": [ {"segment": "svc/", "entries": [], "children": [...]} ]
  }
}
```

`load(path)` 重建时逐项校验，任一不满足即抛 `SnapshotError`（信息含出错
节点位置），不静默吞掉：

- 格式标识与版本匹配；必填字段（`segment` / `entries` / `children`）齐全；
- 非根节点前缀段非空，根节点段为空串；
- 同一节点的子节点前缀互不重叠（首字符唯一）；
- 路径压缩不变量成立（无“空条目 + 单孩子”的中间节点）；
- 条目 key 与节点完整路径一致（蕴含“以节点前缀开头”）、owner 非空、
  同一节点内 owner 不重复、key 长度合法；
- 条目总数不超过快照声明的 `max_entries`。

文件不存在、不是合法 JSON、字段缺失、结构损坏都会得到明确的
`SnapshotError`。

## 异常体系

```
RadixIndexError                # 基类
├── EntryValidationError       # 字段非法（同时是 ValueError）
├── CapacityError              # 超出 max_entries
└── SnapshotError              # 快照缺失 / 损坏 / 校验失败
```

## 运行测试

```bash
python -m unittest discover -v
```

测试覆盖：字段校验、覆盖策略、多 owner 共存、前缀查询（含多字节 UTF-8、
空前缀、无匹配、段中间结束）、公共前缀统计、删除后的叶子回收与节点合并、
路径压缩不变量（含 3000 次随机操作逐步校验）、容量上限（含 `max_entries=0`
与精确模式）、快照往返与恢复后继续写入、各类损坏快照的报错、CLI 全命令
会话与错误输出，以及两个与“sorted + 线性扫描”参考实现对照的随机 fuzz
测试（4000 步混合负载、快照往返后继续 1500 步）。

## 复杂度

设 `L` 为 key 长度（≤ 256 字节）、`k` 为匹配结果数：

- `insert` / `remove`：`O(L)` 次字符比较（与树高同阶，与条目总数无关）；
- `prefix_scan`：`O(L + 匹配子树大小)` 定位加收集，外加 `O(k log k)` 排序；
- `common_prefix_stats`：一次 `prefix_scan` 加对结果的线性统计；
- `save` / `load`：`O(总条目数 + 节点数)`。
