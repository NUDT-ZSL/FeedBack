"""离线可运行演示：多租户竞争下的连接池治理。

运行：python demo.py
全程由 ManualClock 驱动，不接网络，输出带时间线与审计轨迹，
可直接对照需求逐条验证。
"""

from __future__ import annotations

import json
import tempfile
import os

from connpool import (
    ManualClock,
    PoolConfig,
    PoolKernel,
    PoolError,
    SnapshotError,
    save_json,
    load_json,
)
from connpool.snapshot import kernel_to_dict, restore_from_text


def line(title: str) -> None:
    print(f"\n=== {title} " + "=" * (60 - len(title)))


def show(k: PoolKernel) -> None:
    for s in k.all_pool_stats():
        print(f"  池 {s.pool_id:<8} 容量={s.capacity} 已用={s.used} "
              f"空闲={s.idle} 排队={s.queued} 健康={s.health}")
    for u in k.all_tenant_usage():
        print(f"    租户 {u.tenant}@{u.pool_id:<6} 配额={u.quota} "
              f"占用={u.used} 剩余={u.available}")


def main() -> None:
    clock = ManualClock(start=0)
    k = PoolKernel(clock)

    line("1. 建池：容量 2，配额之和 3 可超容量，但实际占用不得超过容量")
    k.add_pool(PoolConfig(
        pool_id="orders", capacity=2, idle_ttl=100, max_queue=-1,
        quotas={"tenant-a": 1, "tenant-b": 2}))
    show(k)

    line("2. 借出：a、b 各占一条；a 再借因配额=1 被排队（不占 b 份额）")
    ca = k.acquire("orders", "tenant-a", "GET /orders/a1")
    cb = k.acquire("orders", "tenant-b", "POST /orders/b1")
    print(f"  a -> {ca.connection_id} @t={clock.now()}")
    print(f"  b -> {cb.connection_id} @t={clock.now()}")
    qa = k.acquire("orders", "tenant-a", "GET /orders/a2")
    print(f"  a 的第二个请求: status={qa.status} ticket=#{qa.ticket.ticket_id}")
    show(k)

    line("3. a 归还，同租户排队请求立即复用该通道（FIFO + 亲缘）")
    clock.advance(15)
    k.release("orders", ca.connection_id, "tenant-a")
    st = k.ticket_status("orders", qa.ticket.ticket_id)
    print(f"  票据 #{qa.ticket.ticket_id}: {st['status']} -> {st['conn_id']}")
    v = k.connection_view("orders", ca.connection_id)
    print(f"  连接当前归属={v.tenant} 用途={v.purpose} 已借时长={v.borrow_duration}")

    line("4. 错误归还被拒：b 试图归还 a 持有的连接，状态不变")
    try:
        k.release("orders", ca.connection_id, "tenant-b")
    except PoolError as e:
        print(f"  拒绝: {e}")
    v = k.connection_view("orders", ca.connection_id)
    print(f"  连接仍归 {v.tenant} 持有（状态未改变）")

    line("5. 摘流：后端不健康，停借、空闲回收、归还即关")
    k.mark_unhealthy("orders")
    print("  b 归还其连接 -> 摘流期间归还后不复用：")
    k.release("orders", cb.connection_id, "tenant-b")
    try:
        k.acquire("orders", "tenant-b", "should-fail")
    except PoolError as e:
        print(f"  新借出被拒: {e}")
    show(k)

    line("6. 恢复健康后重新接受请求")
    k.mark_healthy("orders")
    r = k.acquire("orders", "tenant-b", "after-recovery")
    print(f"  恢复后借出: {r.connection_id}")
    k.release("orders", r.connection_id, "tenant-b")

    line("7. TTL 空闲回收：推进逻辑时钟超过 idle_ttl=100")
    before = len(k.all_connections("orders"))
    clock.advance(200)
    after = len(k.all_connections("orders"))
    print(f"  回收前连接数={before}，推进 200 tick 后={after}")

    line("8. 快照保存/重载：审计轨迹逐事件可追溯")
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "snapshot.json")
        save_json(k, path)
        k2 = load_json(path)
        print(f"  快照文件: {path}")
        print(f"  重载后池列表={k2.list_pools()} 时钟={k2.clock.now()}")
        ev = k2.events("orders")
        print(f"  审计事件 {len(ev)} 条，最近 6 条:")
        for e in ev[-6:]:
            extra = {x: y for x, y in e.items()
                     if x not in ("seq", "at", "kind", "pool_id")}
            print(f"    #{e['seq']:<3} t={e['at']:<4} {e['kind']:<26} "
                  f"{json.dumps(extra, ensure_ascii=False)}")

    line("9. 损坏快照载入失败，现有内核内存状态不变")
    good = json.dumps(kernel_to_dict(k), ensure_ascii=False)
    bad = good.replace('"capacity": 2', '"capacity": 0', 1)
    stats_before = k.pool_stats("orders")
    try:
        restore_from_text(bad, kernel=k)
    except SnapshotError as e:
        print(f"  载入被拒: {e}")
    print(f"  原内核统计不变: {stats_before == k.pool_stats('orders')}")

    print("\n演示完成。")


if __name__ == "__main__":
    main()
