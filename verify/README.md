# 三维时序回放判定链路 · 离线批量验证

为“三维时序回放与关键事件定位工作台”的判定链路（导入 → 回放推进 → 事件关联推导 → 矛盾记录裁决 → 局部重推）提供的离线批量验证能力。零外部依赖（仅用 Node 内置模块），不访问网络，本地样例内联，可重复执行并给出可判定的通过/失败结果。

## 运行

```bash
npm run verify          # 人类可读报告，退出码 0=全部通过 / 1=存在失败
npm run verify:json     # JSON 报告（供 CI 消费）
```

要求 Node ≥ 22.18（直接执行 TypeScript，无需安装任何依赖、无需构建）。

## 目录结构

- `verify/core/` —— 判定链路纯函数实现（被验证对象，也是链路衔接的参考实现）
  - `importer.ts` 导入与引用校验：指向缺失 / 自引用 / 成环（Tarjan SCC）全部落成可追溯 `Anomaly`，绝不静默跳过；异常边仅从推导图剔除，记录本身仍参与回放
  - `derive.ts` 事件关联推导：沿清洗后的依赖边求闭包，得到影响对象集合与回放区间
  - `timeline.ts` 时间线构建与矛盾识别：同对象同时刻不同状态即矛盾，裁决前双方保留
  - `engine.ts` 回放引擎：回放推进（`advance(t)`）、矛盾裁决（`adjudicate`）、事件关联修正/撤回（`correctEventLinks` / `withdrawEvent`）、局部重推（`partialRecompute`）与整体重推基准（`fullRecompute`）
  - `canonical.ts` 规范化序列化：结论比对与导入顺序、批次切分、插入顺序无关
- `verify/cases/` —— 六组批量用例（见下表）
- `verify/fixtures/` —— 本地样例数据（内联，无网络/服务依赖）
- `verify/run.ts` —— 批量入口：一次跑完全部用例，输出逐用例 PASS/FAIL 与失败归因类别

## 用例与判定类别

| 用例 | 类别 | 覆盖风险 |
| --- | --- | --- |
| 01-baseline-pipeline | `baseline` | 导入→推进→推导端到端基线 |
| 02-anomaly-attribution | `anomaly-attribution` | 指向缺失/自引用/成环可追溯归因，不静默跳过 |
| 03-conflict-adjudication | `conflict-adjudication` | 裁决前双方保留；裁决后只重推受影响对象与区间，且与整体重推一致；未受影响部分引用不变 |
| 04-event-link-update | `event-link-update` | 事件关联修正/撤回后受影响区间与影响范围更新，未受影响部分不被改动 |
| 05-order-batch-independence | `order-batch-independence` | 同一批输入在不同导入顺序、不同批次切分下结论与影响范围一致 |
| 06-guardrail-self-check | `guardrail-self-check` | 护栏自检：注入缺陷的错误实现必须被对应类别检查拦截，防止用例“永远通过” |

## 失败定位

任一断言失败都会抛出带类别前缀的 `CaseFailure`，批量入口在报告中输出
`失败归因: [类别] 具体差异`，并以退出码 1 结束；`--json` 模式下每个用例
附带 `category` 与 `error` 字段，可直接被 CI 按类别聚合。

## 可重复性

- 全部随机性来自固定种子的确定性 PRNG（`cases/assert.ts` 的 `mulberry32`）；
- 结论比对使用规范化 JSON（键排序 + 数组规范序），与 Map/数组插入顺序无关；
- 连续两次执行输出逐字节一致（已验证）。
