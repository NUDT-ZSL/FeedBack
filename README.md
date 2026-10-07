# 木料印章工坊

## 离线状态一致性验证

验证能力零依赖、可离线运行（Node >= 22，直接执行 TypeScript，不需要 `npm install`，不加载网络字体或外部服务）：

- `npm test` — 单元级状态一致性测试（`node:test`，16 项），覆盖：
  - A 组：批量连续刻印的状态隔离（切换木料、修改尺寸、重复盖印同一方印）
  - B 组：导出/清空边界（记录、选中木料、校验结果同步重置，清空后新印无残留）
  - C 组：木料属性 × 尺寸 × 字体的参数校验（边界值稳定性、批量与单次一致）
- `npm run verify` — 统一批量运行入口 `scripts/verify-seals.ts`，批量复现上述场景（416 项检查），全部通过时退出码为 0，任一失败为非 0，可接入 CI。

核心领域逻辑在 `src/seal/`（纯 TypeScript，无 DOM/网络依赖）：

- `src/seal/model.ts` — 印稿、刻印、盖印记录、导出产物等数据模型
- `src/seal/validation.ts` — 由木料硬度/韧性推导的尺寸范围与字体可用性校验（纯函数）
- `src/seal/workshop.ts` — 工坊状态机（选料、刻制、盖印、导出、清空）

## 页面开发

- `npm run dev` — 启动 Vite 开发服务器
- `npm run build` — 类型检查并构建
