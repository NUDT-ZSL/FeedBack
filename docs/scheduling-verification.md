# 排产推演离线验证

## 入口

```bash
npm run verify    # 等价于 node src/verify/index.ts
```

- 纯 Node（>= 22.18，利用原生类型擦除直接运行 TypeScript），不安装任何依赖、不访问网络、不依赖外部服务，可离线重复执行。
- 全部场景通过时退出码为 0；任一检查失败时退出码为 1，并逐条打印失败明细。

## 被验证对象

`src/scheduling/` 是排产推演的纯逻辑模块（无 IO）：

- `engine.ts` 提供两条路径：
  - `deriveSchedule(input, pins?)`：整体排布推导。按拓扑序（同层按工序 id 升序）为每道工序确定性地选择“最早可行起点 → 能耗率更低 → 设备 id 更小”的设备；代价 = 时长 × 设备能耗率。`pins` 为冲突来源保留裁决，钉住工序自推导开始即占用设备时段，其余工序绕开。
  - `reschedulePartial(input, basePlan, { change, pins })`：局部重推。只重推受影响工序（结论相对基线发生变化的工序），未受影响工序钉回原位；结果与同等裁决条件下的整体重排一致。
- 输入校验错误码：`DEPENDENCY_CYCLE`（依赖成环）、`DEPENDENCY_MISSING`（依赖指向缺失）、`CAPABILITY_UNCOVERED`（设备能力无法覆盖工序）、`PIN_INVALID`（裁决位置非法）、`UNFEASIBLE`（无可行排布）。

## 验证覆盖的边界

`src/verify/scenarios.ts` 中的每个场景钉住一条边界：

| 场景 | 边界 |
| --- | --- |
| A-baseline | 基线排布与能耗代价结论 |
| B-dep-cycle / C-dep-missing | 依赖成环 / 依赖指向缺失必须被拒绝 |
| D-capability-uncovered / G-capability-removed | 设备能力无法覆盖工序（静态输入 / 属性被改动后） |
| E-window-shrink | 设备时段收缩后只重推受影响工序，结论与整体重排一致 |
| F-energy-rate / I-rate-tie-break | 能耗率调整：代价结论更新、并列设备选择翻转 |
| H-pin-conflict | 冲突来源保留裁决：钉住工序不动，重推结果与整体一致 |
| J-pin-invalid | 非法裁决必须被拒绝 |
| K-unfeasible-static / L-unfeasible-after-change | 无可行排布（静态 / 调整后），两条路径错误结论一致 |

## 失败分类

验证装置（`src/verify/harness.ts`）把失败分为三类，用于区分问题性质：

- `SCHEDULE`：排布结论错（设备/起止时间不一致、钉住约束被破坏、错误码不符）。
- `COST`：代价结论错（单工序代价或总代价不一致）。
- `SCOPE`：受影响范围漏推（结论发生变化的工序未出现在受影响集合中，或受影响集合与钉住的期望不一致）。

每个局部重推场景做四层核对：局部重推 vs 整体重排（一致性）、局部重推 vs 人工参考结论（正确性）、受影响范围漏推检查、钉住约束保持检查。

## 变异自检

入口末尾的 `self-check` 会对验证装置本身做变异自检：分别注入排布变异、代价变异、受影响范围漏推变异，确认比较器能把它们分别识别为 `SCHEDULE` / `COST` / `SCOPE`。自检失败同样使整体失败——避免“边界被破坏却观察不到”。

## 新增场景

在 `src/verify/scenarios.ts` 的 `scenarios` 数组中追加一项：给定输入、可选的整体推导期望（`expectedPlan` / `expectedError`）、可选的局部调整（`change`、`pins`、`expectedPartialPlan`、`expectedPartialError`、`expectedAffected`）即可，入口会自动纳入批量执行。
