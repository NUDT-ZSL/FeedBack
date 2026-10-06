# 舟船通行推演引擎（simulation）

将原本散落在渲染帧（`useFrame`）与 DOM 回调里的推演逻辑抽出的纯函数引擎。
无浏览器、无 Three.js、无 React 依赖，可离线批量回放与自动化验证。

## 结构

- `constants.ts` — 全部推演口径（阈值、系数、边界）。**调整口径只改这里**，然后跑 `npm test` 比对黄金快照差异。
- `types.ts` — 推演状态、操作、快照、报告类型。
- `engine.ts` — 纯函数状态转移：`createSimulation` / `applyEnvironment` / `stepSimulation` / `selectShip` / `toggleShipSelection`，以及 `getShipSnapshot` / `getSimulationSnapshot` / `getShipReport`（每项结论附判定依据 `basis`）。
- `replay.ts` — `replaySimulation(initial, ops)`：同一初始条件 + 同一操作序列 → 确定的最终状态与逐步日志（含越界留痕）。
- `initialShips.ts` — 默认六船船队，与线上场景一致。

## 推演口径（与渲染帧原逻辑一致）

- 有效吃水 = 吃水 + (5 − 水位) × 0.1
- 净余水深 = 水位 × 0.1 − 有效吃水 × 0.3
- 净余水深 < 0.5 → 谨慎通过（warning，优先于风速判定）
- 风速 ≥ 7 级 → 危险停航（danger）
- 载重超过船型上限（cargo 150 / passenger 60 / fishing 30 / pleasure 20 石）→ 风险上调一级
- 告警：任一船舶 warning 即触发（danger 不触发，与原渲染逻辑一致）
- 进度：每帧 progress += speed × 0.003 × delta × 60；超过 1.1 回绕到 −0.1；快照中钳制到 [0, 1]

## 输入约束

水位 [0, 10]、风速 [0, 8]、步长为正有限数。越界输入被钳制/拒绝并记入
`state.violations`（带时间步与原因），绝不静默跳过；每次操作后状态整体重算，
局部结论不会与全局推演不一致。

## 验证

```bash
npm test        # vitest，44 个用例，含黄金快照
```

口径调整后：测试失败处即行为差异；确认新口径无误后用
`npx vitest run -u` 更新黄金快照，前后快照 diff 即口径影响报告。

## 渲染层对接

`src/store/gameStore.ts` 的 zustand store 只持有 `SimulationState` 并把每个
action 委托给引擎；`BridgeScene` 每帧仅调用 `advance(delta)`；`ShipManager`
只读取 `ship.progress` 渲染，不再自行推演或从 DOM 回写进度。
