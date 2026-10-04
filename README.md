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

## 白板状态引擎与离线验证

白板的元素增删改、图层顺序、分组嵌套、撤销重做与协作端合并，全部收敛在
`src/whiteboard/` 的纯逻辑层中实现（不依赖 React / Konva / DOM / 网络）：

- `types.ts` — 元素、分组与画布状态的类型与工厂
- `ops.ts` — 操作模型（add / update / remove / reorder / move / group / ungroup / restore）
- `apply.ts` — 纯函数 reducer：校验并应用操作，非法操作抛 `OpRejection`，原状态不变
- `history.ts` — 逆操作推导 + `Board`（undo/redo 栈）
- `invariants.ts` — 结构不变量检查（归属一致、顺序无重复、无父环等）
- `serialize.ts` — 规范化序列化 / SHA-256 状态指纹 / DFS 可见顺序
- `merge.ts` — Lamport 时钟日志合并、冲突感知重放、`Client` 协作端模拟

### 运行验证

```bash
npm test
```

基于 Node 内置 `node:test`，无需 `npm install`、无需网络，离线可重复执行。
测试位于 `tests/`：

- `determinism.test.ts` — 同一初始状态 + 同一操作序列多次运行指纹一致；
  undo-all 精确回到初始状态，redo-all 精确复现最终状态
- `hierarchy.test.ts` — 分组嵌套、跨组移动、删除带子元素、解组提升、组内排序、防父环
- `scenario.test.ts` — 逐步快照脚本，失败信息直接定位到具体步骤号与操作
- `rejection.test.ts` — 全部非法操作逐一拒绝（明确错误码），拒绝后状态哈希与历史栈不变
- `merge.test.ts` — 并发改同一元素/分组的 LWW、remove 获胜、合并且不丢改动、
  冲突可解释（reason + winner）、交换律/幂等/多轮收敛，以及 400 步双端并发模糊测试
