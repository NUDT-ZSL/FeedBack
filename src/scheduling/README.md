# 织造排产与工时推演引擎

可离线调用的纯函数模块，不依赖任何界面状态。同一批织机、订单与工序数据，
无论从哪个入口进入，都得到一致的织机占用顺序、订单完成时刻与冲突裁决结果。

## 调用入口（全部收敛到同一引擎）

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 界面路径 | `src/pages/Schedule.tsx` → `runScheduleViaUi` / `recomputeViaUi` | `/schedule` 页面直接调用 |
| 直接调用 | `runScheduleViaService` / `recomputeViaService`（`src/scheduling/pipeline.ts`） | 离线脚本、任意非界面路径 |
| HTTP 服务 | `POST /api/schedule/run`、`POST /api/schedule/recompute`（`api/routes/schedule.ts`） | 服务端入口 |

```ts
import { runScheduleViaService, recomputeViaService, applyRevision, sampleInput } from '@/scheduling';

const result = runScheduleViaService(sampleInput);            // 整体推演
const revised = applyRevision(sampleInput, revision);          // 应用参数修正
const { result: next, affected } = recomputeViaService(sampleInput, revision, result); // 局部重算
```

## 确定性保证

- 输入先按 id 规范化排序，结果与调用方传入的数组顺序无关；
- 时间换算只使用 UTC 纪元分钟与固定时区偏移，与运行环境时区无关；
- 工时按 `workMinutes / efficiency` 在织机工作历上折算（`calendar.ts`）。

## 统一裁决规则（`adjudicate.ts`）

工序竞争同一织机时：R1 订单优先级 → R2 订单交期 → R3 订单剩余总工时 → R4 字典序兜底；
织机选择：L1 可开工时刻最早 → L2 机台号字典序。每次竞争都在 `traces` 中留下
`adjudicate` 记录（规则、赢家、被顺延方）。

## 冲突处理

无法裁决的冲突（钉单重叠、依赖成环、无候选织机）不静默择一：双方（或全部相关方）
保留在结果中，并生成 `ConflictRecord`（原因、裁决说明、结构化证据）与 `conflict` 轨迹。

## 局部重算（`incremental.ts`）

参数修正后，`computeFrontier` 按修正类型求重算时间界：

- 织机效率：该织机第一段既有占用的起点（机台选择与效率无关，此前决定不受影响）；
- 织机工作历：所有把它列为候选的工序的最早就绪时刻；
- 工序工时：该工序既有开工时刻；
- 候选织机 / 订单优先级 / 交期：相关工序的最早就绪时刻。

时间界之前的排产决定冻结保留（`pinned=true`），之后整体重排；
与"修正后整体重算"使用同一引擎同一规则，结果摘要（`meta.resultDigest`）必然一致。

## 离线验收

```bash
npm run schedule:verify   # 无需启动界面或服务
```

覆盖：双入口一致性、遍历顺序无关、重复运行确定性、7 组典型修正 + 30 组随机修正的
"局部重算 == 整体重算"、冲突保留双方且可追溯、工时推算符合工作历。
