# 边缘回传连接调度器

这个包解决“少量长连接、链路抖动、通道隔离要求不同”时的通道安置问题。

- 通道通过 `register_channel()` 声明优先级、并发上限和是否允许共享。
- 链路通过 `add_link(link_id, capacity)` 注册；`capacity=None` 表示链路本身不限制复用槽，整数表示最多承载的并发槽数。
- `allow_sharing=True` 的通道只允许和其他共享通道复用。
- `allow_sharing=False` 的通道必须独占整条链路；如果需要多个并发槽，会占用多条空闲链路或在剩余容量不足时降级。
- 调度严格按优先级从高到低处理；同优先级按注册顺序。高优先级通道先达到完整并发目标，剩余资源再给低优先级通道。
- 链路断开、恢复、通道增删都会原子重算整份分配快照，避免旧链路和新链路同时被认为占用。

## 分配状态

每个通道返回一个 `ChannelPlacement`：

- `FULL`：请求的并发槽全部满足。
- `DEGRADED`：获得至少 1 个槽，但受容量或隔离限制未达到并发上限；`reason_code` 和 `reason` 给出原因。
- `REJECTED`：没有任何可用槽，`granted == 0`，原因中列出不可用资源及占用者优先级。

`AllocationPlan.link_loads` 是链路到通道占用槽数的映射；断开的链路存在于快照中但负载为空。`decisions` 保留本次重算的人类可读决策链。

## 快速使用

```python
from relay_allocator import RelayConnectionScheduler

scheduler = RelayConnectionScheduler()
scheduler.add_link("link-a", capacity=4)
scheduler.add_link("link-b", capacity=1)

scheduler.register_channel(
    "telemetry",
    priority=10,
    concurrency_limit=2,
    allow_sharing=True,
)
scheduler.register_channel(
    "control",
    priority=20,
    concurrency_limit=1,
    allow_sharing=False,
)

failed = scheduler.link_failed("link-b")
for channel_id, placement in failed.placements.items():
    print(channel_id, placement.status, placement.granted, placement.reason)

recovered = scheduler.link_recovered("link-b")
```
