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

## 房间对局链路离线验证

`verification/` 提供一条零依赖、可重复执行的验证链路，直接用 Node.js（>= 22，内置 TypeScript 类型擦除）运行真实业务模块，不启动网络服务、不使用真实计时器：

- 时间依赖：`Room`/`RoomManager` 支持注入 `Scheduler`（`setTimeout`/`clearTimeout`），验证中使用手动推进的 `FakeScheduler`。
- 网络依赖：客户端连接以 `MockWebSocket` 代替，通过广播消息记录断言行为。
- 随机依赖：`selectRandomQuestions(count, seed)` 支持种子化抽题，题目 ID 固定。
- 计算口径：匹配度/共同答案/雷达数据统一抽到 `shared/matching.ts`，服务端与客户端共用。

运行：

```bash
npm run verify
```

覆盖五类行为：匹配计算确定性与口径、种子化抽题、作答提交健壮性、手动计时推进、房间销毁后计时隔离。全部通过时退出码为 0；失败时输出失败用例所属类别与具体断言，退出码为 1。
