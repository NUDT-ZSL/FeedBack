# 边缘采集回传连接分配器

`relay_allocator` 用于在节点到中心的少量长连接之间安置业务通道，解决连接共享、通道隔离、容量预留、故障重安置和恢复后的状态一致性问题。

## 领域模型

- `Channel(channel_id, priority, concurrency_limit, shareable)`
  - `priority` 越大优先级越高。
  - `concurrency_limit` 表示必须保证的最大同时流/请求数。调度器按最坏值预留容量，而不是先超额接纳再在抖动时丢弃数据。
  - `shareable=False` 的通道必须独占整条链路；`True` 时只能和其他可共享通道共线。
- `Link(link_id, capacity, state)`
  - `capacity` 是该复用连接可同时承载的流/请求上限。
  - `state` 为 `UP` 或 `DOWN`，断开的链路不参与分配。
- `AllocationPlan`
  - `assignments`：当前被接纳的通道、链路、预留量和解释。
  - `rejections`：被拒绝通道的稳定原因码和人类可读原因。
  - `link_usages`：每条链路的预留量、剩余量和承载通道。

## 使用方式

```python
from relay_allocator import Channel, ConnectionRelay, Link

relay = ConnectionRelay()
relay.add_link(Link("uplink-a", capacity=8))
relay.add_link(Link("uplink-b", capacity=8))

relay.register_channel(
    Channel("telemetry", priority=10, concurrency_limit=3, shareable=True)
)
relay.register_channel(
    Channel("control", priority=8, concurrency_limit=2, shareable=True)
)
relay.register_channel(
    Channel("security", priority=5, concurrency_limit=1, shareable=False)
)

plan = relay.snapshot()
print(plan.assignments)
print(plan.link_usages)
```

链路故障和恢复通过原子重算完成：

```python
relay.mark_link_down("uplink-a")   # 迁移可迁移通道，无法满足时显式暂停低优先级通道
relay.mark_link_up("uplink-a")     # 重新评估并恢复被暂停通道
```

每次操作都会返回 `AllocationEvent`，可用于发布 `activated`、`migrated`、`suspended`、`restored` 或 `unregistered` 事件。完整状态仍以 `snapshot()` 为准。

## 调度规则

1. 按优先级从高到低处理；同优先级内先处理隔离要求更强的独占通道，再按并发需求和 ID 稳定排序。
2. 非共享通道只能进入空链路，并占用该链路；即使链路还有剩余容量，其他通道也不能进入。
3. 共享通道只能进入没有非共享通道、且剩余容量足够的链路。
4. 每次注册、注销、链路断开或恢复都重算完整目标分配，再原子替换旧快照。
5. 无法接纳时不会静默丢数据：通道进入 `rejections`，原因码可能是：
   - `NO_LINKS`
   - `CHANNEL_EXCEEDS_LINK_CAPACITY`
   - `NO_EXCLUSIVE_LINK`
   - `INSUFFICIENT_SHARED_CAPACITY`
6. 被拒绝或暂停的通道仍保留注册声明；链路恢复或容量释放后会再次参与调度。

调度器在常见的少量长连接规模内使用带回溯和状态记忆的精确搜索，避免因装箱顺序误拒可安置通道。搜索节点超过 50,000 后会切换为确定性贪心算法，并在分配/拒绝解释中明确标注启发式回退，避免大规模批量注册阻塞故障恢复。

## 一致性保证

- 任一活跃通道最多出现在一条当前可用链路上。
- 每条链路上的预留并发总和不超过容量。
- 非共享通道不会与任何通道共线。
- 断开链路不会出现在当前分配中。
- 恢复后通过完整重算释放旧占用，不会保留重复连接。

## 验证

运行全部测试：

```powershell
python -m unittest discover -s tests -v
```
