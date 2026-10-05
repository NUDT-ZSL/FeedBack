# 古代水车灌溉系统

灌溉推演与渲染解耦的可视化应用：水车转速、渠道分流、田块蓄水、作物缺水判定
全部由独立的推演引擎产出，界面只负责展示与交互，同一套引擎同时支撑离线批量复算。

## 目录结构

```
src/
├── simulation/          # 独立推演引擎（纯 TypeScript，无 React/DOM 依赖）
│   ├── types.ts         #   输入/输出类型：ScenarioInput、SimulationResult 等
│   ├── engine.ts        #   核心推演：转速→分流→蓄水→缺水判定，定点舍入保证确定性
│   ├── incremental.ts   #   增量重算：局部调整后只重算受影响分支
│   ├── sampleData.ts    #   本地样例场景（与 scenarios 基准场景一致）
│   └── index.ts         #   统一入口
├── components/sim/      # 界面组件（参数面板 / 结论面板 / 增量自检）
└── pages/Home.tsx       # 主界面，仅展示引擎结论
scripts/run-scenarios.ts # 离线批量推演入口（Node ≥ 22 原生运行 TS）
scenarios/               # 批量场景样例（6 组参数口径）
reports/                 # 批量推演报告输出目录
```

## 推演口径（每个 tick）

1. 渠道分流：`allocated = upstreamInflow × shareRatio`
2. 水车提水：`speed = gateOpening × sin(sailAngle°) × 0.8`，`lifted = min(allocated, speed × liftEfficiency)`
3. 田块蓄水：`storage = clamp(storage + inflow - evaporation, 0, capacity)`
4. 缺水判定：`storage < cropDemandThreshold` 判定缺水，逐 tick 记录依据可追溯

## 常用命令

```bash
npm run dev        # 启动界面（结论实时来自推演引擎）
npm run simulate   # 离线批量推演：多组场景 + 确定性校验 + 增量一致性校验
npm run check      # TypeScript 类型检查
npm run build      # 构建
```

## 离线复算与一致性

- 同一份输入重复推演结果逐字节一致（无随机数、无系统时间、输出定点舍入）。
- 每次推演产出 FNV-1a 校验和：界面默认样例与 `scenarios/sample-scenarios.json`
  的 `baseline` 场景校验和相同，可直接与 `reports/batch-report.json` 对照。
- 界面“导出场景 JSON”可导出当前参数，配合
  `npm run simulate -- --input <file> --out <report>` 离线复算同一结论。
- 局部参数调整（分流比例 / 来水量 / 田块容量 / 作物阈值 / 水车工况）只重算
  受影响分支，`verifyIncrementalConsistency` 保证与整体重算结果一致。
