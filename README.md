# 离线消息总线内核（Message Bus Kernel）

纯 Python 标准库实现的**离线可验收**消息总线：按主题路由、按优先级投递、
消费者慢/掉线时背压与订阅恢复、JSON 快照持久化。不依赖任何第三方库、
不接真实网络，时间由**可注入的逻辑时钟**驱动，因此可以完全确定性地
离线运行与单元测试。

- Python 3.10+（仅标准库：`dataclasses` / `enum` / `json` / `argparse` / `unittest`）
- 文件：
  - `bus.py` —— 总线内核（`MessageBus` / `Message` / 策略枚举 / `BusError`）
  - `main.py` —— 命令行入口，stdin 逐行读 JSON 命令，stdout 逐行输出 JSON
  - `test_bus.py` —— 69 个 unittest 用例

---

## 1. 快速开始

### 作为库使用

```python
from bus import MessageBus, OverflowPolicy, UnsubscribePolicy

b = MessageBus(overflow_policy=OverflowPolicy.DROP_LOWEST,
               unsubscribe_policy=UnsubscribePolicy.TRANSFER)

b.subscribe("worker-a", topics=["orders"], min_priority=1,
            max_inflight=10, max_queue=100, ack_timeout=30)

b.publish({"msg_id": "m-1", "topic": "orders", "priority": 5,
           "payload": {"id": 42}, "produced_at": 100})

batch = b.deliver("worker-a", max_messages=10)   # 只拉取，不自动推送
for m in batch["messages"]:
    do_work(m)
b.ack("worker-a", "m-1")                         # 单条确认
b.ack_up_to("worker-a", "m-1")                   # 或按投递游标批量确认

b.set_online("worker-a", False)                  # 模拟掉线：未确认消息回队
b.save("state.json")                             # 快照
b2 = MessageBus.load("state.json")               # 重建并做一致性校验
```

### 注入逻辑时钟（确定性测试）

默认使用总线内部时钟，用 `b.tick(n)` 推进；也可以注入任意
“无参数、返回单调不减整数”的可调用对象：

```python
class FakeClock:
    def __init__(self): self.t = 0
    def __call__(self): return self.t
    def advance(self, n): self.t += n; return self.t

clk = FakeClock()
b = MessageBus(clock=clk)
b.subscribe("a", ack_timeout=5)
b.publish({"msg_id": "m1", "topic": "t", "priority": 0,
           "payload": None, "produced_at": 0})
b.deliver("a")          # delivered_at = 0
clk.advance(6)
b.check_timeouts()      # -> ["m1"]，超时未确认回到待投递队列
```

`enqueued_at` / `delivered_at` 都取自该时钟。注入外部时钟后 `tick()`
不可用（抛 `BusError`），请直接推进外部时钟。

### 命令行

```bash
python main.py [--overflow reject|drop_lowest] [--unsubscribe cleanup|transfer|drop]
```

stdin 每行一个 JSON 命令，stdout 每行一个 JSON 结果，空行忽略；
**错误也是一行 JSON 且包含 `"error"` 字段与 `"ok": false`**，单行出错
不会中断后续命令。

```bash
$ printf '%s\n' \
  '{"cmd":"subscribe","sub_id":"a","topics":["orders"],"max_inflight":2}' \
  '{"cmd":"publish","msg_id":"m1","topic":"orders","priority":5,"produced_at":1}' \
  '{"cmd":"deliver","sub_id":"a","max_messages":5}' \
  '{"cmd":"ack","sub_id":"a","msg_id":"m1"}' \
  '{"cmd":"state"}' | python main.py
```

---

## 2. 消息模型

| 字段 | 类型 | 约束 |
|---|---|---|
| `msg_id` | str | **非空、全局唯一**；重复 publish 抛 `BusError` |
| `topic` | str | 非空 |
| `priority` | int | 整数（拒绝 `bool`/浮点），**越大越优先** |
| `payload` | 任意 | 必须可 JSON 序列化，发布时即检查 |
| `produced_at` | int | 逻辑时钟整数，**允许乱序**，仅用于同优先级排序 |

订阅者（`subscriber`）由非空 `sub_id` 标识：

| 参数 | 默认 | 含义 |
|---|---|---|
| `topics` | `null`（全部主题） | 主题白名单；非空时只接收其中主题 |
| `min_priority` | 0 | 最小优先级阈值（含），低于不路由 |
| `max_inflight` | 100 | 未确认消息上限（**0 表示永远背压**） |
| `max_queue` | 1000 | 待投递队列上限（**0 表示不接收任何新消息**） |
| `ack_timeout` | `null` | 未确认超时（逻辑时钟单位），`null` 不超时 |
| `online` | true | 初始在线状态 |

