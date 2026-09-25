# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## 离线状态一致性测试

本仓库为抽象艺术生成器提供了一套可离线运行的状态一致性测试，无需网络、无需真实浏览器（Vitest node 环境）：

```bash
npm install
npm run test    # 运行全部一致性测试
npm run check   # TypeScript 类型检查
```

被测核心逻辑位于 `src/art/`（纯函数 / 纯类，不依赖 DOM）：

- `random.ts` / `hash.ts`：种子随机数与确定性哈希
- `keywordParser.ts` / `paletteManager.ts`：prompt 解析与调色板 / 色相偏移
- `artEngine.ts`：由 (config, canvas) 生成确定性渲染计划
- `historyStore.ts`：容量受限的历史记录（撤销 / 重做 / 清空 / 选择）
- `exportService.ts`：与预览共用同一渲染路径的 SVG 导出
- `generator.ts`：串联以上模块的会话门面

测试覆盖（`tests/`）：

- `determinism.test.ts`：同种子同参数重复生成输出稳定，不受生成顺序与缓存残留影响
- `environment.test.ts`：主题 / 窗口尺寸 / 设备像素比变化后，画布内容与记录元数据一致
- `history.test.ts` / `history-invariants.test.ts`：连续生成、撤销、重做、清空、超容量驱逐后序列与选中项收敛
- `export.test.ts`：导出与预览使用同一份参数快照，不反映已撤销的中间状态
- `golden.test.ts`：黄金基线指纹，渲染算法或解析规则变动会立即失败（预期变更时需重新生成基线）

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
