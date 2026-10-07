# 古代阵法推演

基于 React + TypeScript + Vite 的古代阵法推演应用。

## 士气规则

- 士气范围 0–100，初始 100；同一局内士气随战损同步推导：己方每损失一子 -6，每歼灭一子 +3。
- 士气影响推演：移动速度系数 0.7–1.3、交战攻防系数 0.8–1.2（随士气线性变化）。
- 一方士气归零立即判负（溃败）且不再继续结算；双方同时归零或同时清零兵力按平局处理。
- 连续多局推演时，每局起点士气承接上一局结束士气；重置沙盘不会重置士气。
- 历史记录包含该局士气区间、双方最终兵力与棋子快照；点击历史条目可将棋盘、士气、阵型与结果恢复到该局结束状态。历史上限 20 条，旧记录被淘汰不影响士气承接链。

## 常用命令

- `npm run dev`：本地开发。
- `npm run build`：生产构建。
- `npm run verify`：离线验证入口。编译并运行 `scripts/verify-campaign.ts`，批量复现 25 局连续推演，核对每局士气承接、战损同步、历史淘汰与快照恢复一致性，以及士气归零判负、双方同归零平局等边界；全部确定可重复，失败时以非零码退出。

## React + TypeScript + Vite

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