主题在**发布或订阅时注册**。无订阅者时发布的消息本体仍保留在总线中
（`get_message` 可查、计入主题数与消息数），但**不会**补发给之后才
注册的订阅者；路由只在 publish 时发生，离线订阅者也照常入队。

---

## 3. 投递语义

- `publish(msg)` **只入队不投递**。
- `deliver(sub_id, max_messages)` 从该订阅者的待投递队列拉取，排序键为
  **全序稳定序**：

  ```
  priority 降序 → produced_at 升序 → msg_id 字典序升序
  ```

- 同一订阅者：未确认（in-flight）的消息不会重复投递；已确认的消息
  永远不再投递。每条返回结果额外带：
  - `redelivered`：是否为重投（掉线回队、超时回队或注销转移而来）；
  - `delivery_no`：第几次投递给该订阅者（从 1 开始）。
- 返回结构：`{messages, backpressure, inflight, max_inflight}`。
- 拉取前会先对该订阅者做一次 `ack_timeout` 惰性回收。
- `max_messages <= 0` 返回空且不计背压（调用方明确不取）。

---

## 4. 确认与重投递

- `ack(sub_id, msg_id)` 确认单条，**幂等**：
  - 在未确认集合中 → 确认，`acked=true`；
  - 已确认过 → 无操作，`already_acked=true`；
  - 从未投递给该订阅者（含 msg_id 不存在）→ 无操作、**不报错**，
    `acked=false, known=false`。
- `ack_up_to(sub_id, msg_id)` 按该订阅者的**投递历史**确认从最早一条到
  `msg_id`（含）的前缀：
  - 分界位置取该消息**第一次**投递的位置；
  - **只确认当前真实在途（已投递、未确认，即 inflight）且落在前缀内的
    消息**。不会触碰待投递队列里还没（重新）投出的消息，也不会把它们
    标记为已确认——所以掉线重投后，在重新 `deliver` 之前调用 `ack_up_to`
    不会让队列里的消息“被确认后再也投递不到”。典型用法是先重新取消息、
    再按游标确认；
  - 重复确认、确认一个更早的位移都是幂等空操作（`acked_ids=[]`），
    不报错；
  - 从未投递过的 `msg_id` → 无操作、不报错，返回 `found=false`；
  - 返回本次**新确认**的 `acked_ids`（字典序）。
- **重投递**触发方式（消息带 `redelivered=true`，`delivery_no` 递增）：
  - `set_online(sub_id, false)`：该订阅者全部未确认消息立即回到待投递
    队列；回队不受 `max_queue` 限制（这些消息此前已被接收）；
  - `check_timeouts()`：在线且配置了 `ack_timeout` 的订阅者，满足
    `now - delivered_at >= ack_timeout` 的未确认消息回队；`deliver`
    前也会对目标订阅者惰性执行一次；
  - 注销转移（见下）。
- 回队后再次按同一全序投递，因此**保留原优先级顺序**。已确认集合与
  投递历史在掉线/上线后保留，不丢确认位移。
- **计数口径**（见 `get_state`）：
  - `backpressure_count` = `deliver` 因 inflight 打满而被挡下（返回空）
    的调用次数；离线、`max_messages<=0`、部分容量都不计；
  - `redelivered_count` = **重投递批次数**：一次掉线（无论回队几条）
    或一次命中的超时扫描各算 1，不是按消息条数；每条消息是否重投仍看
    它自己的 `redelivered` 标记。

---

## 5. 背压与队列溢出策略（重点）

### 背压（消费太慢）

- 达到 `max_inflight` 时 `deliver` 返回空且 `backpressure=true`，
  同时该订阅者的 `backpressure_count` +1（**口径：一次被挡下的在线
  deliver 调用计一次**，与返回多少条无关）；ack 释放名额后自动恢复。
- `max_inflight=0`：永远背压，一条都拿不到（每次在线 deliver 计一次背压）。
- 离线期间的 deliver 返回空但**不计**背压（背压统计只针对“想拿但满了”）。
- 取走部分消息后仍有空位时 `backpressure=false`，只有真正打满后再取
  才计背压；`max_messages<=0` 是调用方明确不取，也不计。

### 队列溢出（`publish` 时待投递队列达到 `max_queue`）

策略可在构造总线时选择，也可在 CLI 用 `config` 命令切换：

#### `overflow = "reject"`（默认）

