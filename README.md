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

## 风水推演模块（src/fengshui）

推演能力已从 `src/utils.ts` 拆分为职责独立、可单独调用的纯函数模块：

- `src/fengshui/heading.ts`：朝向与二十四山换算（`normalizeAngle`、`angleToMountainIndex`、`angleTo24Mountain`）
- `src/fengshui/dragonVein.ts`：龙脉走势判定（`judgeDragonVein`，阈值 `DRAGON_VEIN_HEIGHT_THRESHOLD = 100`，严格大于为山局）
- `src/fengshui/commentary.ts`：批语生成（`computeCommentarySeed`、`selectCommentary`、`renderCommentary`、`generateFengshuiCommentary`）
- `src/fengshui/analyze.ts`：完整推演管线 `analyzeFengshui`，一次返回朝向、龙脉、批语各环节中间结果与最终批语

`src/utils.ts` 继续以相同签名 re-export `angleTo24Mountain` / `generateFengshuiCommentary`，页面行为不变。

## 离线批量推演

```bash
npm run deduce                          # 运行内置边界用例（分界角度、阈值边界、极端坐标），输出 JSON
npm run deduce -- --input cases.json    # 自定义用例
npm run deduce -- --output result.json  # 写入文件
npm run verify-parity                   # 与重构前实现逐条比对（内置边界用例 + 2 万组模糊用例）
```

自定义用例格式：`[{"label": "...", "position": {"x":0,"y":0,"z":0}, "height": 100, "dragonAngle": 202.5}]`
