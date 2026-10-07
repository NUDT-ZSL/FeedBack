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

## 工序状态机架构（视图与逻辑解耦）

宣纸制作流程的核心逻辑已从视图层抽离到 `src/core/`，均为无框架依赖的纯 TypeScript 模块，可在无浏览器环境下独立运行与批量验证：

- `src/core/processMachine.ts` — 工序状态机。`reduce(state, event)` 为纯函数状态转移，所有外部操作（拖拽、点击、切换阶段）收敛为语义事件，每个事件基于上一份状态原子推进，快速连续操作（如捞纸连续拖拽与晒纸 tick 交错）不会互相覆盖 `uniformity` / `dryness` 等质量字段。
- `src/core/particleSystem.ts` — 粒子系统内核。保持既有约束（蒸汽 30 颗/秒、打浆粒子上限 200、对象池回收复用）；canvas 仅通过 `attachCanvas` 显式绑定，`dispose()` 统一释放粒子、对象池与渲染目标引用。
- `src/hooks/useProcessMachine.ts` / `src/hooks/useParticleSystem.ts` — React 薄适配层，仅负责订阅状态与在组件卸载时 `dispose()`，不含业务逻辑。

### 无浏览器批量验证

```bash
npm test        # vitest（Node 环境），覆盖状态推进、质量计算、状态覆盖与资源释放回归
npm run check   # 类型检查
```

回归测试位于 `src/core/__tests__/`，包括：快速连续拖拽下 `uniformity`/`dryness` 不互相覆盖、粒子数量上限与回收、组件卸载后粒子系统不再持有 canvas 引用等场景。