- **拒绝新消息**：该订阅者不入队，消息仍会路由给其他有容量的订阅者；
- publish 结果为 `{accepted, routed, dropped, reason}`：
  `routed` 是成功入队的订阅者，`dropped` 是因满/`max_queue=0` 未接收的
  订阅者；总线级 `dropped_count` 按“被拒的订阅者数”累加；
- 至少一个订阅者接收时 `accepted=true`。

#### `overflow = "drop_lowest"`

- 在 **“现有队列 + 新消息”** 中淘汰最低优先级的一条：
  1. `priority` 最小；
  2. 并列时 `produced_at` **最大**（越晚产生越先被淘汰）；
  3. 再并列 `msg_id` 字典序**最大**。
- 被淘汰的若是**旧消息**：从该订阅者队列移除（它在别处的副本保留），
  新消息入队；
- 若新消息本身就是最低者：旧队列不动，等价于拒绝新消息
  （新消息不会把同优先级更老的消息挤掉）；
- 被淘汰消息若有过投递历史，其在该订阅者的历史痕迹一并清理，
  快照一致性不受影响。

`max_queue=0`：两种策略下都不接收任何新消息。

---

## 6. 订阅恢复与注销

- `set_online(sub_id, online)`：
  - 在线 → 离线：未确认消息全部回队（返回 `returned` 列表）；
    离线期间 publish 给它的消息照常排队；
  - 离线 → 在线：无需额外操作，直接 `deliver` 即可继续；
  - 重复设置相同状态是空操作。
- 重复 `subscribe` 同一 `sub_id` = 更新配置：队列、未确认、投递历史、
  已确认集合与计数器**全部保留**；在线状态也保留（上下线只能走
  `set_online`）。过滤器/阈值的变更只影响**之后新发布**的消息，
  已在队列中的消息仍会投递。调小 `max_queue` / `max_inflight` 不会
  立即裁剪现状，限制在下次入队/投递时生效。
- `unsubscribe(sub_id, policy=...)` 注销，默认策略可被参数覆盖。
  注销返回 `{sub_id, policy, transferred, retained, dropped,
  transferred_count, cleaned_up_count}`（列表按 msg_id 字典序），并把
  清理/转移条数累计到总线级计数器，**订阅者注销后仍可在 state 中对账**：

#### `unsubscribe = "cleanup"`（默认；旧名 `drop` 等价）

- 直接清理该订阅者持有的待投递/未确认消息，`cleaned_up_count` 给出条数；
- 消息若还被其他订阅者持有则本体保留（它们的副本不受影响），否则回收
  ——**不会静默泄漏**；
- 旧名 `"drop"` 与旧快照里的 `"drop"` 仍被接受并自动归一为 `"cleanup"`。

#### `unsubscribe = "transfer"`

- 对每条消息，按 sub_id 字典序找一个**在线、同主题（过滤器匹配）、
  队列未满、且尚未持有该消息**的其他订阅者放入其待投递队列；
- 接收方之后按优先级全序取消息，因此**转移保持原优先级顺序**；
- 标记规则：注销者**曾投递过**的消息（inflight 或回队）转移后带
  `redelivered`；从未投出的待投递消息保持“首次投递”语义，不打标记、
  `delivery_no` 从 1 开始；
- 若其他订阅者本来就持有该消息（待投递/未确认/已确认），记为
  `retained`（不重复入队，**不计**清理/转移计数）；
- 没有任何合格接收者时落入 `dropped`，按 cleanup 清理并计
  `cleaned_up_count`；成功转移计 `transferred_count`。

消息本体的回收条件：没有任何订阅者持有（pending/inflight）、确认过、
或留在投递历史中。例如“无订阅者时发布”的消息会保留以便查询。

---

## 7. 状态查询

- `get_state()` 返回：

  ```json
  {
    "clock": 12,
    "topics": 2, "topic_names": ["orders", "payments"],
    "messages": 7, "subscribers": 2,
    "subscriptions": {
      "worker-a": {
        "online": true, "topics": ["orders"], "min_priority": 1,
        "pending": 3, "inflight": 2, "acked": 10,
        "max_inflight": 10, "max_queue": 100, "ack_timeout": 30,
        "backpressure_count": 1, "redelivered_count": 2
      }
    },
    "dropped_count": 0,
    "unsubscribe_cleanup_count": 0,
    "unsubscribe_transfer_count": 0,
    "overflow_policy": "reject",
    "unsubscribe_policy": "cleanup"
  }
  ```

  其中 `redelivered_count` 是**重投递批次数**（掉线一次 / 一次命中的超时
  扫描各计 1）；`unsubscribe_*_count` 是注销导致的累计清理/转移条数，
  订阅者被注销后仍保留在总线上方便对账。

