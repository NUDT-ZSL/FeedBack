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

## 陶器碎片拼合链路：离线验证

拼合核心与 UI 解耦，位于 `src/puzzle/`（纯 TypeScript，无 DOM / Three.js 依赖）：

- `src/puzzle/types.ts`：碎片几何、操作、事件轨迹、拼合结论等类型与吸附阈值常量。
- `src/puzzle/engine.ts`：拼合引擎（结构校验、吸附判定、进度推进、完成态结算、幂等/乱序处理）。
- `src/puzzle/entries.ts`：两个驱动入口——交互入口（有状态会话）与批量/回放入口（事件轨迹重放）。
- `src/puzzle/invariants.ts`：结论不变量审计（进度/完成态/事件轨迹/依赖一致性互相印证）。

### 运行验证

```bash
npm run verify        # 等价于 node verify/run.ts，需 Node >= 22.18，零第三方依赖
```

批量执行 `verify/cases/*.json` 中的全部用例，逐组输出 `[PASS]` / `[FAIL]` 及失败原因，
任一组失败时进程以退出码 1 结束，可直接接入 CI。

### 用例格式

- `run` 用例（默认）：`shardSet`（碎片几何 + 依赖）+ `operations`（操作序列）+ `expect`
  （`valid` / `complete` / `placed` / `errors` / `eventsInclude` / `eventsExclude` /
  `sameFinalStateAs` 跨用例最终状态基准）。
- `audit` 用例：`type: "audit"` + 伪造/污染的 `conclusion` + `expect.invariantFailures`，
  要求不变量审计精确报出指定失真。

新增用例只需在 `verify/cases/` 下添加 JSON 文件，无需改动运行器。
