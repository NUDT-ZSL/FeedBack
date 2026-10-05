# 离线推演模块（src/sim）

把 `Game.ts` 中挂在逐帧 `update` 上的波次推进、敌人狂暴、弹幕形态、
能量积累与核弹爆发链路，抽成不依赖 Phaser 的确定性推演引擎，
支持离线批量复算与增量重推。

## 运行

```bash
npm run simulate          # 批量推演 sim-configs/*.json -> sim-results/*.result.json
npm run simulate:check    # 同上，并验证增量重推与整体重推一致（*.check.json）
npm run simulate -- --input <配置目录|文件> --out <输出目录> [--check]
```

输出完全确定（固定步长 + 种子化 RNG），同一配置重复运行结果逐字节一致。

## 模块构成与数据流

- `types.ts` — 配置（`SimConfig`）、事件（`SimEvent`）、结果（`SimResult`）类型
- `rng.ts` — mulberry32，状态可快照，保证增量恢复后随机序列一致
- `engine.ts` — 固定步长引擎，每 tick 顺序：敌人移动/狂暴/开火/逃逸 →
  弹幕过期 → 玩家输出策略 → 核弹策略 → 波次生成与推进 → 能量曲线采样；
  `snapshot()` 输出可序列化状态（含 RNG），供检查点恢复
- `incremental.ts` — 检查点缓存 + 配置结构化 diff，定位最早受影响时刻，
  只重算该时刻之后的区间并与旧结果拼接
- `selfcheck.ts` — 对每个波次参数与全局参数施加扰动，断言
  增量重推结果与整体重推严格一致
- `cli.ts` — 批量入口

## 配置要点

- `waves[]`：每波 `durationMs / enemyCount / spawnIntervalMs / armorChance / bulletColor`；
  超出显式配置的波次按游戏公式自动生成（数量 15+(n-1)*5）
- `killPolicy`：玩家输出的抽象 —— `interval`（每 N 毫秒对最老存活敌人造成 1 点伤害）、
  `explicit`（按 `{timeMs, enemyId, damage}` 清单精确复算）、`none`
- `nukePolicy`：`auto`（能量满即触发）、`at`（指定时刻，能量满才生效）、`never`
- 机制参数：`maxEnergy / berserkThreshold / fireIntervalMs / armorFromWave` 等，
  默认值与 `Game.ts` 一致

## 输出结论（*.result.json）

- `events`：全量事件流，每条带时刻 `t`（毫秒）与敌人标识（`w<波次>-e<序号>`），
  覆盖生成 / 狂暴 / 开火（含弹幕形态、弹数、位置、颜色、狂暴标记）/ 死亡 / 逃逸
- `energyLedger`：能量账本，区分来源（`kill` 含击杀方式与敌人 id、`nuke-reset`）
- `nukes`：每次爆发的清场敌人集合、逐敌人得分归属、能量前后值、清除弹数
- `waves`：每波摘要（生成/击杀/逃逸/狂暴次数/得分/能量/各形态开火数），
  击杀按敌人所属波次归属，波次边界残余敌人不会混淆
- `energyCurve`：逐 tick 能量 / 存活数 / 波次采样
- `totals`：总分、击杀、逃逸、爆发次数、峰值能量

## 与 Game.ts 的对应关系

| 游戏内逻辑 | 推演实现 |
| --- | --- |
| `updateWave` 波次计时/生成/推进 | `Engine.step` 第 5 段 |
| `updateEnemies` 狂暴（存活 < 5）与 0.8s 开火 | `Engine.step` 第 1 段 |
| `createRandomPattern` 形态随机 | 种子化 RNG，事件记录形态 |
| `addEnergy` / `triggerNuke`（先清零再结算清场击杀） | `Engine.kill` / `Engine.nuke` |
| 波次推进需场上无存活敌人 | 与游戏一致，残余敌人会延迟下一波 |
