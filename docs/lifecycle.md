# 驿站调度状态闭环说明

## 状态机（唯一事实源：`server/core.js`）

| 实体 | 状态流转 |
| --- | --- |
| 信件 | `pending` →（派单）→ `assigned` →（任务结算）→ `delivered`；`assigned` →（回退）→ `pending` |
| 马匹 | `idle` →（派单）→ `transit` →（任务结算/回退）→ `idle`；`idle` →（休息）→ `resting` →（冷却到期自动）→ `idle` |
| 任务 | `in_progress` →（到达）→ `completed` / `delayed`；`in_progress` →（回退）→ `cancelled` |

关键规则：

- **预计送达时间**：派单时由目的地 × 紧急度算出并固化为 `estimatedArrivalTime`，抵达结算与超时判定只认这一个口径：`actualArrivalTime <= estimatedArrivalTime` 为 `completed`，否则 `delayed`。
- **自动对账 `reconcile()`**：定时器（1s）与所有读接口都会触发——到点的在途任务按预计时刻自动结算（记 `actualArrivalTime = estimatedArrivalTime`），冷却到期的马匹自动回 `idle`。
- **冲突输入拒绝**：非 `pending` 信件派单 → 409 `LETTER_NOT_PENDING`；非 `idle` 马匹派单/休息 → 409 `HORSE_NOT_IDLE`；删除有在途任务的信件 → 409 `LETTER_IN_TRANSIT`；重复上报到达 → 409 `TASK_ALREADY_SETTLED`。
- **统计口径**：`todayDeliveries` = 今日实际送达（completed+delayed，按 `actualArrivalTime`）；`averageDeliveryTime` = 已完结任务实际耗时均值；`overtimeRate` = delayed / 已完结。全部由任务明细推导，可独立重算核对。

## 接口

- `POST /api/letters` 新增信件；`DELETE /api/letters/:id` 删除（在途拒绝）
- `POST /api/tasks` 派单；`POST /api/tasks/:id/arrive` 上报到达；`POST /api/tasks/:id/rollback` 异常回退
- `POST /api/horses/:id/rest` 休息（30s 冷却，可用 `REST_COOLDOWN_MS` 覆盖）
- `GET /api/letters|horses|tasks|tasks/history|statistics|fleets`（读前自动对账）
- 环境变量：`TIME_SCALE`（运输时间倍率，默认 1）、`REST_COOLDOWN_MS`、`PORT`

## 离线验证

```bash
npm install
npm run verify        # 虚拟时钟确定性验证：26 项断言，秒级完成，无需网络/服务
npm run verify:http   # 真实服务进程 HTTP 冒烟：TIME_SCALE=0.001 加速，约 10 秒
```
