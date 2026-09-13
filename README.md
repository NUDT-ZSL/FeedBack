# btree-index — 可持久化的 B+ 树字符串索引

一个**仅依赖 Python 标准库**、可离线运行、带崩溃恢复的嵌入式有序索引。

- 键：非空字符串，UTF-8 编码后 ≤ 256 字节，按字典序比较。
- 值：字符串，可为空，UTF-8 编码后 ≤ **1 MiB**。超过单个叶子页容量的值
  自动存入**溢出页链**，叶子里只保留引用——128 字节页大小下也能完整存
  取 1 MiB 的值。
- B+ 树：数据只存叶子；叶子用 `next_leaf` 指针串成链表，范围扫描顺序
  遍历，不从根重复搜索。
- 固定大小的**页**（默认 4 KiB，可配置，最小 128 字节），每个页一个文件。
- 插入时**按字节均衡的多页分裂**；删除下半满时优先**合并**，合并不下则
  从兄弟页**重分布（借键）**；结构性不足（空叶子 / 内部页孩子 < 2）无条件
  修复；根页随分裂升高、随合并坍缩。
- 每页写盘前计算 `SHA-256` 前 8 字节校验和，读盘立即校验，损坏抛出带
  `page_id` 的 `ChecksumMismatchError`，绝不静默返回坏数据。
- **WAL**：每次 `put`/`delete` 先 `fsync` 追加日志再改内存；崩溃后重放未
  checkpoint 的记录。半条日志自动跳过并在再次追加前截断。
- **checkpoint 回滚日志（rollback journal）**：checkpoint 中途掉电时，重启
  先按 journal 把被改动的文件恢复到 checkpoint 前状态，再由 WAL 重放，
  保证刷页与清单提交的原子性（要么全旧、要么全新）。
- 清单 `manifest.json` 记录根页、页大小、全部页 id（含溢出页）与空闲页
  列表，自带校验和；清单丢失时可扫描页文件重建。

## 文件结构

```
btree_index/
    __init__.py     公共 API
    btree.py        B+ 树主体：分裂 / 合并 / 重分布 / 溢出页 / 恢复 / 持久化
    page.py         页（叶子 / 内部页 / 溢出页）序列化、校验和
    wal.py          追加式预写日志（newline-framed JSON）
    exceptions.py   异常层级
main.py             命令行入口（stdin 逐行读 JSON 命令）
test_btree_index.py unittest 测试（56 个用例）
acceptance_demo.py  端到端验收演示（两万键、删 85%、崩溃、溢出页、坏页、截断 WAL）
stress_test.py      随机交错增删改（含溢出值）+ 随机崩溃重开的压测脚本
```

## 快速开始

```python
from btree_index import BTreeIndex

idx = BTreeIndex("./data", page_size=4096)   # 目录不存在会自动创建
idx.put("alice", "1")
idx.put("bob", "x" * 100_000)                # 自动走溢出页
idx.get("alice")                             # '1'（溢出值对调用方透明）
idx.get("nobody")                            # None
idx.scan("a", "c")                           # [('alice','1'), ('bob', ...)]，半开区间 [a,c)
idx.delete("alice")                          # True；删除溢出值时整链回收进空闲表
idx.delete("alice")                          # False（删除不存在的键是 no-op）
idx.stats()                                  # 树高 / 页数 / 溢出页数 / 已用字节 / 空闲页数
idx.dump()                                   # 按 page_id 排序的全部页快照（含溢出页）
idx.checkpoint()                             # 刷脏页 + 清单，并截断 WAL
idx.close()                                  # flush WAL；未 checkpoint 的改动重开时靠 WAL 重放
```

重开就是正常构造：打开时自动校验所有树页和溢出链、校验父子指针与叶子链
完整性、重放 WAL。**构造时传入的页大小只在建库时生效**；页大小在建库
瞬间就随初始 manifest 持久化，重开时以清单为准（例如用默认参数重开一个
192 字节的库，仍按 192 字节工作）。

## 命令行

```bash
python main.py --dir ./data [--page-size 4096]
```

标准输入每行一个 JSON 命令，标准输出每行一个 JSON 结果；错误也输出
JSON，含 `error` 与 `error_type`，校验和错误另外带 `page_id`。

```jsonc
{"op":"put","key":"k","value":"v"}
{"op":"get","key":"k"}                 // {"key":"k","found":true,"value":"v"}
{"op":"delete","key":"k"}              // {"key":"k","deleted":true}
{"op":"scan","start":"a","end":"z"}    // start/end 均可省略
{"op":"stats"}                          // 含 overflow_pages / overflow_entries
{"op":"dump"}                           // 溢出页与 @overflow 引用也可见
{"op":"checkpoint"}                     // 刷盘并截断 WAL
{"op":"save"}                           // 刷脏页 + 清单（保留 WAL）
{"op":"load"}                           // 关闭并从磁盘重新打开（含 WAL 重放）
{"op":"recover"}                        // 同 load，返回 replayed 记录数
```

## 磁盘格式

