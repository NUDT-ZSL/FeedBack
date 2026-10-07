# 排产推演离线验证

针对排产推演的两条路径（排布推导、局部重推）提供可离线运行的边界验证能力。
纯 Node.js 实现（ESM），零第三方依赖，不需要网络、数据库或任何外部服务，
也不需要先执行 `npm install`。

## 批量入口

```bash
npm run verify:scheduling        # 终端摘要，失败时退出码为 1
node scheduling/verify/run.js --json   # 机器可读的 JSON 报告
```

## 覆盖的边界

| 用例 | 路径 | 固定的边界 |
| --- | --- | --- |
| `full-baseline-pinned` | 排布推导 | 正常模型的排布结论与能耗代价结论被逐工序固定 |
| `boundary-dependency-cycle` | 排布推导 | 依赖成环必须以 `DEPENDENCY_CYCLE` 拒绝 |
| `boundary-dependency-missing` | 排布推导 | 依赖指向缺失工序必须以 `MISSING_DEPENDENCY` 拒绝 |
| `boundary-capability-uncovered` | 排布推导 | 设备能力无法覆盖工序必须以 `CAPABILITY_UNCOVERED` 拒绝 |
| `partial-device-window-shrunk` | 局部重推 | 设备时段收缩后只重推受影响工序（含下游传递），且与整体重排一致 |
| `partial-conflict-source-retained` | 局部重推 | 冲突来源保留裁决后，局部重推结果与整体重排一致 |
| `partial-energy-rate-changed` | 局部重推 | 设备能耗属性改动后代价结论必须重算 |

## 失败归类

每条失败都会归入以下类别之一，用于区分问题性质：

- `排布结论错`：工序的设备/起止时间与预期或整体重排不一致
- `代价结论错`：能耗代价未随排布或设备属性变化正确重算
- `受影响范围漏推`：局部调整后应被重推的工序未纳入受影响范围
- `边界拒绝不符合预期`：成环、缺失依赖、能力未覆盖等未被拒绝或拒绝码不符

## 目录结构

- `scheduling/engine.js`：排产推演引擎（模型校验、整体排布推导、局部重推、受影响范围计算）
- `scheduling/verify/cases.js`：边界用例与期望结论
- `scheduling/verify/run.js`：批量入口与报告输出

## 扩展用例

在 `cases.js` 的 `CASES` 中追加 `{ id, path, title, run }` 即可；
`run()` 返回失败对象数组（`{ category, detail }`），空数组表示通过。
