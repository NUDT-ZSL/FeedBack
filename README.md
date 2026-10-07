# 古代阵法推演

浏览器端古代阵法推演沙盘：拖拽布阵、选择阵法（鱼鳞/方圆/鹤翼）、触发连续多局对战推演。

## 常用命令

- `npm run dev`：本地开发
- `npm run build`：类型检查 + 生产构建
- `npm run verify`：离线批量验证（连续 25 局推演，逐局核对士气、兵力、历史承接、
  归零判负/平局边界与同种子可重复性，失败时以非零码退出）

## 士气机制

- 士气（0–100）影响棋子移动速度与交战攻击系数；局内仅随战损同步推导（阵亡扣分、击杀回升）。
- 一方兵力清零或士气归零即判负；双方同一步同时崩溃按平局；士气归零后不再继续结算。
- 连续多局士气承接上一局终值；历史记录（上限 20 条）含每局士气区间与双方最终兵力，
  恢复历史时棋盘、士气、阵型、战报一并还原；旧记录淘汰不影响士气承接。

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
