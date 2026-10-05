# React + TypeScript + Vite

## 造纸作坊推演层

判定与流程推进逻辑已从交互层剥离为纯逻辑层，可脱离界面独立推演：

- `src/simulation/engine.ts`：纯推演引擎。配料、抄纸、压榨、晾晒、检验、定级全部以操作序列驱动，不依赖真实计时与全局随机数；随机因素通过 `RandomSource` 注入（交互层传 `Math.random`，批量推演传 `createSeededRandom(seed)`），同一输入重复推演结果完全一致。配料越界、压榨力度越出合理区间、干燥未完成即检验、检验点超上限等边界均产生可观察的 `SimulationIssue` 与中间状态快照。
- `src/simulation/history.ts`：历史记录兼容解析，旧结构记录缺字段或越界时按默认规则补齐，保证已有数据可继续读取展示。
- `scripts/simulate.ts`：离线批量推演入口，固定输入序列覆盖正常流程与全部边界情形，逐项输出中间量与最终评级。

```bash
npm run simulate   # 离线批量推演（无需安装依赖，Node >= 22 直接运行）
npm run check      # 类型检查
```

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

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
