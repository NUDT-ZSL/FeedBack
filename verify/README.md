# 运动与聚焦链路离线验证

## 运行

```bash
npm run verify
```

无需浏览器、WebGL 或真实帧率：验证通过 `verify/domStubs.ts` 提供的最小
DOM 桩构造真实的 `SolarSystem`，由 `verify/harness.ts` 以固定 delta
（1/60s）逐帧驱动 `updateSolarSystem` 与 `FocusController`，调用顺序与
`src/main.ts` 的帧循环完全一致，因此每次运行结果确定、可复现。

任一检查失败时进程以退出码 1 结束，可直接接入 CI / 回归脚本。

## 覆盖项

| 检查 | 内容 |
| --- | --- |
| `orbit-accumulation` | 连续 120 帧推进后，各行星角度 == orbitSpeed × 0.1 × 倍率 × delta × 帧数，位置与角度一致，行星间角度比等于速度比 |
| `speed-change-continuity` | 速度倍率 1.0 → 3.5 切换后，首帧增量即按新倍率计算，角度不跳变不重置，分段累积总量与公式一致 |
| `focus-convergence` | 聚焦 Mars 时相机到目标点距离逐帧严格单调下降，控制器目标点收敛到行星 0.5 单位内；进度达 1 后目标清空，后续 30 帧相机与目标点零漂移 |
| `focus-switch-reset` | 聚焦 Venus 中途切换 Jupiter：progress 立即归零、目标点整体替换（与旧目标间距 > 1），随后相机单调收敛到新目标，控制器目标点最终落在木星而非金星 |
| `orbit-toggle-isolation` | 轨道环显隐开→关→开全程，切换当帧及累计角度严格等于公式值，行星位置与角度不受显隐影响 |

## 结构

- `src/motionCore.ts` —— 被验证的纯逻辑核心（角度推进、缓动、聚焦状态机），
  不依赖 three.js / DOM，生产代码（`solarSystem.ts`、`main.ts`）同样使用它。
- `verify/domStubs.ts` —— document / window 最小桩。
- `verify/harness.ts` —— 确定性帧推进 harness。
- `verify/checks.ts` —— 各项检查，输出关键中间量。
- `verify/run.ts` —— 批量运行入口与汇总报告。
