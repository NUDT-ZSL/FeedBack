# 多租户连接池与通道复用内核（connpool）

边缘网关上游连接治理内核：在到各后端的**有限条长连接**上复用请求，
保证多租户之间互不拖垮，所有占用与释放**可追溯、可复现**。

- **纯标准库**：仅依赖 Python 3.10+ 标准库，零第三方包
- **不接真实网络**：连接是可审计的逻辑通道句柄
- **逻辑时钟**：`ManualClock` 手动推进，`advance` 自动驱动 TTL 回收与排队超时
- **完全离线**：`python -m unittest` 与 `python demo.py` 无需网络

## 快速开始

```bash
python demo.py                 # 离线演示完整时间线
python -m unittest discover -s tests -v   # 84 个单元/并发测试
```

```python
from connpool import PoolKernel, ManualClock, PoolConfig

clock = ManualClock(start=0)
k = PoolKernel(clock)
k.add_pool(PoolConfig(
    pool_id="orders", capacity=2, idle_ttl=100, max_queue=-1,
    quotas={"a": 1, "b": 2}))   # 配额之和可以超容量

r = k.acquire("orders", "a", purpose="GET /orders/1")
conn_id = r.connection_id       # 立即拿到 -> "orders-1"
...
clock.advance(20)               # 推进逻辑时钟
k.release("orders", conn_id, "a")
```

## 需求与实现对照

| # | 需求 | 实现 |
|---|------|------|
| 1 | 池唯一标识/容量/空闲集/隔离配置；零容量、重复 ID 拒绝 | `PoolKernel.add_pool` + `PoolConfig.validate`；`PoolExistsError` / `InvalidConfigError` 带原因码与中文说明 |
| 2 | 同租户空闲优先；未满新建；满则排队或拒绝并说明池与原因 | `acquire`：亲缘复用 → 新建 → 排队；`PoolSaturatedError` / `QueueRejectedError(QUEUE_FULL)` |
| 3 | 租户独立配额，打满不占他人份额；配额和可超容量、实际占用不超 | 配额只约束**借出中**计数；`TenantQuotaExceededError`；每笔借出前双重校验 |
| 4 | 借出记录租户/时刻/用途；重复与错归属归还拒绝且不改状态 | `release` 三态校验（不存在 / `DOUBLE_RELEASE` / `WRONG_TENANT`） |
| 5 | TTL 与收缩安全回收；不中断在用连接；计数不泄漏 | 空闲立即回收；借出连接打 `retire_on_return`，归还后关闭；收缩允许低于在用数（不中断），容量作为稳态上限立即生效 |
| 6 | 不健康/下线停借、空闲回收、归还不复用；恢复后可用 | `mark_unhealthy` / `mark_down` / `mark_healthy` |
| 7 | 容量/已用/空闲/排队、租户占用配额、连接归属与借出时长，稳定排序 | `pool_stats` / `all_pool_stats` / `tenant_usage` / `all_tenant_usage` / `connection_view` / `all_connections`，均按 ID 字典序 |
| 8 | JSON 快照保存/重载，严格校验，失败不改内存 | `save_json` / `load_json`（原子写）；两阶段恢复：本地构建并全量校验通过后整体替换 |

## 分配规则（借出优先级）

1. **健康检查**：池 `unhealthy`/`down` 直接拒绝（`POOL_UNHEALTHY`）；
2. **同租户亲缘复用**：空闲集中 `last_tenant` 匹配的连接优先（最近空闲的一条）；
3. **配额检查**：租户当前借出数达到其配额则不新建、也不动用他人通道
   （`TENANT_QUOTA_EXCEEDED`）；
4. **新建**：物理连接数（空闲+借出）小于容量时新建；
5. **池满复用空闲通道**：若存在其他租户归还的空闲通道：
   - 排队者按 FIFO 可复用（空闲通道不占任何租户配额，不违反隔离）；
   - 直接请求仅在无排队者时可复用，**不得插队**；
6. 否则按 `max_queue` 排队（`-1` 无限 / `0` 不排队 / 正数为上限）或拒绝
   （`POOL_SATURATED` / `QUEUE_FULL`）。

## 排队

```python
# 非阻塞：拿不到就拿票据
r = k.acquire("orders", "a", wait=False)
assert r.is_queued
k.ticket_status("orders", r.ticket.ticket_id)   # waiting/fulfilled/...
k.cancel_ticket("orders", r.ticket.ticket_id)

# 阻塞：归还发生时由条件变量唤醒；timeout 为逻辑 tick
r = k.acquire("orders", "a", wait=True, timeout=50)
```

