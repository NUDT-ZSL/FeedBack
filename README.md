# consensus — 确定性 Raft 共识内核

纯标准库、完全离线可测的 Raft 式共识内核，面向分布式课程实验、协议回归、
确定性重放与故障注入。**不接真实网络**：没有线程、没有 socket、没有
`time.time`、不碰 `random` 全局态。输入输出都是纯数据。

## 目录结构

```
consensus/
  node.py           ConsensusNode：三态状态机、选举、复制、快照
  log.py            Log / LogEntry：带快照压缩的复制日志
  messages.py       Envelope 与各类消息（不可变 dataclass）
  random_source.py  DeterministicRandom：xorshift64*，种子决定一切
  errors.py         带上下文的异常体系
tests/
  harness.py        Cluster：内存集群、分区注入、transcript 记录
  test_election.py  test_replication.py  test_snapshot.py
  test_edge_cases.py  test_acceptance.py
```

## 快速上手

```python
from consensus import ConsensusNode, Role

nodes = {nid: ConsensusNode(nid, [p for p in "ABC" if p != nid], seed=i)
         for i, nid in enumerate("ABC")}

def pump():
    moved = True
    while moved:
        moved = False
        for n in nodes.values():
            for env in n.drain_outbox():
                nodes[env.to].deliver(env)   # 显式投递，节点自己不发送
                moved = True

# 推进逻辑时钟直到选出 Leader
while not any(n.role is Role.LEADER for n in nodes.values()):
    for n in nodes.values():
        n.tick()
    pump()

leader = next(n for n in nodes.values() if n.role is Role.LEADER)
leader.propose("set x 1")
pump()
```

## 接口一览

| 方法 | 说明 |
| --- | --- |
| `tick()` | 推进逻辑时钟一步；触发选举超时与心跳 |
| `set_random_source(seed)` | 重置确定性随机源（选举超时区间） |
| `propose(command)` | 仅 Leader；返回新条目的 index，否则抛 `NotLeaderError` |
| `request_vote(candidate_id, term, last_log_index, last_log_term)` | 返回带 `term`/`granted` 的响应 |
| `append_entries(leader_id, term, prev_log_index, prev_log_term, entries, leader_commit)` | 返回带 `term`/`success` 的响应，失败时附 `conflict_index`/`conflict_term` 供 Leader 快速回退 |
| `deliver(envelope)` | 显式投递消息；响应进入 outbox，用 `drain_outbox()` 取出 |
| `apply(commit_index=None)` | 按序喂给 `apply_fn`；重复应用是幂等 no-op，越过 commit_index 抛 `CommitIndexError` |
| `take_snapshot(index, data)` / `install_snapshot(index, term, data)` | 日志压缩 / 落后节点追赶 |
| `state_snapshot()` | 可 JSON 序列化的状态视图，用于重放比对 |

## 设计要点

- **确定性**：同一 seed + 同一事件序列 ⇒ 逐字节相同的输出
  （`tests/test_acceptance.py` 里有重放两次比对的验收）。
- **Pre-Vote**：分区少数派拿不到多数派预投票，永远不会自增任期，
  不会干扰健康多数派。
- **提交规则**：只有当前 term 的条目在多数派上复制后才推进
  `commit_index`（旧 term 条目随之间接提交）；`commit_index` 单调，
  已提交条目被拒绝覆盖时会抛 `ConsensusError` 而不是静默回滚。
- **快速回退**：`AppendEntriesReply` 携带冲突条目的 term 及其首 index，
  Leader 一次跳过整个冲突 term。
- **错误不静默**：任期过期、日志空洞、快照 index 越界、投错节点的消息
  等都会抛带上下文字段的异常（见 `consensus/errors.py`）。

## 运行测试

```
python -m unittest discover -s tests -t . -v
```
