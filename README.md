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

## 收藏链路（collection domain）

收藏状态集中在 `src/collection/`，与 React 完全解耦、可离线推导：

- `constants.ts`：印章形状/印色/印文、旋转与位置合法区间、题跋上限等既有可选范围。
- `validate.ts`：印章、题跋、卷轴的裁决逻辑；越界或缺失取值一律产出 `AdjudicationRecord`（含输入、裁决决定、理由），不静默吞掉。
- `derive.ts`：整体重推 `deriveAll` 与顺序归一 `normalizeOrder`（冲突按收藏时间再按 id 字典序确定性裁决）。
- `store.ts`：`CollectionStore` 单状态源；局部重推只重算被修改记录与受影响顺序位，结果与整体重推一致。
- 页面通过 `src/hooks/useCollection.ts` 的 `useSyncExternalStore` 订阅同一份状态，不再各存副本。

### 批量验证（离线）

```bash
npm run verify:collection
```

覆盖：正常收藏、印章越界（形状/颜色/旋转/位置）、题跋为空与超长、顺序冲突与非法顺序归一、单条修改/调序/清除后局部重推与整体重推的一致性。卷轴素材为 `public/samples/` 本地样例，验证不发起任何网络请求。
