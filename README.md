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

## 赛局逻辑离线验证

赛局推进与判定逻辑已从渲染中解耦，集中在 `src/sim/` 纯函数内核中：固定时间步推进（默认 1/60s），所有随机性来自种子化 PRNG（mulberry32），不读取真实时钟。相同种子 + 相同输入序列的重放结果逐位一致。

- `src/sim/engine.ts`：`step(state, dt)` 与射门/传球/抢断等纯函数动作
- `src/sim/runner.ts`：场景回放、稳定哈希（用于跨进程比对复现性）
- `src/gameStore.ts`：zustand 薄适配层，渲染侧只通过它驱动内核
- `tests/`：边界与回归套件（球体边界/球网/落地反弹、射门传球偏差上下限、事件与半场/终场时序、连续与交替输入稳定性、确定性）
- `scenarios/builtin.ts` + `scripts/simulate.ts`：可批量执行的场景回放

统一入口：

```bash
npm run verify   # 类型检查 + 全部测试 + 批量场景回放
npm test         # 仅测试套件
npm run sim      # 批量场景回放（输出比分/事件数/状态哈希）
npm run sim -- --seed=123 --repeat=5   # 指定种子重放 5 次并校验哈希一致
npm run sim -- --json                  # 机器可读输出
```
