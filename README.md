# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## 回放判定链路离线验证

`src/replay/` 提供与界面无关的判定引擎：导入空间记录与关键事件、按时间推进回放、矛盾记录裁决、受影响范围局部重推，并对缺失/成环的事件关联输出可观察诊断。

`verification/` 提供离线批量验证入口（仅依赖 Node.js 内置模块，无需联网、无需安装依赖）：

```bash
npm run verify          # 运行全部验证并与基线比对，结论变化时以非零码退出
npm run verify:update   # 固化当前结论为基线 verification/baseline.json
```

覆盖的验证项：

- 同一批记录以任意导入顺序回放，对象状态与事件影响范围一致；
- 矛盾记录双方保留，裁决仅重推受影响对象与时间区间，结果与整体重推一致；
- 事件关联指向缺失或成环时输出 `missing-link` / `link-cycle` 诊断，不静默跳过；
- 记录修正后受影响范围的局部重推与全量重推一致。

输入样例位于 `verification/fixtures/`（本地文件，无在线依赖）；每次运行输出 `verification/out/report.json`。输入顺序、记录修正或裁决发生变化导致结论改变时，基线比对会失败并列出差异路径，而非静默通过。

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
