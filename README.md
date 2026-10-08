# 古籍修复工坊 · 状态一致性说明

工序推进、材料领用、修复记录三个模块共享同一份可追溯的状态来源：

- `src/domain/workshop/`：领域核心。所有状态变更以操作形式追加到统一操作日志（`WorkshopStore`），三个模块的读取视图（进度 / 材料余量 / 修复记录）都由该日志派生，任一操作生效后其他模块立即读到同一结果。
- 并发控制：每册书有单调递增版本号，提交操作需携带读取时的版本；版本不一致的操作不会被静默覆盖，而是作为冲突痕迹保留（`GET /api/workshop/conflicts`），当前有效状态以先提交者为准。
- 幂等：操作携带 `opId`，重复提交返回首次结果，不重复扣减材料或追加记录。
- 材料余量 = 初始库存 - 累计领用 + 累计退回，由日志派生，工序来回切换不影响。
- 历史数据迁移：`migrateLegacyState`（`src/domain/workshop/legacy.ts`）把旧的三份分散快照重放进统一日志，并校验迁移前后各模块读取结果一致。

## 离线批量验证

```bash
npm run verify
```

覆盖工序来回切换、材料重复领用退回、冲突操作保留、历史数据迁移四类场景，断言各模块读取结果一致且冲突可追溯；全部通过时退出码为 0。

## 运行

```bash
npm run dev   # 同时启动 Vite 前端与 Express 后端（/api/workshop/*）
```

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
