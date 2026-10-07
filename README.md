# 古风笺纸工坊

基于 React 18 + TypeScript + Vite 的古风笺纸定制应用：选底色、叠纹样、洒金、题字，
日光/烛光下预览，入匣导出 600×800 PNG 与分享文案。

## 架构：四段清晰边界

| 边界 | 位置 | 职责 |
| --- | --- | --- |
| 参数配置 | `src/core/types.ts`、`src/core/recipe.ts` | `PaperRecipe` 五类参数（尺寸/底色/纹样/洒金/题字）、归一化与边界收敛、分层哈希键 |
| 分层渲染 | `src/core/layers/*`、`src/core/compose.ts` | 每层是纯函数：参数 → 不可变显示列表（`DrawOp[]`）；合成顺序固定 |
| 题字排版 | `src/core/layers/inscriptionLayer.ts` | 竖排/横排布局，容量截断、坐标收敛，独立成层 |
| 导出产物 | `src/core/exporter.ts` | 入匣木匣合成、内容哈希、不可变 `ExportArtifact` 快照 |

`PaperPipeline`（`src/core/pipeline.ts`）是唯一入口：

- 每层按输入哈希键独立缓存，改某层参数只重算该层，其余层引用不变；缓存按键索引，参数改回即命中；
- 纹样顺序在合成阶段排序（`order` 升序，相同按 `id` 字典序），不参与单层渲染键；
- 洒金分布与冰裂纹等随机量全部由 `(尺寸, 密度)` 等参数的固定种子产生（`src/core/rng.ts`）；
- 导出产物按 `(配方哈希, 光源)` 缓存并冻结，后续改参数不影响已入匣的产物；
- 层叠关系固定：底色 → 纹样 → 洒金 → 题字 → 光源罩染（`LAYER_Z_ORDER`）。

预览与导出消费同一份显示列表（`paintOps`），光源为独立罩染层
（预览用同色 DOM 罩层做 0.8s 过渡，导出追加同值 rect 指令），所见即所出。

### 对外调用方式（保持不变）

- `renderPaper(canvas, recipe, lightMode)`：`src/utils/paperRenderer.ts`，兼容原 TECH 文档约定；
- `<ConfigPanel recipe onRecipeChange />`、`<PreviewPanel result lightMode ... />`：组件契约不变。

## 离线批量验证

```bash
npm run verify   # vitest run，纯 Node，无需浏览器/网络
```

覆盖的可观察结果（共 31 个用例，见 `src/core/__tests__/`）：

- `determinism`：同参数多次渲染/导出，逐层哈希与洒金分布完全一致；导出 == 预览；
- `isolation`：改底色/密度/题字/单层纹样时其它层引用不变；已入匣产物不被打乱；参数改回命中缓存；
- `boundaries`：密度 0/100/越界、角度步长、缩放透明度位置越界、order 并列、超长题字、未知 id 的稳定表现；
- `occlusion`：底色→纹样→洒金→题字→罩染的遮挡顺序；
- `paint.smoke`：全部指令类型在 mock Canvas 表面可绘制，且重复绘制调用序列一致。

## 其它命令

```bash
npm run dev      # 本地开发
npm run build    # 类型检查 + 生产构建
npm run check    # 仅类型检查
npm run lint     # ESLint
```
