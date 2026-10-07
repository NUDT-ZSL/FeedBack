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

## 织造排产与工时推演

排产与工时推演已收敛为可离线调用的纯逻辑模块 `src/lib/scheduling/`，不依赖任何界面状态或系统时钟：同一批织机、订单与工序数据，无论从界面（`/scheduling`）、HTTP（`POST /api/schedule/run`、`POST /api/schedule/reschedule`）还是 CLI 进入，都得到一致的织机占用顺序、订单完成时刻与冲突裁决。

- 裁决规则：按 (订单优先级, 订单编号, 工序序号, 工序编号) 的规范顺序逐道工序裁决；工序先后约束与织机占用冲突统一在该顺序下裁决；候选织机取最早可行开始时刻，并列按织机编号稳定裁决。
- 冲突处理：固定指派互相重叠、固定指派违反先后约束、交付逾期等无法自动裁决的情形，保留双方（或保留安排）并生成带依据的 `ConflictRecord`，不静默择一。
- 局部重算：`reschedule(previous, nextInput)` 自动对比参数差异，仅重算受影响的订单与时间段（规范顺序上首个受影响工序之后的部分），结果与整体重算一致；优先级/候选织机/固定指派等结构性变更自动回退整体重算并在 `meta.reason` 说明。

常用命令：

```bash
npm run test:scheduling   # 引擎单元测试与性质测试（含局部重算==整体重算）
npm run schedule:check    # 离线验收：入口一致性 + 局部/整体一致性 + 冲突可追溯
```