- `get_message(msg_id)`：消息详情，不存在返回 `None`。
- `list_subscriptions(topic=None)`：订阅某主题的 sub_id
  （订阅全部主题的也算），字典序；不传主题返回全部订阅者。
- `dump()`：与 save 文件内容一致的完整内部快照字典。

---

## 8. 持久化（save / load）

`save(path)` 写一个 UTF-8、缩进 2 的 JSON 文件，包含：版本号、逻辑时钟、
主题注册表、两种策略、计数器（dropped / 每订阅者背压次数与重投递批次数 /
注销清理与转移累计条数）、全部仍保留的消息、每个订阅者的配置 / 待投递
队列（含 `enqueued_at`、`redelivered`）/ 未确认集合（含 `delivered_at`、
`delivery_no`）/ 投递历史 / 已确认集合。

**格式兼容**：不引入新版本号。注销策略序列化为规范值 `"cleanup"` /
`"transfer"`；加载旧快照里的 `"drop"` 会自动归一为 `"cleanup"`，旧快照
缺少 `unsubscribe_cleanup` / `unsubscribe_transfer` 两个计数器时按 0 加载，
旧快照 load 后行为与当前一致。

`load(path)`（或 `from_dict(data)`）重建前做**严格一致性校验**，
任何问题都抛带明确位置的 `BusError`，绝不静默吞掉：

- 文件不可读；不是合法 JSON（错误信息带行列号）；
- 根结构/必需字段缺失、版本号不支持；
- 时钟非负整数；策略枚举合法；
- 消息：`msg_id` 唯一，`msg_id`/`topic` 非空字符串，
  `priority`/`produced_at` 为整数（拒绝布尔），payload 可序列化，
  消息 topic 在主题注册表中；
- 订阅：`sub_id` 非空且不重复，**引用的 topic 必须存在**，
  各配置值类型/范围合法（`max_*` 非负整数等）；
- 队列一致性：
  - pending 不重复、不与 inflight 交叉，引用的 msg_id 存在；
  - 每条 inflight 必须出现在 `delivery_order` 中；
  - `delivery_order` 中每条消息必须处于 pending / inflight / acked 之一；
  - acked 的消息不得仍在 pending 或 inflight；
  - `max_queue=0` 时 pending 必须为空；
- 计数器引用的订阅者必须存在、值为非负整数。

加载后时钟从快照值起步（仍可用 `tick` 推进）；也可给
`load(path, clock=...)` 注入外部时钟。`save → load` 的快照按内容
逐字节比较相等（测试中以排序 JSON 比对）。

说明：加载时**不**校验“在队消息是否匹配订阅者当前过滤器”，因为运行时
允许变更过滤器，而变更前已入队的消息仍应投递。

---

## 9. CLI 命令参考

通用形式：`{"cmd": "<name>", ...参数}`。`null` 参数等同缺省。

| cmd | 参数 | 说明 |
|---|---|---|
| `publish` | `msg_id,topic,priority,payload?,produced_at?` | 也可整体传 `"message": {...}`；缺省 `produced_at` 取当前时钟 |
| `subscribe` | `sub_id`；`topics?,min_priority?,max_inflight?,max_queue?,ack_timeout?,online?` | 已存在则更新配置 |
| `unsubscribe` | `sub_id`；`policy?` | `cleanup`（默认，旧名 `drop` 等价）/ `transfer` 覆盖默认 |
| `deliver` | `sub_id`；`max_messages?`（默认 1） | 拉取投递 |
| `ack` | `sub_id,msg_id` | 幂等 |
| `ack_up_to` | `sub_id,msg_id` | 按投递历史确认前缀 |
| `set_online` | `sub_id,online` | `online` 必须是布尔 |
| `state` | — | `get_state()` |
| `get` | `msg_id` | 不存在时 `exists:false, message:null`（非错误） |
| `list` | `topic?` | `{"topic":..., "subscribers":[...]}` |
| `save` / `load` | `path` | load 会替换当前会话总线 |
| `dump` | — | 完整内部快照 |
| `tick` | `n?`（默认 1） | 推进内部逻辑时钟 |
| `config` | `overflow?,unsubscribe?` | 切换策略 |

示例：

```json
{"cmd":"subscribe","sub_id":"a","topics":["t"],"max_inflight":2,"max_queue":5}
{"cmd":"publish","msg_id":"m1","topic":"t","priority":9,"payload":{"k":1},"produced_at":3}
{"cmd":"deliver","sub_id":"a","max_messages":5}
{"cmd":"set_online","sub_id":"a","online":false}
{"cmd":"set_online","sub_id":"a","online":true}
{"cmd":"save","path":"snapshot.json"}
{"cmd":"load","path":"snapshot.json"}
{"cmd":"state"}
```

