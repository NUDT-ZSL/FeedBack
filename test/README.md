# 生长推演离线验证

`src/simulation.ts` 是从渲染循环中抽出的纯推演核心（不依赖 three.js / DOM），
浏览器端（`src/plant.ts`、`src/main.ts`）与这里的验证套件共用同一份
阶段推进、萎蔫判定、萎蔫进度与开花倒计时逻辑，因此离线复算结果即界面口径。

## 运行

```bash
npm run verify
```

该命令用 `tsconfig.verify.json` 把 `src/simulation.ts` 与 `test/` 编译到
`dist-verify/` 后用 Node 批量执行全部场景，输出每条断言的通过情况；
失败时退出码为 1，并在末尾按「场景 → 步骤 → 字段」列出期望值与实际值的差异。

## 场景覆盖（test/scenarios.ts）

- `stage-boundaries` / `stage-boundary-precision`：5/15/30 秒阶段边界的临界取值
- `wilt-entry-exit` / `wilt-threshold-edges`：极端参数触发与退出萎蔫、判定阈值边界
- `wilt-recovery-mid-progress`：萎蔫途中参数拉回正常区间后的衰减与生长恢复
- `wilt-stops-growth-at-0.9`：萎蔫进度 ≥0.9 时生长停滞、恢复后继续
- `wilt-repeated`：萎蔫反复触发与恢复
- `reset-zero-and-regrow`：重置后状态归零并重新推进
- `continuous-params-and-countdown`：参数连续变化下速率与倒计时的一致性

## 新增场景

在 `test/scenarios.ts` 的 `scenarios` 数组中追加即可。步骤类型：

- `{ setParams: {...} }` 修改环境参数（触发萎蔫判定）
- `{ advance: 秒, delta }` 按固定步长推进时间
- `{ reset: true }` 重置
- 任意步骤可附 `expect: { stage, isWilting, wiltProgress, growthTime, growthRate, countdownSeconds, growthDays }` 与 `tol`（数值容差，默认 0.001）做断言