队列出队在每次 `release` / `mark_healthy` / `set_quotas` / 时钟跳变时
由内部 `_pump` 驱动；队首若因自身租户配额打满而暂时无法服务，则
**保留位置继续等待**，不允许后面的请求插队。

## 回收语义

- **TTL**：空闲时长 `now - idle_since >= idle_ttl` 的连接按最老优先回收
  （`idle_ttl < 0` 永不过期）。时钟每次 `advance/set` 自动清扫；
- **收缩** `shrink_pool(pool, new_capacity)`：先关空闲，仍超额的借出连接
  打归还即关标记；`new_capacity` 必须为正，在用连接绝不中断；
- **摘流**：空闲全部回收，全部借出连接打标记，归还即关；恢复健康后新建。
- 每次关闭事件都带原因：`idle_ttl` / `shrink` / `manual_retire` /
  `retire_on_return` / `pool_unhealthy` / `pool_down`。

## 可追溯：审计事件

每次状态变化追加一条不可变事件（`seq` 连续、`at` 为逻辑时刻）：

```python
k.events("orders")
# [{'seq': 1, 'at': 0, 'kind': 'pool_created', 'pool_id': 'orders', ...},
#  {'seq': 2, 'at': 0, 'kind': 'connection_created', 'conn_id': 'orders-1', ...},
#  {'seq': 3, 'at': 0, 'kind': 'connection_borrowed', 'tenant': 'a', 'reused': False, ...},
#  ...]
```

事件类型：`pool_created`、`quotas_updated`、`pool_resized`、
`pool_health_changed`、`connection_created/borrowed/released/idled/closed`、
`connections_marked_by_shrink`、`connection_marked_retire`、
`request_queued/fulfilled/cancelled/expired`。

事件账目恒等式（`tests/test_08_concurrency.py` 在压力下校验）：

```
created - closed              == 当前连接数
borrowed - released           == 当前借出数（稳态为 0）
sum(tenant_in_use)            == used
used + idle                   <= capacity
tenant.used                   <= tenant.quota
```

## 快照与复现

```python
from connpool import save_json, load_json
save_json(k, "snapshot.json")          # 原子写（临时文件 + rename）
k2 = load_json("snapshot.json")        # 全新内核
# 或载入进已有内核：校验失败时该内核内存状态完全不变
load_json("snapshot.json", kernel=k)
```

快照包含：`schema_version`、`clock_now`、每池的配置/健康/连接/
租户占用/排队请求/自增序号，以及完整审计事件。载入校验包括：

- 顶层与各字段存在性、类型（bool 不允许冒充 int，可空字段必须显式 `null`）；
- 容量为正、配额非负、`max_queue ∈ {-1, 0, 正整数}`、健康状态合法；
- 连接状态自洽（借出必有租户与 `borrowed_at`；空闲必有 `idle_since`
  且不携带退役标记；`borrowed_at >= born_at`）；
- `tenant_in_use` 与按连接归属的统计**逐租户相等**；占用 ≤ 配额；
- 空闲数/借出数不超过容量；超额瞬态只可能是“借出且已标记归还即关”；
- 连接 ID / 票据号不重复且不越过 `next_seq`；空闲队列按 `idle_since` 升序；
- 已兑现票据绑定关系自洽（已被关闭的连接作为历史记录保留）；
- 审计事件 `seq` 连续。

快照输出是确定性的（池、连接、租户均稳定排序），因此
**保存→恢复→再保存逐字节一致**；从同一快照执行相同操作序列得到相同状态
（见 `test_restore_is_idempotent_and_reproducible` /
`test_replay_deterministic_from_snapshot`）。

## 模块结构

```
connpool/
  clock.py     Clock 协议、ManualClock（跳变监听驱动内核）、SystemClock
  errors.py    PoolError 体系与 Reason 原因码
  model.py     PoolConfig / Connection / QueuedRequest / 查询视图
  kernel.py    PoolKernel（借还、配额、排队、回收、健康、查询、审计）
  snapshot.py  JSON 序列化与两阶段严格恢复
tests/         9 个测试文件，84 个用例（含多线程压力测试）
demo.py        离线时间线演示
```

## 线程模型

内核用一把可重入锁 + 条件变量保护全部状态；`ManualClock` 的跳变回调在
时钟锁外执行，不存在锁序倒置。阻塞 `acquire(wait=True)` 等待在内核条件
变量上，`release` / 健康恢复 / 时钟推进都会唤醒等待者；`SystemClock`
下以 10ms 轮询兜底。
