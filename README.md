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

## 批量导入片单

点击顶栏「导入片单」，可选择 `.json` / `.csv` 文件，或直接粘贴内容，全程离线，不调用外部服务。

- 字段归一：自动识别 `title/标题`、`year/年份`、`rating/评分`、`status/观看状态`、`genre/类型`、`watchDate/观影日期` 等别名；非法年份归为未知、非法评分归为未知、状态支持 `已看/未看/watched/unwatched`、日期归一为 `YYYY-MM-DD`；缺标题的整行才会跳过并给出原因。
- 去重合并：依次按「外部标识 → 标题+年份 → 标题大小写与多余空格归一」匹配；片单内重复条目标记为重复，字段冲突或收藏中存在多条同名候选时标记为「待裁决」并保留双方原始来源，不随意择一。
- 只补齐不覆盖：已存在条目的个人评分、观影日期、观看状态绝不被外部数据覆盖，仅补齐其缺失的元数据字段。
- 幂等可复现：无标识记录按「标题+年份」生成确定性 ID；同一份文件重复导入不会产生重复条目或改写已有数据，并会提示该文件已导入过。
- 导入报告：按新增 / 补齐 / 已存在 / 重复 / 待裁决 / 跳过分组列出每一条的处理说明。

验收样例见 `samples/sample-import.json` 与 `samples/sample-import.csv`，离线校验脚本：

```bash
npm run verify:import
```

脚本会模拟一份现有收藏，对样例片单连续合并两次，断言收藏数量、排序与三种筛选视图、个人字段保护、冲突/跳过说明在两次导入间完全一致。
