# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## 风水推演模块（src/fengshui）

推演能力按职责拆分为可独立调用的模块，页面侧仍通过 `src/utils.ts` 的原签名访问，外部行为不变：

- `src/fengshui/compass.ts`：朝向与二十四山换算。`normalizeAngle`（角度归一化）、`angleToMountainIndex`、`angleTo24Mountain(angle) -> { mountain, direction }`。
- `src/fengshui/dragonVein.ts`：龙脉走势判定。`judgeDragonVein(height)`，高度大于阈值 `DRAGON_VEIN_HEIGHT_THRESHOLD = 100` 判为龙脉（山），否则为水局。
- `src/fengshui/commentary.ts`：批语生成。`computePositionSeed`（位置/高度确定性种子）、`pickCommentaryIndices`、`analyzeFengshui(position, height, dragonAngle)` 返回全部中间结果与最终批语；`generateFengshuiCommentary` 保持原签名，仅返回批语文本。
- `src/fengshui/batch.ts`：批量推演。`runBatchFengshui(cases)` 对每条用例输出各环节中间结果、最终批语及重复推演稳定性标记。

### 离线批量推演入口

```bash
npm run fengshui:batch                 # 使用内置边界用例（分界角度、阈值边界、极端坐标、重复推演）
npm run fengshui:batch -- cases.json   # 使用自定义用例文件
```

用例文件为 JSON 数组，元素形如 `{ "name": "...", "dragonAngle": 15, "position": { "x": 0, "y": 0, "z": 0 }, "height": 120 }`。输出为 JSON，包含每条用例的归一化角度、二十四山、龙脉判定、随机种子、模板下标与最终批语；若任一用例重复推演结果漂移，进程以非零码退出。

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
