# 背压分级推演台（Backpressure Tier Simulator）

离线导入事件流，按可配置的多档消费速率推进时间，在积压超过档位阈值时触发
**丢弃 / 降采样 / 缓冲扩容 / 暂停来源** 四类处置动作，并在时间轴上记录每次
档位切换的时刻、触发依据与受影响事件区间。所有推演为纯函数式 TypeScript，
浏览器与 Node 均可离线运行。

## 快速开始

```bash
npm install
npm run dev          # 界面（启动自动加载示例流）
npm run selftest     # 120 个随机用例 × 多轮变更的不变量/增量等价自测
npm run batch        # 统一批量入口（默认 cases/samples.json）
npm run batch -- cases/a.json cases/b.json
```

## 核心概念

- **事件**：`{ id, sourceId, arrivalTime, payload }`。
- **档位**：`{ id, threshold, releaseBelow?, consumeRate, action, escalateTo? }`。
  - 积压 `>= threshold` 升级进入；积压 `< releaseBelow`（缺省=阈值）回落释放。
  - `escalateTo` 可显式指定升级目标，缺省按阈值升序跳至最高适用档。
- **处置动作**：
  - `drop`：生效期间新事件在准入时丢弃；
  - `downsample`：按 `keepRatio` 做确定性保留（同一输入两次推演结果完全一致）；
  - `expandBuffer`：生效期间缓冲容量改为 `capacity`，切换时从队尾裁剪；
  - `pauseSource`：暂停指定来源（缺省全部），事件进入暂存区，恢复后按原顺序准入。

## 确定性的异常处置（不静默跳过）

- **乱序到达**：按 `(arrivalTime, inputIndex)` 稳定排序；同时刻事件按输入顺序
  逐条准入，每条准入后立即评估切换，并发触发顺序确定。
- **来源缺失**：归入保留来源 `__unknown__` 并记录数据质量问题。
- **id 缺失/重复**：按确定性规则生成或加后缀；非法时刻显式剔除；负时刻按 0 处理。
- **阈值重叠**：`TIER_OVERLAP` 阻塞推演，必须人工裁决唯一生效档位。
- **升级链成环**：`TIER_CYCLE` 阻塞推演，由人工裁决指定断点。
- **悬空目标 / 非法阈值、速率、动作参数**：`blocking` 问题逐条列出。

## 状态一致性与可追溯

- 每条事件最终只有一条结论（`kept / dropped-admit / dropped-overflow /
  dropped-trim / downsampled-out / held / queued`），`decidedBy` 指向做出该结论
  的切换记录，`history` 保留经历过的全部处置依据（如 held → kept）。
- 切换记录给出触发依据（当时积压与阈值）与生效区间 `[start, end)`。
- 同一区间被多次切换覆盖时，以事件**最终准入/消费时刻生效的档位结论**为准；
  已入队事件不会被更严格档位追溯处置，扩容收缩只裁剪队尾最新事件。

## 增量重推

修改来源到达速率或档位阈值后，定位**最早受影响时刻**（速率变更=首个位移事件；
阈值变更=积压首次达到 `min(旧,新)` 阈值的时刻；裁决=首次切换点），选取严格早于
该时刻的检查点（快照），仅续推之后的区间。`src/engine/verify.ts` 强制核对
增量结果与整体重推逐字段一致（时刻容差 1e-9），并检查六项不变量：

结论唯一、事件数守恒、积压非负、按来源合计一致、切换时刻单调且区间相接、
消费时刻一致、处置依据可追溯。

## 界面

- **积压时间轴**：总量/分来源积压曲线、阈值虚线、档位生效区间底色、升级/释放
  标记，点击标记联动切换记录与事件核查。
- **档位切换记录**：时刻、方向、触发依据、影响区间、裁剪副作用。
- **事件处置核查**：按来源、结论、时间区间、所点选切换记录筛选，查看最终结论、
  消费完成时刻与完整依据链。
- **增量重推**：修改来源速率/档位阈值，显示影响起点、是否复用快照、与整体重推的
  核对结果。
- **批量验证**：在浏览器内对多组事件流与档位配置一次性验证（与 `npm run batch`
  共用同一引擎入口 `runBatch`）。

## 代码结构

```
src/engine/
  types.ts       类型定义
  normalize.ts   事件规范化、来源速率缩放
  validate.ts    配置校验（重叠/成环/悬空/非法值）与裁决解析
  simulate.ts    离散事件仿真引擎（快照/断点续推）
  incremental.ts 影响区间分析与增量重推
  verify.ts      不变量检查与增量/全量等价核对
  index.ts       统一入口 runCase / applyMutation / runBatch
scripts/         Node 批量入口与自测（esbuild 打包，纯离线）
cases/           批量用例 JSON（public/cases 为界面对应副本）
src/components/  TimelineChart / SwitchLog / EventInspector /
                 IncrementalPanel / BatchPanel / ConfigPanel / ImportPanel
src/store/       zustand 状态
```
