# 边缘网关链路切换编排模块（link_orchestrator）

纯 Python 标准库实现、离线可验收。维护多条上行链路与业务会话，支持
健康上报驱动的会话迁移、确定性链路选择、多来源矛盾健康状态的保留与
冲突记录、恢复时的增量等价重算，以及单文件快照持久化与载入校验。

- Python 3.9+，无第三方依赖
- 全部时间为**逻辑时刻**（非负整数），同一链路的健康上报必须非递减到达

## 快速运行

```bash
python demo.py                      # 端到端中文演示
python -m unittest discover -s tests -v   # 32 个验收用例
python tests/test_fuzz.py           # 12 组种子的确定性模糊不变量测试
```

## 需求对照

| 需求 | 实现位置 / 行为 |
| --- | --- |
| 1. 链路维护、幂等上报、拒绝非法带宽与时刻倒退并指出位置 | `add_link` / `report_health`；错误带 `location`，如 `links[X].bandwidth`；完全相同的 (链路,时刻,来源,状态) 重复上报返回 `duplicate=True` 并忽略 |
| 2. 会话维护、迁移记录来源/目标/时刻、拒绝不存在或失效目标 | `add_session` / `migrate`；每次迁移写 `MigrationRecord(seq,time,session,from_link,to_link,reason,bytes_sent)`；目标不存在抛 `NotFoundError`，失效抛 `LinkUnavailableError` |
| 3. 故障按业务类别优先级迁出且不超带宽，超限拒绝并给剩余容量 | `_evacuate`：顺序为 (业务类别优先级, 会话标识)；`CapacityExceededError` 带 `free_capacity`；无处可去的单个会话**搁浅**（不占任何链路），拒绝信息带各链路剩余容量，不影响其他会话迁出 |
| 4. 确定性、可复现的选路 | 排序键 `(优先级升序, 剩余容量降序, 链路标识字典序)`；重复调用结果一致；`replay()` 从事件日志从头重放结果完全相同 |
| 5. 矛盾健康状态：保留双方、可读冲突记录、不静默择一、不中断其他会话 | 同一 (链路,时刻) 出现相反状态即生成 `ConflictRecord`（`describe()` 可读，指出链路/双方来源/各自状态/维持的有效状态）；矛盾时刻桶整体不采信，链路维持冲突前状态；若首个一致上报已触发动作，按迁移记录**精确撤销**（轨迹中可追溯） |
| 6. 恢复只重算受影响会话，且等价于从头编排 | `_recover` 只处理 `return_link` 指向恢复链路的会话；`verify_consistency()` 断言增量状态与事件重放逐项一致；未受影响会话承载不变 |
| 7. 稳定顺序的查询 | `get_carrier` / `get_trajectory` / `get_link_load` / `available_links(at_time)` / `unresolved_conflicts` / `stranded_sessions` |
| 8. 单文件保存/载入，损坏清晰报错且失败不改内存 | `save_state` / `load_state`（JSON + SHA-256 校验和，原子替换写入）；载入校验校验和、字段、标识唯一、上报时刻、容量不超限、迁移链来源合法、冲突可溯源，并与事件重放交叉比对；`load_state_into` 在全部校验通过后才替换目标对象状态 |

## 关键语义说明

### 健康状态推导

逐时刻桶处理同一链路的上报：

- 某时刻所有来源意见一致 → 采纳该状态；
- 某时刻存在分歧 → 该时刻为**冲突时刻**，双方上报都保留，链路有效状态
  维持“严格更早时刻”所确定的状态，编排器不替任何来源做主。冲突必须由
  人工 `resolve_conflict(conflict_id, 处置说明)` 显式裁决（只记录结论，
  不伪造健康上报）。

边界情形：同一时刻先到的一致上报如果已经改变了链路状态并触发了迁移，
随后相反上报使该时刻变成冲突桶，编排器会撤销已触发的动作，使最终状态
等价于“从未根据冲突采取行动”：

- 先报故障触发迁出 → 矛盾后按当时迁移记录精确回迁；期间已被手动迁移等
  动作接管的会话不在回滚范围；会话若已增大到原链路容纳不下，则留在现
  链路并保留回迁标记（任何时候都不允许突破带宽上限）。
- 先报恢复触发回迁 → 矛盾后对当前承载者重新执行一次标准迁出。

撤销本身也是带固定原因文案的迁移记录，因此轨迹完整、可复现。

### 故障迁出与搁浅

自动迁出按业务类别注册顺序确定优先级（`LinkOrchestrator(["control",
"telemetry", "bulk"])` 表示 control 最优先），同分按会话标识字典序。
逐条尝试放置：某会话在所有可用可用链路上都放不下时，该次迁移被拒绝、
会话变为搁浅状态（`current_link=None`），返回值 `stranded` 中给出其需求
字节数与每条可用链路的剩余容量；其他会话继续迁出，互不阻断。搁浅会话
在原承载链路恢复后自动回迁。

### 可复现与一致性

每个被接受的操作都写入只增的事件日志。`replay()` 重放日志时会逐事件
比对重放产生的事件流（含搁浅等派生事件），任何不确定或日志损坏都会报
错。生产代码路径与重放走同一套实现，因此增量恢复重算与从头编排必然
一致；`verify_consistency()` 随时可断言这一点。

## API 摘要

```python
from link_orchestrator import LinkOrchestrator, save_state, load_state

o = LinkOrchestrator(["control", "telemetry", "bulk"])
o.add_link("L1", priority=1, bandwidth=1000)
o.add_session("S1", "control", bytes_sent=300)          # 自动选路或 initial_link=
o.report_health("L1", time=5, available=False, source="probe-a")
o.migrate("S1", "L2", time=6, reason="维护切换")
o.grow_bytes("S1", 120)                                 # 会撑爆当前链路则拒绝

o.get_carrier("S1"); o.get_trajectory("S1")
o.get_link_load("L1"); o.available_links(at_time=5)
o.unresolved_conflicts(); o.stranded_sessions()
o.replay(); o.verify_consistency()

save_state("snapshot.json", o)
o2 = load_state("snapshot.json")
```

错误层次：`OrchestratorError` → `ValidationError`
（`DuplicateIdError`、`ClockRejectedError`）、`NotFoundError`、
`MigrationRejectedError`（`LinkUnavailableError`、
`CapacityExceededError`）、`PersistenceError`。拒绝类错误都带可读上下文，
容量错误带 `free_capacity`/`free_table`，位置类错误带 `location`。

## 快照文件

单文件 UTF-8 JSON，顶层含 `format/version/clock/class_order/links/
sessions/reports/migrations/conflicts/events/counters/checksum`。
`checksum` 为其余字段规范化 JSON（键排序、无空白）的 SHA-256。写入采用
同目录临时文件 + 原子替换；载入任一步失败都不会产生半初始化对象，载入
进已有对象时也只在全部校验通过后替换状态。
