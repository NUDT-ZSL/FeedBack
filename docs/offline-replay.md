# 确定性状态推演与离线复算

## 架构

游戏规则集中在 `src/sim/`（纯 TypeScript，不依赖 three / cannon-es / DOM）：

- `src/sim/types.ts` — 事件（`GameEvent`）、副作用（`Effect`）、状态与快照类型。
- `src/sim/engine.ts` — `GameEngine`：唯一持有并修改规则状态（血量、得分、星星、
  燃烧、火焰柱、电梯、隐藏通道）的地方。
- `src/sim/replay.ts` — `runScenario`：给定带时间戳的事件序列和固定时间步，
  离线逐步推演出每一刻的完整状态快照。

运行时数据流（每帧）：

```
固定步累加器（1/60s）
  └─ world.step(fixedDt)          碰撞回调只调用 engine.queueEvent(...)
  └─ player.fixedUpdate(fixedDt)  输入力矩、坠落检测（同样只投递事件）
  └─ engine.step()                ① 按累计物理时间推进火焰/电梯/燃烧计时
                                  ② 事件按固定优先级排序 + 同帧同机关去重
                                  ③ 统一结算血量/得分/星星/解锁，返回 Effect[]
  └─ applyEffects(effects)        渲染层消费：UI、音效、粒子、击退速度
```

关键性质：

- **与渲染帧率解耦**：规则只随固定物理步推进；帧率变化只影响每帧执行几个固定步。
- **无真实时钟依赖**：火焰激活窗口（interval 周期、0.8s 激活）、电梯往返、燃烧
  无敌期全部由累计物理时间驱动，不再使用 `setTimeout` / `Math.random`。
- **同帧去重**：同一物理步内，同一火焰/锤子/星星/终点/通道奖励只结算一次；
  不同火焰同帧命中也只扣一次血（燃烧无敌窗口），与原行为一致。
- **确定性顺序**：事件结算顺序固定为 surface → hammer → fire → star →
  hiddenPath → goal → fall，与 cannon 回调次序无关。

## 离线复算

`runScenario({ duration, fixedDt?, config?, events? })` 返回
`effects`（每步的结算产物）和 `snapshots`（每步后的完整状态快照）。
同一份场景在任何机器上产出完全一致的结果；实时运行走的是同一个
`GameEngine`（`queueEvent` + `step`），因此离线结果与实时结果逐帧一致
（见 `test/engine.test.ts` 的“实时路径与离线 runScenario 逐帧一致”用例）。

## 批量跑场景（不需要浏览器）

```bash
npm install
npm test          # vitest run：单元测试 + scenarios/*.json 批量复算
```

`scenarios/` 目录下每个 JSON 就是一个独立场景：

```json
{
  "name": "场景描述",
  "duration": 6,
  "fixedDt": 0.0166667,
  "config": { "fires": [{ "id": "fire-0", "interval": 2 }] },
  "events": [
    { "time": 2.1, "event": { "kind": "fire", "id": "fire-0" } }
  ],
  "expect": [
    { "time": 2.5, "state": { "lives": 4, "fires": { "fire-0": { "active": true } } } }
  ]
}
```

- `events[].time` 为物理时间（秒），事件被投递到覆盖该时间点的固定步结算。
- `expect[].state` 支持部分匹配（只检查列出的字段）；数值可用
  `{ "$approx": 1.487, "$eps": 0.001 }` 做容差比较。
- 新增验证场景 = 往 `scenarios/` 丢一个 JSON，无需改测试代码；
  `test/scenarios.test.ts` 会自动发现并逐一复算比对。

已覆盖的场景：火焰激活窗口边界（`fire-window.json`）、同帧多机关与重复触发
（`same-frame.json`）、电梯上下限折返（`elevator-limits.json`）、
隐藏通道解锁边界（`star-unlock.json`）。
