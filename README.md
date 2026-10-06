# React + TypeScript + Vite

## 斗茶图鉴与对局记录持久化

- 图鉴收藏与对局记录通过 `src/lib/persistence.ts` 统一持久化到浏览器 `localStorage`（不可用时自动降级为内存存储），刷新、重启或重开浏览器后可恢复。
- 图鉴按「回合 + 图案」去重：同一回合重复点击同一图案只保留一条，重复提交以最新结果为准，相同内容幂等，旧时间戳的乱序提交被忽略。
- 每回合双方色泽/持久/咬盏/总分自动写入对局记录，顶栏「对局记录」可查看逐回合胜负与累计战绩。
- 恢复时若发现同一回合存在冲突记录（如本地缓存被多端写入），双方都会保留并标记冲突，由用户在界面上裁决；裁决只影响该条记录，其余历史不变。
- 统一离线验证入口：`npm run verify`（基于内存存储与本地样例，批量跑通保存、恢复、去重、乱序、冲突与裁决全部场景，无需网络和手工点击）。

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
