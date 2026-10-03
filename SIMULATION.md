# 可观测模拟链路（确定性 / 回放 / 批量验证）

鱼缸生态模拟已从"只服务实时渲染"重构为一条可观测、可回放、可离线批量验证的链路。

## 核心原则

- **固定时间步**：模拟以 `STEP_DT = 1/60s` 推进（`src/sim/Simulation.ts`），真实帧率只影响渲染节奏，不影响生态演变。浏览器端通过 `Simulation.advance(realDt)` 累积补偿，离线端通过 `run(steps)` 直接步进，两者轨迹逐位一致。
- **确定性随机**：所有影响模拟状态的随机数来自可种子化的 `Rng`（`src/sim/rng.ts`，mulberry32）。渲染层视觉效果（气泡、沙砾、粒子）不参与模拟状态，不受此约束。
- **输入即数据**：撒食、装饰物放置都是 `InputEvent`（`src/sim/types.ts`），按 `(step, seq)` 排序后在固定时间步统一应用——不依赖真实鼠标事件或网络，可记录、可重放。
- **繁殖去定时器**：原先 `setTimeout(1500)` 的繁殖延迟改为模拟时间驱动的 `pendingBirths` 队列（FIFO），与真实时间/帧率彻底解耦。

## 轨迹（Trajectory）

每步记录一份 `StepSnapshot`：鱼的位置/状态/数量、食物剩余、装饰物数量、本步发生的全部事件（撒食、吃食、食物过期/沉底清理、繁殖、繁殖被上限拒绝、装饰物放置及越界夹取）。轨迹 = 初始配置（seed/尺寸/初始鱼数）+ 输入序列 + 逐步快照，见 `src/sim/types.ts`。

- 浏览器端：工具栏"轨迹"按钮导出当前轨迹 JSON；URL 加 `?seed=<n>` 可复现同一次运行（种子会打印在控制台）。
- 离线端：`replayTrajectory()` 仅凭轨迹中的配置与输入即可完整重现生态演变。

## 批量验证

```bash
npm run sim:batch                                    # 全部预设场景 + 边界检查
npm run sim:batch -- --scenario=feeding-cleanup --out=traj.json   # 单场景并导出轨迹
npm run sim:batch -- --verify=traj.json              # 回放已有轨迹并逐位比对
```

每个场景执行三类检查（任一失败退出码为 1）：

1. **确定性**：同一配置 + 输入跑两次，轨迹哈希一致；
2. **可回放**：用轨迹中的配置与输入离线重放，结果一致；
3. **帧率无关**：用可变帧间隔（模拟浏览器 rAF）推进，轨迹与固定步进一致。

预设场景在 `src/sim/scenarios.ts`，覆盖：基准自由游动、撒食与食物清理、同步多事件顺序、装饰物越界、繁殖与数量上限。

## 边界行为

| 边界 | 行为 |
| --- | --- |
| 鱼群达 30 条上限 | 繁殖被拒绝并记录 `breedBlocked(maxFishReached)` 事件，数量永不超限 |
| 食物过期 / 沉底 / 被吃 | 均在下步前清理，分别记录 `foodRemoved(expired/sank)` / `foodEaten` |
| 装饰物越界 | 确定性夹取到 `x∈[0,width]`、`y∈[height-100,height]`，事件带 `clamped: true` |
| 同步多事件 | 同一时间步内多个输入按记录顺序（seq）稳定生效，事件顺序即发生顺序 |

## 目录结构

- `src/sim/rng.ts` — 可种子化随机数生成器
- `src/sim/types.ts` — 配置 / 输入 / 事件 / 快照 / 轨迹类型
- `src/sim/Simulation.ts` — 固定步长模拟核心（实时与离线共用）
- `src/sim/DecorationManager.ts` — 装饰物状态与越界夹取（纯逻辑）
- `src/sim/trajectory.ts` — 轨迹哈希、比较、离线回放、序列化
- `src/sim/scenarios.ts` — 预设场景
- `src/sim/batch.ts` — 离线批量验证入口（Node）
- `src/FishManager.ts` — 鱼群生态逻辑（已接入 Rng 与事件上报）