数据目录里每个页是名为其 `page_id` 的文件（`p-XXXXXXXX`，十六进制序号），
另有 `manifest.json`、`wal.log`，checkpoint 期间短暂出现 `journal.dat`。
树页和溢出页共用同一个 page-id 命名空间与空闲页表。

### 页格式

```
magic "BTPI"(4B) | format version(2B) | flags(2B) | sha256[:8](8B) | JSON payload
```

`flags`：位 0 = 叶子，位 1 = 根，位 2 = 溢出页。当前 format version = 2。
payload 是紧凑 UTF-8 JSON：

- 叶子：`{"id","leaf":true,"parent","items":[[key,value],...],"next_leaf"}`
- 内部页：`{"id","leaf":false,"parent","keys":[...],"children":[...]}`
- 溢出页：`{"id","ovf":true,"next","data":"<base64 原始字节>"}`

### 溢出页（oversized values）

当一条值连"只含该条目的最小叶子页"都装不进页大小时（判定时用真实
page_id/parent 构造探测文档精确计算字节数），值被外置：

1. 值按 UTF-8 编码为原始字节，按**溢出块容量**切片，容量通过二分求出
   （base64 与 JSON 固定字段算入开销，保证每个溢出页文件都不超过页大小）；
2. 切片逆序写成一条单链表：每个溢出页的 `next` 指向下一片，叶子条目值
   位置存引用 `{"ovf": head_page_id, "len": 字节数, "chunks": 块数}`；
3. `get`/`scan` 沿链顺序拼接、base64 解码后按 UTF-8 还原，长度不一致、
   链中断或指向树页都会在打开校验或读取时抛 `RecoveryError`；
4. 覆盖写或删除该键时，整条旧链的页 id 全部回收进空闲页表，文件在下次
   checkpoint 删除；id 会被后续分配复用。

128 字节页 + 1 MiB 值约产生 2.7 万个溢出页（base64 4/3 膨胀 + JSON 头），
checkpoint 采用批量暂存（逐文件 fsync 数据、一次目录 fsync 提交所有
rename），避免每页多次目录屏障。

### 清单 `manifest.json`

`root_id / page_size / next_page_id / pages[](树页+溢出页) / free_pages[]`，
带独立 SHA-256 校验和；写入走"临时文件 + fsync + 原子 rename"。建库时
立即写入一次初始清单，使页大小在第一次写操作之前就持久化。

### WAL `wal.log`

每行一条 JSON：`{"op":"put|delete","key":...,"value":...,"ts":...}`。
每条记录 `write + flush + fsync` 返回后操作才算确认。重放是幂等的
（put 覆盖、delete 幂等、溢出链按最终值重建），因此**重放后不立即全量
checkpoint**——旧页文件 + 同一条 WAL 再放一遍仍得到相同状态，重开很便宜；
显式 `checkpoint()` 时才把脏页落盘并截断 WAL。

### 回滚日志 `journal.dat`（checkpoint 原子化）

checkpoint 前先把所有将被覆写/删除/新建的文件的**当前镜像**（不存在则记
0 长度）顺序写入 journal 并 fsync；随后暂存全部新页、统一 rename、删除
死页、原子替换清单；最后删除 journal。重开时：

- journal 存在且完整 → 逐文件恢复旧镜像（0 长度记录则删除新文件），再走
  正常的"加载 + WAL 重放"；
- journal 被截断（torn，写 journal 时崩溃）→ 放弃回滚，删除 journal：此时
  旧清单尚未被替换（清单最后才原子提交），它引用的仍是一致的旧页集，多
  出来的新页文件作为垃圾在加载时清理。

## 分裂 / 合并 / 重分布规则

- **分裂**：页内字节超过 `page_size` 时触发。叶子和内部页共用同一套
  **按字节均衡分组**的动态规划（`_balanced_partition`）：先算出最少需要
  几组（每组满足页预算和最小组大小），再沿前缀选与"理想累计字节"最接近
  的边界，保证不会出现 32 条切成 31+1 那种极端不均；一次可切成多页。
  叶子分裂把新页链入叶子链表；中间键**复制提升**到父页（B+ 树）。内部页
  分裂时，**组边界上的分隔键提升到父页**（`keys[b-1]` 不属于任何一半），
  组内的键才随孩子走。父页满则继续向上分裂，根分裂时新建根。
- **下溢判定**：分两类。
  - *结构性不足*（无条件修复，与字节数无关）：非根叶子为空、内部页孩子
    少于 2。极小页大小下空叶子的固定元数据本身可能超过半页，因此不能只
    按字节判断。
  - *字节下溢*：页内容字节数低于 `page_size // 2`。
- **修复顺序**：结构不足时，兄弟有富余（叶子 ≥2 条 / 内部页 ≥3 个孩子）
  就**旋转一条**过来；两边都没有富余则与兄弟合并（合并结果可能暂时超页，
  与容忍的单大条目同理，下次插入再分裂），并向上继续处理因失去孩子而
  下溢的父页。字节下溢时，合并后不超预算就优先合并（父分隔键下拉，
  递归向上），否则从高于半满的兄弟页移动若干条目/孩子直到双方都达半满；
  内部页借键时父子分隔键做旋转。根只剩一个孩子时坍缩一层，树可一路退回
  单个空叶子。
