# btree-index — 可持久化的 B+ 树字符串索引

一个**仅依赖 Python 标准库**、可离线运行、带崩溃恢复的嵌入式有序索引。
键为非空字符串（UTF-8 编码后 ≤ 256 字节，按字典序比较），值为字符串
（可为空，UTF-8 编码后 ≤ 1 MiB）。

- B+ 树：数据只存叶子，叶子用 `next_leaf` 指针串成链表，范围扫描顺序遍历。
- 固定大小的**页**（默认 4 KiB，可配置，最小 128 字节），每页一个文件。
- 插入时**按字节均衡的多页分裂**；删除下半满时优先**合并**，合并不下则
  从兄弟页**重分布（借键）**；根页随分裂升高、随合并坍缩。
- 每页写盘前计算 `SHA-256` 前 8 字节校验和，读盘校验，损坏立即抛出带
  `page_id` 的 `ChecksumMismatchError`，绝不静默返回坏数据。
- **WAL**（write-ahead log）：每次 `put`/`delete` 先 `fsync` 追加日志再改
  内存；崩溃后重放未 checkpoint 的记录。半条日志自动截断/跳过。
- **checkpoint 回滚日志（rollback journal）**：checkpoint 中途掉电时，重启
  会把被覆写的页/清单恢复到 checkpoint 前状态，再由 WAL 重放，保证
  checkpoint 的原子性。
- 清单 `manifest.json` 记录根页、页大小、全部页 id 与空闲页列表，本身带
  校验和；清单丢失时可以扫描页文件重建。

## 文件结构

```
btree_index/
    __init__.py     公共 API
    btree.py        B+ 树主体：分裂 / 合并 / 重分布 / 恢复 / 持久化
    page.py         页的数据结构、二进制序列化、校验和
    wal.py          追加式预写日志（newline-framed JSON）
    exceptions.py   异常层级
main.py             命令行入口（stdin 逐行读 JSON 命令）
test_btree_index.py unittest 测试（42 个用例）
acceptance_demo.py  端到端验收演示（两万键、删 85%、崩溃、坏页、截断 WAL）
stress_test.py      随机交错增删改 + 随机重开的压测脚本
```

## 快速开始

```python
from btree_index import BTreeIndex

idx = BTreeIndex("./data", page_size=4096)   # 目录不存在会自动创建
idx.put("alice", "1")
idx.put("bob", "2")
idx.get("alice")            # '1'
idx.get("nobody")           # None
idx.scan("a", "c")          # [('alice', '1'), ('bob', '2')]  半开区间 [a, c)
idx.delete("alice")         # True
idx.delete("alice")         # False（删除不存在的键是 no-op）
idx.stats()                 # 树高 / 页数 / 叶子数 / 已用字节 / 空闲页数
idx.dump()                  # 按 page_id 排序的页快照（调试用）
idx.checkpoint()            # 刷脏页 + 清单，并截断 WAL
idx.close()                 # 只 flush WAL；未 checkpoint 的改动重开时靠 WAL 重放
```

重开就是正常构造：打开时自动校验所有页、校验父子指针与叶子链完整性、
重放 WAL。

```python
idx2 = BTreeIndex("./data")
```

## 命令行

```bash
python main.py --dir ./data [--page-size 4096]
```

标准输入每行一个 JSON 命令，标准输出每行一个 JSON 结果，错误也是 JSON
（含 `error` 与 `error_type`，校验和错误另外带 `page_id`）：

```jsonc
{"op":"put","key":"k","value":"v"}
{"op":"get","key":"k"}                 // {"key":"k","found":true,"value":"v"}
{"op":"delete","key":"k"}              // {"key":"k","deleted":true}
{"op":"scan","start":"a","end":"z"}    // start/end 均可省略
{"op":"stats"}
{"op":"dump"}
{"op":"checkpoint"}                    // 刷盘并截断 WAL
{"op":"save"}                          // 刷脏页 + 清单（保留 WAL）
{"op":"load"}                          // 关闭并从磁盘重新打开（含 WAL 重放）
{"op":"recover"}                       // 同 load，返回 replayed 记录数
```

示例：

```bash
printf '%s\n' \
  '{"op":"put","key":"hello","value":"world"}' \
  '{"op":"scan"}' \
  '{"op":"checkpoint"}' | python main.py --dir ./demo
```

## 磁盘格式

目录中每个页是一个名为其 `page_id` 的文件（如 `p-0000000a`），另有
`manifest.json`、`wal.log`，checkpoint 期间短暂出现 `journal.dat`。

### 页格式

```
magic "BTPI"(4B) | format version(2B) | flags(2B) | sha256[:8](8B) | JSON payload
```

`flags` 位 0 = 叶子，位 1 = 根。payload 是紧凑 JSON（叶子含
`items=[[key,value],...]` 与 `next_leaf`；内部页含 `keys` 与 `children`；
都含 `id` 与 `parent`）。最小 128 字节的页也能容纳若干条短键值（固定
元数据约 70 字节，其余留给条目）；单条**超过页大小**的值允许存在（该
叶子只放得下它一条），见下文“超大条目”。

### 清单 `manifest.json`

