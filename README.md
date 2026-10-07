# 西市调香坊

调香流程状态链：加料 → 研磨 → 合香 → 放置 → 点燃 → 重置。

## 状态机与离线验证

- `src/incense/machine.ts`：纯函数状态机，全部状态迁移（`addIngredient` / `addGrind` / `createIncense` / `placeIncenseOnCenser` / `ignite` / `tick` / `reset`）只依据当前有效状态推进；非法或重复触发会被拒绝并保持状态不变。香品颜色、研磨度在合成时快照，燃烧粒子与计时由同一 `tick` 推进。
- `src/store.ts`：zustand 薄适配层，仅把状态机结果映射为组件可用的扁平字段。
- `npm run verify`：离线运行 `scripts/verify.ts`（Node ≥ 22，无需安装额外依赖），覆盖重复加料、超限加料、合成后继续加料、放置后再合成、燃烧中重置等场景；每一步都会做不变量检查，输出直接标明不一致发生在哪个场景、哪一步。

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
