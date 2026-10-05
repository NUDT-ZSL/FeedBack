# 虹桥水域舟船通行推演链路（渲染无关）

推演逻辑原本只存在于 `useFrame` 渲染帧与点击回调中，无法离线复算。
本目录把推演抽成纯函数核心，渲染层、回放脚本、自动化验证共用同一份口径。

## 模块

- `constants.ts` — 全部推演口径（水位/风速范围、吃水换算系数、余量阈值 0.5、危险风速 7、进度推进与越界重置值）。调口径只改这里。
- `types.ts` — 船舶、推演状态、操作、逐步轨迹与场景类型。
- `engine.ts` — 纯函数核心：`computeEffectiveDraft`（吃水换算）、`computeClearance`（通航余量）、`evaluateNavigationStatus`/`evaluateFleet`（状态与告警判定）、`advanceProgress`（进度推进与越界重置）、`clampProgress`、`validateWaterLevel`/`validateWindSpeed`、`createSimulation`（带操作留痕的可交互推演实例）。
- `defaultFleet.ts` — 默认船队（store 与离线场景共用，避免初始条件漂移）。
- `statusLabels.ts` — 状态→展示文案映射（信息面板与验证共用，保证展示结论即推演结论）。
- `replay.ts` — `runScenario`：按操作序列逐步推演，输出每步快照、判定依据与整段轨迹的 FNV-1a 校验和。
- `scenarios.ts` — 命名场景库，覆盖时间演变、最后生效值、越界重置、选中联动、异常输入及各自对照组。

## 离线执行（无浏览器、无渲染）

```bash
npm test                                   # 17 项自动化验证
node scripts/replay.ts --list              # 列出场景
node scripts/replay.ts --all               # 摘要 + 校验和
node scripts/replay.ts invalid-inputs      # 完整 JSON 轨迹（含每步依据）
node scripts/replay.ts time-evolution --out /tmp/after.json
```

每条判定依据形如 `余量 0.31 < 阈值 0.5（有效吃水 1.9，水位 3）`，
可直接定位结论对应的输入数值、换算结果与阈值。

## 口径调整前后的差异比对

1. 调整前导出基线：`node scripts/replay.ts --all > /tmp/before.txt`（或逐场景 `--out`）。
2. 修改 `constants.ts` 中的阈值/系数。
3. `npm test`：边界与不变量验证会立即暴露口径变化影响的结论。
4. `node scripts/replay.ts --all`：校验和变化即口径对轨迹产生影响；逐场景 diff 可看到具体是哪艘船、哪一步、依据数值如何变化。

## 关键不变量（由测试固定）

- 同一场景重复回放，轨迹 JSON 与校验和逐字节一致（确定性）。
- 轨迹每一步的船舶状态/告警都与基于该步输入的整体重算一致（不允许局部结论漂移）。
- 同一时刻连续多组水位/风调整，最终状态只与最后生效值一致。
- 非法输入（越界水位/风、非有限数值、负步长、不存在的船舶）一律拒绝并在操作日志中留下原因，不改变任何状态；其最终状态与仅施加合法操作的对照组完全一致。
