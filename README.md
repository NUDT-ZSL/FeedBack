# leasekernel —— 带偏差容忍的逻辑时钟租约内核

在多个逻辑节点之间为命名资源发放带时限的租约，保证 **同一资源同一时刻最多只有一个持有者**。
纯 Python 标准库实现，无需第三方依赖，可完全离线运行与测试（需要 Python 3.10+）。

## 为什么不能直接比较墙上时间

真实环境里续租请求会延迟、各节点时钟会漂移、回退甚至跳变。因此本内核：

- 绝不读取墙上时间，所有判定基于**可注入的逻辑时钟**；
- 时钟同时维护绝对读数 `now`（可被设回，模拟跳变）与**单调高水位** `monotonic`（只增不减）；
- 租约的授予时刻 `grant_mono`、硬到期时刻 `expire_mono` 全部建立在单调读数上。
  时钟回退或向下跳变不会让已到期的租约复活，也不会错误延长或缩短安全期；
  续租时再用绝对读数与请求方自报的本地时间比较偏差。

## 三态判定（安全优先）

设租约硬到期时刻为 `expire_mono`，节点最大时钟偏差上界为 `epsilon`：

| 条件（`m` = 当前单调读数） | 状态 | 续租 / 写入 |
| --- | --- | --- |
| `m + epsilon < expire_mono` | `safe`（安全期） | 允许 |
| `expire_mono - epsilon <= m < expire_mono` | `uncertain`（偏差不确定区） | **一律拒绝** |
| `m >= expire_mono` | `expired`（硬过期） | 拒绝并可回收 |

`epsilon = 0` 时没有不确定区，退化为严格时间比较。

其他安全机制：

- 每次授予生成单调递增的 **fencing token（`generation`）**；租约回收后旧持有者携带旧
  token 的写入永久被拒（`stale_generation`）。
- 在偏差不确定区回收租约后，资源在记录的硬到期时刻之前**不会重新发放**，因此系统判定中
  不会出现两个持有者同时有效的窗口。
- 续租必须携带自报本地时间与上次授予信息（`generation`，可选 `lease_id`），
  超出安全窗口的续租返回明确的拒绝原因，绝不默默续期：
  `uncertainty_window` / `expired` / `clock_skew_exceeded` / `stale_generation` /
  `stale_lease_id` / `not_holder` / `no_active_lease`。

## 目录结构

```
leasekernel/
  __init__.py     公开 API
  clock.py        LogicalClock 抽象与 ManualClock（可注入、可回退/跳变）
  kernel.py       LeaseKernel：注册/申请/续租/写入校验/释放/回收/查询/事件日志/JSON 持久化
  cli.py          stdin JSON 行命令入口
  __main__.py     支持 python -m leasekernel
tests/            unittest 测试（85 个，可重复执行）
```

## 作为库使用

```python
from leasekernel import LeaseKernel, ManualClock, LeaseState

clk = ManualClock(0.0)
k = LeaseKernel(clk)
k.register_resource("db", ttl=100, epsilon=10, node_epsilons={"node-a": 5})

g = k.acquire("db", "node-a")          # -> generation=1, expire_mono=100, safe_until=90
clk.advance(40)
k.renew("db", "node-a", generation=1, local_time=40.0)   # 续租到 140
k.check_write("db", "node-a", generation=1)             # {"allowed": True, ...}

clk.advance(55)                        # 进入不确定区 (95)
k.status("db").state                   # LeaseState.UNCERTAIN
k.check_write("db", "node-a", 1)       # {"allowed": False, "reason": "uncertainty_window"}
k.reclaim("db")                        # 安全回收
clk.advance(5)                         # 到达硬到期 100
k.acquire("db", "node-b")              # 新持有者，generation=2
k.check_write("db", "node-a", 1)       # 旧 token: stale_generation，永久拒绝
```

时钟异常注入：

```python
clk.set_time(1_000_000)   # 大幅向前跳变：租约按高水位到期，不会复活
clk.set_time(0)           # 回退：now=0，但 monotonic 仍为 1_000_000，判定不变
```

## 命令行用法

从标准输入逐行读 JSON 命令，每行输出一行 JSON；错误也返回
`{"ok": false, "error": "...", "error_type": "...", "line": N}`，进程退出码为错误行数。

```bash
python -m leasekernel <<'EOF'
{"cmd":"register","resource":"db","ttl":100,"epsilon":10}
{"cmd":"acquire","resource":"db","holder":"node-1"}
{"cmd":"renew","resource":"db","holder":"node-1","generation":1,"local_time":30}
{"cmd":"advance","delta":95}
{"cmd":"reclaim"}
{"cmd":"status","resource":"db"}
{"cmd":"log","limit":5}
{"cmd":"export","path":"state.json"}
EOF
```

| 命令 | 说明 |
| --- | --- |
| `register` | `resource`, `ttl`, 可选 `epsilon`（默认 0）、`node_epsilons` |
| `acquire` | `resource`, `holder`；被占用或处于到期遗留窗口时返回 `granted:false` 与原因 |
| `renew` | `resource`, `holder`, `generation`, `local_time`，可选 `lease_id` |
| `write` | 模拟受租约保护的写入，校验持有者与 fencing token |
| `release` | `resource`, `holder`, `generation`；token/持有者不符报错 |
| `reclaim` | 可选 `resource`；省略时扫描全部资源 |
| `advance` | `delta`（非负）推进逻辑时钟 |
| `set_clock` | `time` 注入任意时间（回退/跳变） |
| `status` | 返回三态、持有者、授予/到期/安全到期时刻、是否可发放 |
| `log` | 可选 `limit`；返回带原因与时间依据的事件日志 |
| `export` / `import` | `path`，JSON 快照 |
| `inspect` | 完整内部状态（资源、租约、时钟、偏差配置、日志） |
| `reset` | 可选 `initial`，清空系统 |

## 事件日志与确定性

每次授予（`grant`）、续租（`renew`，`ok`/`denied`）、申请拒绝（`acquire`）、
写入拒绝（`write`）、释放（`release`）、回收/自动到期（`reclaim`/`expire`）
都记录 `seq`、`result`、`reason`、`monotonic`、`clock_now` 与细节（偏差值、
新旧到期时刻、当前 generation 等）。除命令输入外不读取任何外部状态，
同一输入序列重复执行得到完全相同的判定与日志顺序。

## 快照格式与校验

导出的 JSON 包含 `format_version`、`clock`、`resources`（含配置与当前租约）、
`events`、`seq`。载入时校验：

- 顶层/各段字段齐全且类型正确；
- 持有者唯一（每个资源至多一条活跃租约，且租约记录必须属于该资源）；
- `expire_mono >= grant_mono`、`ttl > 0`、`epsilon >= 0`（含按节点覆盖值）；
- generation 连续、事件 `seq` 连续且与事件数一致；
- 时钟高水位不低于绝对读数（被损坏数据拉低时自动修正）。

任何校验失败都抛出 `PersistenceError`（中文说明含具体字段/行号），
**先完整构建并校验新状态，成功后才替换当前状态**，失败时原状态保持不变。

## 运行测试

```bash
python -m unittest discover -s tests -v
```

测试覆盖：空系统、单资源生命周期、重复申请、释放不存在/不属于自己的租约、
双重释放、时钟回退、大幅向前跳变、`epsilon=0` 边界、偏差边界（含等值）、
不确定区拒绝、回收后旧持有者写入、逐时刻穷举无双重持有者、确定性回放、
快照往返、各类损坏导入与失败原子性、CLI 端到端（含损坏 JSON 行）。
