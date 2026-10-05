# 日月食推演链路自动化验证

本目录为推演链路提供**零依赖、可离线重复执行**的自动化验证能力。
整条推演链路（输入参数 → 食分 → 初亏/食甚/复圆时刻 → 可见性判定 → 历代记录比对）
已实现为纯函数模块 `src/eclipse/`，不依赖 DOM / Three.js / 网络，页面与测试共用同一份口径。

## 一键复核

```bash
npm run verify          # 批量执行全部验证（node:test，无需安装任何依赖，Node >= 22.18）
npm run verify:update   # 口径调整后重新固化黄金基线 tests/fixtures/golden.json
npm run check           # TypeScript 类型检查（需 npm install 一次）
```

`npm run verify` 只使用 Node 内置能力（`node:test` + 原生 TypeScript 类型擦除），
不需要 `node_modules`，断网环境下可重复运行。

## 目录结构

- `src/eclipse/julian.ts` — 儒略日/角度工具（连续时间轴，跨日不绕回）
- `src/eclipse/ephemeris.ts` — 日/月位置与视半径、地球本影半影半径（确定性低精度星历）
- `src/eclipse/eclipse.ts` — 食分计算、食型分类、相位时刻求解、可见性判定
- `src/eclipse/records.ts` — 历代记录比对（关联窗口 + 容差判定）
- `src/eclipse/data/shoushi-records.ts` — 本地固化的《授时历》记录基准数据
- `scripts/generate-golden.ts` — 黄金基线生成器（用例清单唯一定义处）
- `tests/fixtures/golden.json` — 固化的输入样例与期望结论
- `tests/boundary.test.ts` — 全食/偏食/环食分界、食分趋零临界
- `tests/phase-ordering.test.ts` — 初亏≤食甚≤复圆，跨日/跨时区/极区 + 百年扫描
- `tests/consistency.test.ts` — 食分与可见性自洽性扫描
- `tests/records.test.ts` — 记录比对五种结论与阈值边界
- `tests/golden.test.ts` — 端到端黄金基线回归

## 覆盖的风险点

1. **食型分界临界**：中心距恰好等于半径和/半径差、月径≈日径的全环食分界、
   食分趋零的擦边事件（含 1280–1380 年真实扫描样本）。
2. **相位时刻一致性**：跨午夜、±12/+14 时区、南北极区观测条件下
   初亏/食甚/复圆的先后与单调关系；同一事件不同时区下时刻不变。
3. **食分与可见性自洽**：可见 ⇒ 食分必为正；不可见 ⇒ 必给出 below-horizon 原因；
   食分不随观测点变化；可见窗口落在食象持续区间内。
4. **记录比对**：record-match / magnitude-deviation / type-mismatch /
   no-record / none-event 五种结论及阈值端点（含 1e-9 容差，避免浮点边界抖动）。

## 口径调整后的复核流程

1. 修改 `src/eclipse/` 中的推演逻辑；
2. `npm run verify` —— 若行为变化属预期，黄金基线用例会失败并提示；
3. 确认新结论正确后 `npm run verify:update` 重新固化基线；
4. 将 `tests/fixtures/golden.json` 的 diff 与代码改动一并提交评审。