记录 `root_id / page_size / next_page_id / pages[] / free_pages[]`，带独立
SHA-256 校验和字段，写入走“临时文件 + fsync + 原子 rename”。

### WAL `wal.log`

每行一条 JSON：`{"op":"put|delete","key":...,"value":...,"ts":...}`。
每条记录 `write + flush + fsync` 后 `put`/`delete` 才返回。重放是幂等的
（put 覆盖、delete 幂等），因此**重放后不必立刻 checkpoint**，重开仍然
便宜且正确。

### 回滚日志 `journal.dat`

checkpoint 前先把所有将被覆写/删除的文件（旧页镜像、旧清单）顺序写入
journal 并 fsync；全部新页与新清单落盘后再删除 journal。重开时若发现
journal 存在，说明 checkpoint 未完成：先按 journal 把文件逐一还原（journal
里没有的文件直接删除），再走正常的“加载 + WAL 重放”。journal 自身被截断
（torn）时放弃回滚——由于 journal 在清单之前提交、清单最后原子替换，
旧清单仍然只引用旧页，状态依然一致。

## 分裂 / 合并 / 重分布规则

- **分裂**：页内字节超过 `page_size` 时触发。按各条目真实字节成本做
  “尽量均衡且每页不超预算”的动态规划分区，一次可以切成多页（用于单值
  大于页的情况）；叶子分裂把新页链入叶子链表，中间键**复制提升**到父页
  （B+ 树），内部页分裂时切分点上的键**提升**而不是留在任何一半；父页
  满则继续向上分裂，根分裂时新建根。
- **下溢判定**：删除后页内容字节数低于 `page_size // 2`。
- **合并优先**：若与左/右兄弟合并后不超页预算，直接合并，父分隔键随之下
  拉，父页少一个孩子后可能继续下溢并递归向上；根只剩一个孩子时坍缩一层，
  树可以一路退回单个空叶子。
- **重分布（借键）**：合并不下时，只要兄弟页高于半满就从其尾部/头部移动
  若干条目或（键,孩子）直到双方都达到半满；内部页借键时父子分隔键做
  旋转。删除的键若曾被复制为祖先分隔键，沿父链刷新对应分隔键。
- 单条超大值导致的“单条目页”无法再切，是规则允许的例外（见下）。

## 边界情况

| 情况 | 行为 |
| --- | --- |
| 空树 | 根为空叶子，`stats()['height']==0`，scan 为空 |
| 重复插入同键 | 覆盖旧值，页不新增 |
| 删除不存在的键 | 返回 `False`，不写 WAL，无副作用 |
| 删空整棵树 | 坍缩回单个空叶子，可继续正常使用（页 id 复用空闲表） |
| 页大小过小 | `< 128` 抛 `InvalidPageSizeError` |
| 键超长 / 非 str / 空串 | 抛 `InvalidKeyError` |
| 值超 1 MiB / 非 str | 抛 `InvalidValueError`（空字符串合法） |
| 页校验和损坏 | 抛 `ChecksumMismatchError`，消息含 `page_id` 与路径 |
| 清单损坏 | 同上，`page_id == "manifest"` |
| 清单缺失 | 扫描全部页文件重建（要求恰好一个根），随后写回新清单 |
| 页文件缺失（清单引用了它） | 抛 `RecoveryError` 并指出 page_id |
| 父子指针不一致 / 叶子链断裂 / 分隔键与子树不符 | 抛 `RecoveryError` |
| WAL 半条记录 | 重放时停在坏行前；再次打开追加前会把坏尾巴截掉 |
| checkpoint 中途崩溃 | journal 回滚到 checkpoint 前状态，再重放 WAL |
| 空目录里只剩 WAL | 以空叶子为基线重放日志 |

### 关于“超大条目”

允许值最大 1 MiB，可能远大于页大小。存储它的叶子会超过 `page_size`
且无法继续切分（一页一条）；这是显式允许的例外，其他页仍严格遵守预算。
删除它之后相关页会在后续合并中恢复正常占用率。如果业务要求“任何页都
不超过页大小”，应在应用层把大值拆成溢出块（本模块未实现）。

## 运行测试

```bash
python -m unittest -v test_btree_index      # 42 个单元测试
python acceptance_demo.py                   # 端到端验收演示（约 15 秒）
python stress_test.py [seed] [ops]          # 随机压测，默认 8000 次增删改
```

单元测试覆盖：基本增删改查、页分裂（多高度）、叶子链完整性、父子指针、
删除触发的合并与借键、范围扫描边界、清空坍缩、交错更新、校验和损坏、
清单损坏/缺失、WAL 追加/重放/幂等/半条截断、无 checkpoint 崩溃、
checkpoint 中途崩溃回滚、torn journal、输入校验、以及 CLI 的正常与错误
输出。

## 性能说明

每条日志和每个页写入都 `fsync`，默认提供“调用返回即不丢”的持久性；
在 Windows 上 fsync 相对昂贵，测试机上约 3k 次同步 `put`/秒。批量装载
时可以先批量 `put` 再一次 `checkpoint()`（WAL 仍保证每条已确认写不丢，
checkpoint 只决定页镜像何时跟上）。