错误行示例：

```json
{"ok":false,"error":"duplicate msg_id: m1","line":4}
{"ok":false,"error":"invalid JSON at line 9 col 1: Expecting value","line":9}
{"ok":false,"error":"unknown command: frobnicate","line":10}
```

---

## 10. 边界情况行为一览

| 场景 | 行为 |
|---|---|
| 空总线 | `state` 全零；`list` 返回 `[]`；`get` 返回 null |
| 无订阅者发布 | 消息保留可查，`accepted=false`；之后订阅不补发 |
| 单订阅者 | 全流程正常，消息确认后本体回收 |
| 优先级相同 | 按 `produced_at` 再按 `msg_id` 稳定排序 |
| `max_inflight=0` | 永远背压，deliver 恒空 |
| `max_queue=0` | 不接收任何新消息（drop_lowest 也无效） |
| 确认不存在的消息 | 不报错；`ack` 返回 `known=false`，`ack_up_to` 返回 `found=false` |
| 重复确认 / 确认更早位移 | 不报错（幂等空操作） |
| 掉线后重投顺序 | 与首次投递顺序一致，全部带 `redelivered` |
| 掉线期间发布 | 正常进入离线订阅者队列，上线即可取 |
| 掉线后、重投前 `ack_up_to` | 只确认在途前缀；待投递消息不受影响、仍可重投 |
| 超时 | `check_timeouts()` 或 deliver 时惰性回收，带 `redelivered` |
| 背压计数 | 按被挡下的 deliver 调用次数（离线/不取/部分容量不计） |
| 重投递计数 | 按批次：掉线一次或一次命中的超时扫描计 1 |
| 注销（cleanup，旧名 drop） | 清理本订阅者副本并计数；最后持有者注销才回收消息本体 |
| 注销（transfer） | 在线/同主题/未满者按优先级顺序接收；曾投出的带 redelivered，未投出的不打标记；本就持有算 retained；无处可去算 dropped 并计数 |
| save 后 load | 状态（含时钟、策略归一、计数器、队列、历史、标记）一致 |
| 旧快照（`"drop"`、缺新计数器） | 自动归一为 cleanup、新计数器按 0 加载，行为与当前一致 |
| 坏快照文件 | 抛/返回带行列号或字段位置的清晰错误 |

---

## 11. 运行测试

```bash
python -m unittest test_bus -v
```

覆盖（69 个用例）：

- 优先级/时间/msg_id 全序投递、publish 不立即投递、主题与阈值过滤、
  未确认不重复投递、重复 msg_id、非法字段与不可序列化 payload；
- ack 幂等、确认未知消息、`ack_up_to` 前缀确认、重复/更早位移幂等、
  以及核心回归：掉线重投**前**与部分重投后 `ack_up_to` 都不会误确认
  待投递队列里尚未投出的消息；
- inflight 背压与计数（按被挡下的 deliver 次数）、`max_inflight=0`、
  `max_messages=0`、离线不计背压、部分容量不误报背压；
- 重投递计数按**批次**（一次掉线 / 一次命中的超时扫描各计 1，多轮
  掉线/超时循环既不产生重复队列条目也不重复计数）；
- reject / drop_lowest（淘汰旧消息、新消息最低、时间与 id 并列裁决、
  淘汰有投递历史的消息后快照仍合法）；
- 掉线回队顺序与 `redelivered` 标记、离线期间排队、注入时钟的超时
  回收、外部时钟禁用 tick、离线跳过超时扫描；
- 注销 cleanup（含旧名 drop 别名与旧快照归一）/ transfer（在线同主题
  未满接收、保持优先级顺序、曾投出/未投出的 redelivered 区分、
  离线/满队列/已持有 retained、无处可去计入清理）、计数跨注销累计、
  消息本体 GC 防泄漏；
- 重复 subscribe 更新配置且保留状态与在线状态；
- 空总线、无订阅者发布、时钟推进；
- 快照 dict/file 往返一致、空总线快照、注销计数持久化、**旧快照
  （`"drop"`、缺新计数器）兼容加载**、十余种一致性校验错误、
  坏 JSON 行列号、缺文件；
- CLI 完整会话、错误 JSON 化且不中断、CLI save/load、坏文件 load、
  非法策略名也以 JSON 错误返回而不崩溃、CLI cleanup/transfer 注销。
