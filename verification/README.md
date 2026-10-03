# 轨迹推演离线验证套件

对“停留段/移动段划分、同行关系识别、修正后增量重推”提供可复现、可追溯的自动化验证。
全部使用本地构造的确定性样例数据（固定时间戳 + 固定随机种子 `mulberry32`），
不依赖任何外部服务或网络。

## 运行

```bash
npm run verify
```

等价于 `node --test --test-reporter=spec "verification/*.test.ts"`。
仅使用 Node.js 内置模块（`node:test` / `node:assert`），无需 `npm install` 即可运行，
要求 Node.js >= 22.18（直接执行 TypeScript 类型擦除）。退出码非 0 即存在失败。

单文件运行：

```bash
node --test verification/incremental.test.ts
```

## 覆盖范围

| 验证文件 | 可观察结果 |
| --- | --- |
| `segmentation.test.ts` | 按时间顺序划分为停留/移动段；采样抖动仍判停留；超 `maxGapMs` 断段；时间倒序、坐标缺失、非法时间戳均以 `Anomaly(kind, pointId, detail)` 显式暴露；同输入同参数结果可复现 |
| `cotravel.test.ts` | 多目标时间区间完全包含、部分重叠、移动段平行同行均取时间交集；超距离阈值或无时间重叠则无同行 |
| `incremental.test.ts` | 修正位置点后仅受影响时间窗口内分段重推、窗口外分段与同行区间对象引用不变；判定参数调整只重推翻转的边界分段；增量结果与全量重推状态逐字节一致（`assertStateEqual`）；重推日志 `recomputeLog` 可追溯 |

## 失败定位

- 用例名称中直接标注涉及的位置点与参数组合，例如
  `[point=A-home-4, window=[+0,+30]]`、`[minStayDurationMs 10min→15min]`、
  `[stayRadiusMeters=60, jitter=8m]`。
- 增量重推的每次操作生成带序号的 `RecomputeReport`（原因、目标、时间窗口、
  重推分段 ID、重推目标对），可从 `engine.recomputeLog` 追溯。
- 增量与全量不一致时，断言信息以
  `状态与全量重推不一致: <point 或参数组合>` 开头。

## 目录

```
src/trajectory/        被验证的推演核心（纯函数，无 IO）
  types.ts             数据类型、目标对 key 规则
  geo.ts               haversine 距离、质心、线性插值
  segment.ts           校验/排序 + 停留-移动分段
  cotravel.ts          目标对同行时间区间识别
  engine.ts            全量与增量推演引擎（受影响窗口 + 对象复用 + 重推日志）
verification/
  fixtures.ts          确定性样例数据与默认判定参数
  helpers.ts           全量重推对照与状态等价断言
  *.test.ts            node:test 用例
```
