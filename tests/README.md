# 茶道模拟器参数链路离线验证

针对「水温 / 注水角度 / 冲泡时长 → 预设切换 → 参数校验 → 告警闪烁」这条链路的
可离线批量运行的行为验证，不依赖网络、真实浏览器或外部账号。

## 运行

```bash
npm test          # 等价于 node tests/run.mjs
```

要求 Node.js >= 22.18（内置 TypeScript 类型擦除，直接加载 `src/TeaController.ts`，
零第三方依赖，无需 `npm install`）。退出码 0 表示全部通过，1 表示存在失败用例。

## 结构

- `tests/run.mjs` — 统一入口，顺序执行全部套件并汇总结果
- `tests/helpers/fake-timers.mjs` — 可控假定时器，`advance(ms)` 加速推进时间，
  用于在无真实等待下判定告警闪烁的启停时刻与翻转次数
- `tests/helpers/dom-stub.mjs` — 最小 DOM 替身，实现 `querySelector`/`classList`
  并统计翻转次数
- `tests/helpers/env.mjs` — 每个用例的独立环境（新控制器 + 事件记录）
- `tests/preset-load.test.mjs` — 预设加载后参数落在推荐区间、当前预设被记录
- `tests/param-warning.test.mjs` — 参数越界时校验结果与告警状态一致，调回后告警停止
- `tests/preset-switch.test.mjs` — 连续切换预设再手动调参，无上一预设残留判定
- `tests/reset-dispose.test.mjs` — reset 归零、dispose 后回调静默
- `tests/warning-flash.test.mjs` — 告警闪烁的定时行为（0.5s 周期、6 次翻转、
  自动停止、重复触发计数）

## 说明

- 被测链路（`TeaController`）不依赖 Three.js，因此无需 3D 替身；`WaterEffect` 等
  Three.js 模块不在本验证范围内。
- 告警闪烁原实现周期 0.5s、翻转 6 次（共 3s）后自动停止，与 PRD「闪烁周期 0.5s，
  持续 3s 后停止」一致；验证通过假定时器断言该契约。
