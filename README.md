# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## 正骨处理管线（可离线推演）

复位判定与固定流程已从交互回调中抽离为无 UI 依赖的纯函数链路，位于 `src/pipeline/`：

- `reduction.ts`：由骨折类型推导各关节目标角度与允许偏差（`deriveReductionPlan`），逐关节计算偏差并汇总整体结论（`evaluateReduction`），局部修正只重算受影响关节（`reevaluateJoint`），结果与全量重算一致。
- `fixation.ts`：固定材料状态机。顺序跳跃返回 `ORDER_VIOLATION` 并带 `expectedNextMaterialId`，位置错误返回 `WRONG_POSITION`，重复放置返回 `ALREADY_PLACED` 且已放置集合不变，复位未达标返回 `REDUCTION_NOT_PASSED`；每次尝试（含拒绝原因）都记入日志。
- `session.ts`：`TreatmentSession` 串联整条链路，角度来源区分 `manual` / `random` / `batch`，同一关节多次调整以最后一次生效、全部记录保留，`exportReport()` 导出各关节偏差、复位结论、固定顺序与拒绝原因。
- `batch.ts`：统一批量入口 `runBatchScenario`，可按构造好的操作序列离线推演，并自动校验增量重算与全量重算一致。

`src/store.ts` 与离线批量入口共用上述同一套判定逻辑。

### 离线验收

不依赖音频和画布，运行：

```bash
npm run verify:pipeline
```

脚本覆盖：复位门槛、顺序跳跃、位置错误、重复放置、多次调整最后生效、来源区分，以及局部增量重算与整体重算的逐步一致性；有断言失败时进程以非零码退出。

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
