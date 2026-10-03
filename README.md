# React + TypeScript + Vite

## 离线行为验证

不依赖浏览器与网络，使用 Node 内置测试运行器（Node >= 22，无需安装第三方依赖）：

```bash
npm test
```

统一入口一次性执行 `tests/` 下全部用例，按「行为」组织，单条失败会直接定位到对应行为名称：

- `tests/bookStatus.test.ts`：想读/在读/读完流转时开始与结束日期的写入、清空与保留，评分与状态的合法/非法组合（想读不允许评分与日期、在读必须有开始日期且无结束日期、读完必须有起止日期且结束日期不早于开始日期、评分必须为 0-5 的整数）。
- `tests/storage.test.ts`：删书级联清理该书笔记且不影响其他书籍、按书籍标识过滤笔记（不存在的标识返回空数组而非报错）、空存储/损坏 JSON/非数组内容/字段缺失时读取返回空数组或原样记录、同一实体重复与并发保存（含随机延迟）后最后一次写入落盘。

每个用例使用全新的内存版 `localStorage`（`tests/helpers/fakeLocalStorage.ts`），在干净环境中重复执行结果一致。


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
