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

## 状态链路离线验证

灯笼铺模拟器的骨架搭建、裱糊、组装、展示、悬挂五个阶段共享同一份状态（节点、竹条、绸面、烛火、悬挂）。与 UI 解耦的纯状态内核位于 `src/state/`：

- `src/state/engine.ts` — `LanternEngine` / `reduce`：所有交互（拖节点、换绸色、裱糊、脱离、点燃、悬挂等）都归约为事件，对同一份 `LanternState` 做不可变改写
- `src/state/derive.ts` — `inferStructure`（竹条缺失节点/自环/有向环推演，逐条给出可追溯结论）与 `deriveDisplay`（绸面脱离后节点与相邻绸面的展示结论传播）
- `src/state/templates.ts` — 宫灯 / 走马灯 / 纱灯三种模板

验证套件位于 `tests/state-chain/`，基于 Node 内置 `node:test`，零外部依赖、无需网络、无需启动界面，统一入口：

```bash
npm run verify        # 批量跑完全部状态链路验证（Node >= 22.18）
npm run verify:types  # 对状态内核与验证用例做类型检查
```

覆盖场景：

- `accumulation.test.ts` — 同一节点反复拖动、同一绸面反复裱糊时，位移/进度/张力按增量累积并钳制到 [0,100]，而不是被最后一次操作覆盖
- `structure.test.ts` — 竹条指向缺失节点、自环、连接成有向环时，推演逐条给出 `MISSING_NODE` / `SELF_LOOP` / `CYCLE` 结论（含竹条 id、节点路径），不静默跳过
- `detachment.test.ts` — 绸面脱离后，相邻绸面被标记 `compromisedBy`、失去全部依托绸面的节点变为 `exposed`，重新裱糊后结论恢复
- `convergence.test.ts` — 烛火亮度在数百次连续推演（含确定性噪声）后收敛于 [0.8, 1.0] 内的稳定值；悬挂摆角从 ±15° 阻尼收敛到 0，且穿插其他状态改写不影响收敛
- `state-chain.test.ts` — 五阶段全链路连续改写后，各阶段状态共存于同一份 `LanternState`
