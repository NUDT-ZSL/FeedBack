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

## 胶囊生命周期离线验证

核心领域逻辑位于 `src/core/capsule/`（类型、可注入时钟、生命周期服务、JSON 持久化），不依赖网络与外部账号，时间通过 `ManualClock` 精确控制。

统一批量运行入口（无需安装依赖，Node >= 22.18 直接运行 TypeScript）：

```bash
npm run verify
```

测试位于 `tests/`，覆盖：

- `tests/lifecycle.test.ts`：创建/编辑/投递/解锁全链路的状态、内容、时间戳一致性，状态不回退
- `tests/boundary.test.ts`：投递时间与开启条件的边界时刻（恰好等于、差 1ms）确定结论
- `tests/conflict.test.ts`：重复提交幂等（operationId）、过期版本冲突拒绝（expectedVersion）、顺序可预测
- `tests/persistence.test.ts`：保存/重载一致性，缺失、损坏、字段级缺陷与重复 id 的显式识别
