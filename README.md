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

## 字幕—媒体对齐推演模块

在模板基础上新增的可交互对齐推演模块，入口为首页（`src/pages/Home.tsx` → `src/components/alignment/AlignmentPage.tsx`）。

### 文件结构与数据流向

| 文件 | 职责 |
|------|------|
| `src/alignment/types.ts` | 媒体信息、锚点、片段、问题、矛盾组、裁决、结论、漂移区间等类型 |
| `src/alignment/engine.ts` | 整段重推：问题检测、矛盾分组、漂移区间构建、单片段结论推导 |
| `src/alignment/incremental.ts` | 增量重推：锚点/片段/裁决/帧率变更时只重推受影响区间，未受影响结论对象原样复用 |
| `src/alignment/alignment.test.ts` | 验收测试（vitest）：矛盾保留、裁决一致性、增量==整体重推、可追溯性 |
| `src/store/alignmentStore.ts` | zustand 状态：所有变更操作都路由到增量重推 |
| `src/components/alignment/*.tsx` | 媒体/锚点录入、片段管理、矛盾裁决、结论与漂移趋势展示 |

数据流向：用户操作 → `alignmentStore` 变更输入 → `recomputeAlignment` 增量重推 → `result`/`affected` 更新 → 面板重渲染。

### 核心语义

- 偏移 = 字幕时刻 − 媒体时刻，锚点间分段线性插值，覆盖范围外按最近锚点外推并标记 `extrapolated`。
- 倒序、越界、重叠、锚点指向缺失只标记为 Issue，绝不静默丢弃；同一时刻来源矛盾的片段组成矛盾组，双方保留、待裁决。
- 裁决、锚点修正、片段增删、帧率调整后只重推受影响部分，结果与整体重推逐字段一致（测试保证）。

### 运行

- `npm run dev` 启动页面；`npm test` 运行验收测试；`npm run check` 类型检查。