- **分隔键陈旧修正**：删除的键可能曾被复制为某个祖先内部页的分隔键。
  删除并重平衡之后，以"仍承载该键邻域的叶子"为锚点沿父链向上，对路径
  左侧每一个分隔键用其子树真实首键重算（锚点始终是叶子，内部层合并不
  会丢失该刷新）。重开时 `_validate_ranges` 严格校验每个分隔键等于右子树
  首键，任何陈旧都会报 `RecoveryError`。

## 边界情况

| 情况 | 行为 |
| --- | --- |
| 空树 | 根为空叶子，`stats()['height']==0`，scan 为空 |
| 单键 / 空值 | 正常存取，空字符串是合法值 |
| 重复插入同键 | 覆盖旧值；旧值是溢出值时先回收旧链 |
| 删除不存在的键 | 返回 `False`，不写 WAL，无副作用 |
| 删空整棵树 | 坍缩回单个空叶子，溢出链全部回收，可继续使用（id 走空闲表复用） |
| 页大小过小 | `< 128` 抛 `InvalidPageSizeError` |
| 键超长 / 非 str / 空串 | 抛 `InvalidKeyError`（256 字节 UTF-8，非字符数） |
| 值超 1 MiB / 非 str | 抛 `InvalidValueError` |
| 大值 + 极小页 | 自动溢出页；128 字节页可存满 1 MiB，取回字节一致 |
| 页校验和损坏 | `ChecksumMismatchError`，消息含 `page_id` 与路径（树页/溢出页同） |
| 清单损坏 | 同上，`page_id == "manifest"` |
| 清单缺失 | 扫描全部页文件重建（要求恰好一个根），随后写回新清单 |
| 页文件缺失 / 多余 | 清单引用但文件缺失 → `RecoveryError` 指出 page_id；清单外的自有页形文件按垃圾清理，其他陌生文件报 `RecoveryError` |
| 父/子指针不一致、叶子链断裂、分隔键陈旧 | `RecoveryError` |
| 溢出链断链 / 成环 / 共享 / 指向树页 / 长度不符 / 孤儿溢出页 | `RecoveryError`（打开时全量校验） |
| WAL 半条记录 | 重放停在坏行前；再次打开追加前自动截掉坏尾巴，新记录不会被粘住 |
| checkpoint 中途崩溃 | journal 回滚到 checkpoint 前状态，再重放 WAL；journal 自身 torn 时保留旧清单旧页 |
| 空目录里只剩 WAL | 以空叶子为基线重放日志 |

## stats / dump

`stats()` 返回：

```text
height            树高（空树为 0，单叶子有数据为 1）
page_count        树页 + 溢出页总数
tree_pages        树页数
leaf_pages        叶子页数
inner_pages       内部页数
overflow_pages    溢出块页数
overflow_entries  值存放在溢出链上的条目数
entry_count        叶子键值对总数
used_bytes        全部页文件字节数（树 + 溢出）
tree_bytes        仅树页字节数
overflow_bytes    仅溢出页字节数
free_pages        空闲页表长度（可复用页 id 数）
page_size/root_id
```

`dump()` 按 page_id 排序返回全部页的快照：树页含条目/键/孩子，叶子条目
里的溢出引用显示为 `{"@overflow": {overflow_head,length,chunks}}`，溢出页
显示 `{"is_overflow":true,"next_overflow","chunk_bytes",...}`。

## 运行测试

```bash
python -m unittest -v test_btree_index      # 56 个单元测试
python acceptance_demo.py                   # 端到端验收演示
python stress_test.py [seed] [ops]          # 随机压测（含溢出值、随机崩溃重开）
```

单元测试覆盖：基本增删改查与校验；多高度均衡分裂（验证不再有 31+1）；
内部页分裂边界键提升；删除触发的合并、旋转、借键；删祖先分隔键后多组
随机数据下重开校验通过；范围扫描边界；清空坍缩；溢出值的存储/拼回/
1 MiB@128B/UTF-8 字节精确/checkpoint/崩溃重放/覆盖回收/删除回收与 id
复用/坏块报错/伪造引用报错/dump 可见；校验和损坏；清单损坏与缺失重建；
WAL 追加/重放/幂等/半条截断；无 checkpoint 崩溃；checkpoint 中途崩溃
回滚；torn journal；存储页大小对重开的权威性；以及 CLI 的正常与错误输出。

## 限制与设计取舍

- 每条 WAL 和每次页写都 `fsync`，提供"调用返回即不丢"的持久性；批量装载
  时可先连续 `put` 再一次 `checkpoint()`（WAL 仍保证每条已确认写不丢，
  checkpoint 只决定页镜像何时跟上）。
- 溢出值不做去重/共享：同值写两次各有独立链，覆盖即回收旧链。
- 这是单进程嵌入式索引，没有并发写锁；多进程同时写同一目录不在支持范围。
- 扫描结果整体在内存中组装返回；超大规模范围遍历可按叶子链表增量读取
  （页结构已为此预留 `next_leaf`），当前 API 选择了简单的列表返回。
