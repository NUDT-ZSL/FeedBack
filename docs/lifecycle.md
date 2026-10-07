# 驿站调度状态流转与验证

## 单一事实来源

所有状态流转规则收敛在 `lifecycle.mjs`，`server.js` 只做 HTTP 接线。
信件、马匹、任务三者的状态永远由同一份数据推导，不允许任何接口直接写字段。

```
信件: pending --派单--> assigned --抵达结算--> delivered
马匹: idle --派单--> transit --抵达结算--> idle
      idle --休息--> resting --冷却到期(30s)--> idle
任务: in_progress --抵达结算--> completed(准时) | delayed(超时)
```

## 口径约定

- **预计送达时间**：派单时确定 `estimatedArrivalTime = 出发时刻 + 信件预计分钟数`，此后不变。
- **抵达结算**：时钟推进到 `estimatedArrivalTime` 即结算，实际抵达记为该时刻，任务记 `completed`。
- **超时判定**：实际抵达时刻 > `estimatedArrivalTime` 记 `delayed`（如管理端手动延迟结算）。
  任务终态只由 `settleTaskRow` 一处推导，定时器与手动结算走同一条路径。
- **时钟推进 `sweep(now)`**：每秒由定时器触发一次，且每次 API 请求前也会触发，
  因此任何视图在任意时刻读到的都是当前事实，不存在"到点无人结算"。
- **统计**：全部来自 tasks 表——今日派送 = 今日实际抵达的任务数；
  平均时长 = 已结算任务（实际抵达 − 出发）均值；超时率 = 延迟任务 / 已结算任务。

## 冲突输入的处理

| 输入 | 结果 |
| --- | --- |
| 对已派发/已送达信件再次派单 | 409 `LETTER_NOT_PENDING`，数据库唯一索引兜底 |
| 对不空闲马匹派单 | 409 `HORSE_NOT_IDLE` |
| 载重超限 | 400 `LOAD_EXCEEDED`，不产生任何半截状态 |
| 删除在途信件 | 409 `LETTER_IN_TRANSIT` |
| 删除待派/已送达信件 | 允许；任务历史保留（LEFT JOIN，目的地显示"（信件已删除）"），统计不受影响 |
| 在途马匹安排休息 / 重复休息 | 409 `HORSE_NOT_IDLE` |
| 重复结算同一任务 | 409 `TASK_ALREADY_SETTLED` |

## 离线验证

```bash
npm install   # 仅需一次
npm test      # node --test，内存数据库 + 注入假时钟，无需网络与端口
```

`test/lifecycle.test.mjs` 覆盖：抵达结算（准时）、超时判定、冷却到期自动释放、
重复派单/非法派单拒绝与异常回退、删除在途信件拒绝与删除后历史/统计一致性。

HTTP 层冒烟：先 `node server.js`，再参照上表用 curl 调用各接口验证状态码与状态变化。
