# 浑天仪星盘推演

古代星象师在浑天仪上标记行星轨迹、推演天象的交互应用。推演链路已拆分为可独立验证的分层架构：

## 分层架构

```
src/engine/            推演核心层（纯 TS，无 React/three/DOM 依赖，可在 Node 独立运行）
  types.ts             推演数据模型：轨道参数、三环角度、遮挡关系与判定依据、推演帧
  math.ts              向量/环带坐标系/角度投影/确定性哈希（FNV-1a + 键排序 JSON）
  orbits.ts            第一层：时刻+轨道参数+观测者视角 → 各星体三环角度与三维位置
  occlusion.ts         第二层：角度阈值 + 视位置角距双条件候选，深度/亮度/序号三级决胜
  engine.ts            第三层：时间量化缓存、参数时间线（增量失效）、批量推演
  scenario.ts          确定性示例星体生成（固定种子）
  verify.ts            批量推演 + 一致性校验（浏览器与 Node 共享）
src/useSimulation.ts   渲染层与引擎的唯一连接点
src/components/        渲染层：只消费 SimulationFrame，不计算任何角度/遮挡
tools/verify.ts        脱离渲染层的批量校验 CLI
tests/                 核心层单元测试（node:test）
```

## 关键性质

- **确定性**：同一时刻重复推演，三环角度与遮挡结论指纹（frame.hash）完全一致；时间轴按
  `timeQuantumMs`（默认 50ms）量化，拖动速度/帧率不影响结果。
- **遮挡判定**：两星体在任一环带角度差 < `angleThresholdDeg`（默认 3°）且视线方向视位置角距
  < `angularSeparationRad` 时构成候选；按 深度 → 视星等 → 稳定序号 三级决胜，每条结论携带
  环带、角度差、视位置角距、双方深度与决胜规则作为依据。
- **缓存复用**：已推演时刻命中帧缓存（O(1)）；位置缓存以
  `(星体, 参数版本, 倾角版本, 视角版本, 时刻)` 为键。
- **增量重推**：`updateBody({ effectiveFrom })` 在参数时间线上追加新版本，仅失效生效时刻之后的帧；
  未生效区间仍按旧参数推演，增量结果与整体重推逐帧一致（CLI 自动校验）。
- **规模**：遮挡候选用视图平面空间网格筛选（近线性），300 星体 × 241 时刻全量推演 < 1s。

## 命令

```bash
npm install
npm run dev       # 开发预览
npm test          # 核心层单元测试（15 项）
npm run verify    # 批量推演一致性校验 CLI（10 项检查，可传 --start/--end/--step/--bodies/--seed）
npm run build     # 类型检查 + 生产构建
```

页面右侧「批量推演校验」面板可在浏览器内直接运行同一套校验。
