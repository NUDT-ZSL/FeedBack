# React + TypeScript + Vite

## 离线状态验证

灯笼铺模拟器的状态链路（骨架搭建、裱糊、组装、展示、悬挂共享同一份节点/竹条/绸面/烛火状态）提供可离线运行的验证能力，无需启动界面、无网络依赖、零第三方包：

```bash
npm run verify
```

统一入口为 `src/sim/verify.ts`，批量执行 `src/sim/scenarios.ts` 中注册的全部场景，任一检查失败时进程以非零码退出。覆盖场景：

- 同一节点反复拖动 / 同一绸面反复裱糊：进度与张力按增量累积并正确封顶，而非被覆盖
- 竹条连接指向缺失节点、连接关系成环：推演给出带路径/端点的可追溯结论，而非静默跳过
- 绸面脱离后：依赖它的节点与相邻绸面的展示结论随之更新
- 烛火亮度与悬挂摆动：连续多次状态变更后收敛到稳定值

状态核心（`src/sim/state.ts`）与推演模块（`src/sim/derive.ts`）为纯 TypeScript，可直接被未来的 UI/store 层复用。

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
