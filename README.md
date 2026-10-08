# 紫檀木躺椅工坊

基于 React + TypeScript + Vite + Three.js 的 3D 木作模拟应用：选料 → 加工（刨子/凿子）→ 拖拽组装 → 成品 360° 展示。

## 离线验证（加工与组装链路）

无需安装任何依赖、无需启动页面，一条命令批量验证加工/组装/吸附/展示/重置全部行为与边界：

```bash
npm test          # 等价于 node scripts/run-tests.mjs
```

- 运行环境：Node.js >= 22.6（推荐 22 LTS），使用内置 `node:test` 运行器，完全离线。
- 测试位于 `tests/`，直接针对核心状态模块（`src/Assembly.ts`、`src/Materials.ts`）断言：
  - `tests/assembly-processing.test.ts` —— 加工完成标记与可拖拽/可组装前置条件一致；
  - `tests/snap-distance.test.ts` —— 吸附阈值（含边界）、位置缺失与 NaN/Infinity 等异常输入；
  - `tests/assembly-completion.test.ts` —— 全部组装完成进入展示态、光环/旋转触发与重复触发幂等；
  - `tests/reset-reselect.test.ts` —— 重置回到初始态（含未结束光环定时器清理）、重选木料不残留旧结果。

## 开发

```bash
npm install
npm run dev
```

---

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
