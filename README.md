# 协作白板

基于 React + Express + WebSocket 的在线协作白板。`npm run dev` 同时启动前端与后端（后端监听 3001 端口，WebSocket 路径 `/ws`）。

## 服务端行为验证（离线、可重复）

仓库内置一套不依赖浏览器和外网的服务端验证套件。它在进程内启动真实的服务端实例（`server.ts` 的 `createBoardServer()`，监听本机回环临时端口），用真实 WebSocket 客户端完整走一遍消息处理与状态变更路径，覆盖五类风险场景：

- 多客户端并发写同一元素：最终状态等于服务端广播流按序回放，版本号逐次推进
- 同一元素重复提交、删除后再更新：画布内容与版本号保持一致
- 断线重连：`sync` 消息中的元素集合与服务端当前状态（`GET /api/board`）一致
- 非法/无法解析的消息：服务端状态不被污染，连接与后续合法消息不受影响
- 用户进出：广播的在线人数与 `userIds` 集合和真实连接集合吻合

运行方式：

```bash
npm install
npm run verify
```

每个场景输出 `[PASS]`/`[FAIL]`，失败时打印期望状态与实际状态的差异；全部通过时退出码为 0，否则为 1。场景代码在 `tests/scenarios/`，公共测试基建在 `tests/helpers.ts`。

---

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
