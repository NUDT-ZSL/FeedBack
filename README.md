# 古代蓝染工坊 · 靛蓝浸染模拟器

古代蓝染浸染氧化过程模拟互动应用。用户反复提拉布料使其氧化，观察颜色从淡绿
`#b5d8a7` 到深蓝 `#0a2c5d` 的色阶变化，并记录每一轮浸染数据。

React 18 + TypeScript + Vite，动画使用 framer-motion。

## 启动

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run check    # 仅类型检查
npm run verify   # 离线验证推演模块（无需浏览器）
```

## 架构：推演与界面分离

所有“参数 → 结果”的推演收敛在 `src/simulation/`（纯函数模块，不依赖 React/DOM），
界面只负责展示推演结果和触发操作：

```
src/simulation/
├── types.ts      # DyeingParams / DyeingResult / EngineState 等类型
├── constants.ts  # 10 个预设色阶、边界上限、模型常量、默认参数
├── derive.ts     # 参数清洗 + 分级推演 + 统一入口 derive()
├── engine.ts     # 浸染操作引擎（幂等、氧化锁定、历史回退）
└── index.ts
```

- 输入参数：`dyeConcentration`（染液浓度）、`dipDurationSec`（浸染时长）、
  `dipCount`（浸染次数）、`airDrySec`（晾晒时长）。
- 推演结果：氧化进度、剩余染液浓度/消耗量、布料着色深度、色阶与 HEX、浸染次数。
- 推演分两个阶段：吸色阶段只依赖浓度/浸染时长/浸染次数；氧化阶段只依赖浸染次数/
  晾晒时长（总晾晒时长 = 浸染次数 × 晾晒时长，乘积饱和钳制）。
- `derive(params, prev?)` 在传入上一次结果时只重算依赖发生变化的阶段；各阶段都是
  参数的纯函数，因此增量重算与全量重算严格一致。
- `applyDip(state, opId, now, params)` 对相同 `opId` 幂等去重，氧化锁定窗口内的
  连续点击返回 `'locked'` 且状态不变，杜绝浸染次数重复累加与结果前后矛盾。
- 所有非法/极端输入（NaN、Infinity、负数、超大浸染次数/晾晒时长）先经
  `sanitizeParams` 钳制，结果恒为有限、非负且不越界。

数据流：

```
用户操作/参数调整 → Home（唯一 derive 调用点）→ DyeingResult
                         ├→ GameBoard（染缸、布料、读数、提拉按钮、参数滑块）
                         └→ ColorRecord / CompletionModal（记录、回退、导出）
```

## 离线验证

`scripts/verify-simulation.mjs` 用 esbuild 将 `src/simulation/` 打包为临时 ESM 后在
Node 中运行，覆盖：极端取值边界（无负值/溢出/NaN）、同参数确定性、增量重算与全量
重算一致、操作幂等与快速连点去重、引擎记录与推演结果一致、历史回退后的结果一致性、
单调性与完成态可达。`npm run verify` 可离线重复执行。
