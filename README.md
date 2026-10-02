# React + TypeScript + Vite

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

## 造纸作坊：纯推演层与批量推演

判定逻辑已从交互层剥离，集中在 `src/simulation/`（纯 TypeScript，无框架依赖）：

- `src/simulation/types.ts`：配料、操作序列、中间量、边界事件、结论与历史记录类型
- `src/simulation/constants.ts`：各环节阈值与速率（配料总量区间、压榨力度区间、检验点上限、干燥目标）
- `src/simulation/engine.ts`：`WorkshopEngine` 按操作序列推进配料→抄纸→压榨→晾晒→检验，输出浓度、均匀度、压榨力度、干燥进度、检验得分与最终评级；随机因素通过 `random`/`seed` 注入，默认固定种子，同一输入重复推演结果完全一致
- `src/simulation/history.ts`：历史记录读写与旧版（v1）记录迁移，旧数据可继续解析展示
- `src/hooks/useWorkshop.ts`、`src/pages/Home.tsx`：交互层仅收集输入并调用引擎，不做任何判定

边界情形（配料总量越界、压榨力度出区间、干燥未完成即检验、检验点超上限、环节乱序）都会产生可观察的 `BoundaryEvent` 与结论依据，不会静默跳过。

离线批量推演（覆盖正常流程与全部边界，含确定性自检）：

```bash
npm run simulate
```
