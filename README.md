# 古代造纸作坊互动应用

明代宣纸作坊的交互式 Web 应用（React + TypeScript + Vite + Zustand）。

## 结构

- `src/PaperWorkshop.tsx` — 场景与交互组件（动画、拖拽、点击）
- `src/store.ts` — Zustand 状态层，只做交互守卫与状态搬运，判定一律委托推演层
- `src/simulation/` — 与 UI/计时/随机数完全解耦的纯逻辑推演层
  - `engine.ts` — 浓度、均匀度、压榨力度、干燥进度、检验得分的纯函数与操作推演
  - `types.ts` — 推演状态、操作、轨迹、越界标记类型
  - `history.ts` — 历史记录容错解析（兼容旧数据）
  - `index.ts` — 统一导出
- `scripts/simulate.ts` — 离线批量推演入口

## 离线批量推演

```bash
npm run simulate            # 人类可读输出：逐步中间量 + 越界标记 + 最终评级
npm run simulate -- --json  # JSON 输出，便于接入其他工具
```

固定输入序列覆盖：正常流程、配料总量越界、压榨力度越界（过高/过低）、
干燥未完成即检验、检验点超上限、非法工序顺序；末尾附重复推演一致性与
旧记录解析自检。

## 推演层设计

- **纯函数、确定性**：引擎不调用 `Math.random()`、`Date.now()` 或任何计时器；
  随机因素以 `rng: () => number` 的形式外部注入。批量推演使用固定 seed 的
  `createSeededRng(seed)`（mulberry32），同一输入重复推演结果完全一致。
  UI 层在 `store.ts` 中注入 `Math.random`，交互体验不变。
- **可观察的边界结论**：每步操作产生一条 `SimTraceEntry`，含 `applied`、
  `violations` 与操作后的完整状态快照。越界不会静默跳过：
  - `MATERIAL_OUT_OF_RANGE` / `CONCENTRATION_OUT_OF_RANGE`：配料单项或总量越界，按边界值计并标记
  - `PRESS_OUT_OF_RANGE`：压榨力度超出 [70, 90]，工序继续但评分反映
  - `INSPECT_BEFORE_DRIED`：干燥未达 100% 即检验，点计入但标记，得分按实际干燥度
  - `INSPECTION_LIMIT_EXCEEDED`：检验点超过 10 个上限，本次拒绝并标记
  - `INVALID_SEQUENCE` / `NO_PAPER`：非法工序顺序或缺纸坯，拒绝并留痕
- **历史兼容**：`parseHistoryRecords` 容错解析 localStorage 旧数据，缺失字段
  补默认值、坏记录跳过、损坏 JSON 返回空列表，已有记录可继续展示。

## 开发

```bash
npm install
npm run dev
```
