# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## 离线验证（模拟逻辑测试）

模拟核心逻辑位于 `src/simulation.ts`，为纯函数实现，时钟通过 `createSimContext({ now })` 注入，
不依赖真实等待与浏览器渲染。`src/store.ts` 中的 zustand store 仅做 UI 适配，全部状态迁移委托给该引擎。

统一批量运行入口（零额外依赖，使用 Node 内置测试运行器，要求 Node >= 22.6）：

```bash
npm test
```

测试位于 `tests/`，覆盖四类可观察结果：

- `tests/stamina.test.ts`：驿卒体力随发送扣减、休息恢复不越界、体力耗尽拒绝发送、低体力行程时长口径
- `tests/horses.test.ts`：驿马送达后释放、同一驿马并发/重复占用互斥、多驿马独立释放、到达时刻边界
- `tests/documents.test.ts`：文书 pending → in-transit → delivered 状态迁移与日志一致、送达时刻与耗时记录、不可重复发送
- `tests/delays.test.ts`：延误判定后文书/日志/在途驿马同步收敛、不残留悬挂在途记录、时限边界、部分延误互不影响

`tests/helpers.ts` 中的 `assertInvariants` 在每一次时间推进后校验全局不变量
（体力边界、驿马占用与在途记录一一对应、文书/日志/在途三方状态一致）。

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
