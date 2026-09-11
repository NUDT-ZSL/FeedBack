# sortmerge — 增量式字符串排序与归并内核

用在日志归并和分片排序场景的可嵌入内核：上游持续推入一批批字符串条目，
内核随时支持按字典序输出全量有序结果、输出某个前缀/区间片段，以及把多个
分片的有序结果归并成一条流。纯 Python 标准库实现，无第三方依赖，可离线
运行、可单测。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `sortmerge.py` | 内核模块：`Entry`、`SortMergeKernel`、`MergeIterator`、`merge_shards` |
| `main.py` | 命令行入口：stdin 逐行读 JSON 命令，stdout 逐行写 JSON 结果 |
| `test_sortmerge.py` | unittest 测试（含与 `sorted` 参考实现的随机对照） |

运行测试：

```bash
python -m unittest test_sortmerge -v
```

## 数据模型

```python
from sortmerge import Entry

e = Entry(key="user-042/login", tag="shard-a", seq=17)
```

* `key`：非空字符串，UTF-8 编码后不超过 256 字节。
* `tag`：非空字符串，表示来源分片，便于排查。
* `seq`：整数，同一 tag 内单调递增，从 1 开始。

`key` 为空、`tag` 为空、`seq < 1`（或类型不对）都会抛出 `ValidationError`。
排序规则为 **`(key, tag, seq)` 升序**；相同 key 的不同 tag 条目全部保留，
不去重。字符串比较使用 Python `str` 序——UTF-8 编码保持码点序，因此它与
"按 key 的 UTF-8 字节序"完全等价。

## 核心结构：分片式有序缓冲

每个 tag 维护自己的有序块列表：

* 新条目进入当前**活跃块**，通过二分插入保持块内有序；
* 活跃块写满 `block_size`（默认 1024，可配置）条后**冻结**为不可变元组，
  冻结时做一次内部排序确认；
* 全量/范围/前缀输出都基于**堆式多路归并迭代器**（`MergeIterator`），
  每次从各块当前头部取最小条目，单条代价 O(log 块数)，
  **不会每次输出都把全量数据重新排序**。

## API 一览

```python
from sortmerge import SortMergeKernel, merge_shards

k = SortMergeKernel(block_size=1024, max_entries=None)

k.insert(Entry("apple", "t1", 1))        # 插入；超限时抛 CapacityError
k.range_scan("app", "b")                 # [start, end) 内按 (key,tag,seq) 升序
k.prefix_scan("app")                     # 所有以 "app" 开头的条目
k.top(10)                                # 最小的 10 条
k.delete("apple", "t1")                  # 精确删除，返回删除条数（不存在返回 0）
k.dump()                                 # 全量有序列表
k.iter_sorted()                          # 全量有序迭代器（惰性）
k.stats()                                # 统计信息
k.save("snap.json")                      # 持久化快照
k2 = SortMergeKernel.load("snap.json")   # 重建并校验一致性
merge_shards([k, k2])                    # 多内核归并迭代器，不修改原内核
```

### 查询语义

* `range_scan(start_key, end_key)`：返回 `[start_key, end_key)` 区间，
  `start_key >= end_key` 返回空列表。利用块内有序二分定位起点，
  再顺序扫描到区间边界。
* `prefix_scan(prefix)`：返回所有 key 以 `prefix` 开头的条目。
  同样二分定位起点、扫描到前缀上界，不做全量扫描；
  `prefix == ""` 返回全部条目。
* `top(k)`：最小的 k 条；`k <= 0` 返回空。
* `delete(key, tag)`：移除该 tag 下该 key 的所有条目（可能有多条不同
  seq），返回移除条数；组合不存在返回 `0`（明确结果，不静默成功），
  删除后任何查询都不会再返回被删条目。
* `merge_shards(kernels)`：把多个内核的有序结果归并成一个迭代器，
  不修改原内核。

## 内存上限策略（重要）

构造时可指定 `max_entries` 限制总条目数：

* **有界模式**（`max_entries=N`）：插入会使总数超过上限时，
  **拒绝本次插入**并抛出 `CapacityError`，内核状态保持不变——
  绝不静默丢弃已有或新到的数据。`max_entries=0` 时拒绝一切插入。
  删除条目腾出空间后可继续插入。`stats()["capacity_remaining"]`
  可查询剩余容量。
* **精确模式**（`max_entries=None`，默认）：无上限，用于小规模对照。

## 持久化格式

`save(path)` 写入 JSON 快照（先写临时文件再原子替换），内容包括：

```json
{
  "format": "sortmerge-snapshot",
  "version": 1,
  "config": {"block_size": 1024, "max_entries": null},
  "shards": {
    "tag-a": {
      "blocks": [[{"key": "...", "tag": "tag-a", "seq": 1}, ...]],
      "active": [{"key": "...", "tag": "tag-a", "seq": 2}]
    }
  },
  "stats": {"total_entries": 2, "num_tags": 1, "num_frozen_blocks": 1}
}
```

`load(path)` 重建状态并做一致性校验，任一不满足即抛 `PersistenceError`：

* 文件可读取、是合法 JSON、格式标识与版本匹配；
* 每个块内按 `(key, tag, seq)` 升序；
* 块大小不超过配置的 `block_size`；
* tag 非空、条目 tag 与所属分片一致；
* `seq >= 1`（与 Entry 校验规则一致）；
* 统计计数非负，且 `total_entries` 与实际条目数一致。

文件损坏、字段缺失、类型错误都会给出带具体位置信息的错误，绝不静默吞掉。

## 命令行入口

```bash
python main.py [--block-size N] [--max-entries N]
```

从标准输入逐行读 JSON 命令，每条命令输出一行 JSON 结果；
错误以 `{"error": "..."}` 返回，进程继续处理后续命令。

| 命令 | 示例 | 输出 |
| --- | --- | --- |
| insert | `{"cmd":"insert","key":"a","tag":"t","seq":1}` | `{"ok": true}` |
| range | `{"cmd":"range","start":"a","end":"c"}` | `{"entries": [...]}` |
| prefix | `{"cmd":"prefix","prefix":"a"}` | `{"entries": [...]}` |
| top | `{"cmd":"top","k":10}` | `{"entries": [...]}` |
| delete | `{"cmd":"delete","key":"a","tag":"t"}` | `{"deleted": 1}` |
| merge | `{"cmd":"merge","paths":["snap2.json"]}` | `{"entries": [...]}` |
| stats | `{"cmd":"stats"}` | 统计信息 |
| save | `{"cmd":"save","path":"snap.json"}` | `{"ok": true}` |
| load | `{"cmd":"load","path":"snap.json"}` | `{"ok": true}` |
| dump | `{"cmd":"dump"}` | `{"entries": [...]}` |

`merge` 把当前内核与 `paths` 指定的若干快照文件（各自加载为内核）做有序
归并输出，不修改任何内核；`paths` 省略时等价于 `dump`。

## 错误类型

| 异常 | 含义 |
| --- | --- |
| `ValidationError` | 条目或参数非法（空 key/tag、seq < 1、key 超 256 字节等） |
| `CapacityError` | 插入超过 `max_entries` 上限，本次插入被拒绝 |
| `PersistenceError` | 快照文件损坏、字段缺失或一致性校验失败 |

三者都继承自 `KernelError`。
