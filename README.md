# MVCC 内存数据库内核

纯 Python 标准库实现的内存键值数据库内核，演示多版本并发控制（MVCC）下的
**快照隔离（Snapshot Isolation）** 与可见性判断。无第三方依赖，可离线运行、可单测。

## 文件

| 文件 | 说明 |
| --- | --- |
| `mvcc.py` | 内核：版本链、事务、可见性判断、写写冲突检测、GC、JSON 持久化 |
| `main.py` | 命令行入口：从标准输入逐行读 JSON 命令，逐行输出 JSON 结果 |
| `test_mvcc.py` | unittest：可见性、冲突、只读事务、GC 边界、快照往返、错误处理 |

## 数据与事务模型

- **版本**：每个键一条版本链，版本含 `commit_ts`（全局单调递增整数）、
  `value`（字符串；`None` 为删除墓碑）、`txn_id`（产生者）。链按
  `commit_ts` 严格升序，不允许重复。
- **事务**：`txn_id`（非空唯一）、`state`（active / committed / aborted）、
  `snapshot_ts`（开始时已提交的最大 commit_ts）、`read_set`、`write_set`
  （键 → 新值，`None` 表示删除）、`start_seq`。

## 可见性规则

`get(txn_id, key)`：

1. 事务自己 write_set 里的未提交写入优先返回（自己删除的键返回 `None`）；
2. 否则沿版本链从新到旧找第一个 `commit_ts <= snapshot_ts` 的版本；
3. 找到墓碑返回 `None`，键不存在返回 `None`；
4. 快照之后提交的版本、其他事务未提交的写入，一律不可见。

## 写写冲突（first-committer-wins）

`put` / `delete` 只写 write_set，`commit` 时才落版本。提交时检查：若
`snapshot_ts` 之后有其他已提交事务写过本事务 write_set 中的任一键，本事务
**abort** 并返回冲突键列表；否则分配新 `commit_ts`，把 write_set 整体写成新版本。

## 快照隔离语义说明（重要）

- **只读事务**（write_set 为空）提交时不做任何冲突检查，直接 committed，
  且不分配 commit_ts。
- **读写混合事务只检查写集合**。读集合与其他事务的写集合相交**不会**导致
  abort —— 这是快照隔离的标准语义：它能防止脏读、不可重复读和写写冲突，
  但**允许写偏斜（write skew）**。例如两个事务各读对方的键、写不相交的键，
  两者都能提交，即使可串行化调度不允许这样的结果。需要可串行化时要在此
  之上加谓词锁 / SSI 等机制，本内核刻意不实现。

## 垃圾回收

`gc()` 的阈值 = 当前最老 active 事务的 `snapshot_ts`（无 active 事务时取当前
最大 commit_ts）。每个键保留所有 `commit_ts > 阈值` 的版本，外加小于等于阈值
的最新一个版本（保证阈值快照下仍有可见版本）。`commit_ts` 恰好等于阈值的版本
**必须保留**——最老事务的快照正好能看到它。返回清理掉的版本数。

## 持久化

`save(path)` 把版本链、事务表、commit_ts / start_seq 计数器写成一个 JSON
文件；`load(path)` 重建并校验：格式标识、字段类型、`txn_id` 唯一、
`commit_ts` 单调（计数器不落后于任何版本）、版本链严格升序、值只能是字符串
或 null（墓碑）、版本引用的 `txn_id` 存在且已提交、active 事务的
`snapshot_ts` 不超过计数器。任何损坏抛 `StorageFormatError`，不静默吞掉。

## 命令行用法

```bash
python main.py
```

标准输入每行一个 JSON 命令，标准输出每行一个 JSON 结果；错误以
`{"ok": false, "error": "..."}` 返回，不会中断后续命令。

```jsonc
{"cmd": "begin",  "txn_id": "t1"}            // {"ok": true, "txn_id": "t1", "snapshot_ts": 0}
{"cmd": "put",    "txn_id": "t1", "key": "a", "value": "1"}
{"cmd": "get",    "txn_id": "t1", "key": "a"}
{"cmd": "delete", "txn_id": "t1", "key": "a"}
{"cmd": "commit", "txn_id": "t1"}            // committed 或 {"status": "aborted", "conflicts": [...]}
{"cmd": "abort",  "txn_id": "t1"}
{"cmd": "gc"}                                 // {"ok": true, "collected": 2}
{"cmd": "state",  "txn_id": "t1"}
{"cmd": "save",   "path": "db.json"}
{"cmd": "load",   "path": "db.json"}
{"cmd": "dump"}                               // 完整内部状态
```

## 运行测试

```bash
python -m unittest test_mvcc -v
```
