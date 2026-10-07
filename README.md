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

## 多场次编排

单场次编排核心 `src/orchestration/singleSession.ts`（纯函数）承载编排规则、冲突判定与排序语义，是唯一实现；多场次 Store 与批量入口都复用它，保证同输入结果一致。

- `src/orchestration/types.ts`：领域类型（参与者、资源项、时段、场次、分配、冲突）。
- `src/orchestration/multiSession.ts`：`OrchestrationStore`。场次各自独立持有时段、请求与结果；`switchSession` 只切指针不重排；共享池（参与者/资源）增删改后只重推引用它的场次（返回受影响场次 id），其余场次结果对象保持不变；跨场次资源占用冲突由 `getCrossSessionConflicts()` 按场次归属分别生成独立记录。
- `src/orchestration/demoData.ts`：演示数据集（含空场次、单一资源项场次、场内外冲突）。
- `scripts/batch-orchestrate.ts`：统一离线批量入口。

离线运行命令：

```bash
npm run dev                  # 界面交付路径（多场次切换 / 共享池改动 / 冲突归属演示）
npm run build                # 类型检查 + 生产构建
npm run orchestrate:batch    # 批量验证：一致性、增量重推、失效引用、冲突归属、边界场次
```

批量入口校验 10 类不变量（全部通过时退出码 0），JSON 报告写入 `reports/batch-orchestrate-report.json`：

1. 基线一致性：每场次多场次结果与单场单独编排 deep-equal（含 digest）；
2. 空场次、仅含单一资源项场次不报错；
3. 连续切换场次：所有场次结果对象与 `runVersion` 不变；
4. 移除参与者：仅引用场次重推，失效引用进入 rejections，未引用场次结果对象不变；
5. 回补参与者：受影响场次恢复且仍一致；
6. 资源容量变更：受影响场次重推并暴露新冲突；
7. 资源类型变更：`requiredKind` 不满足的请求被拒；
8. 跨场次冲突：同资源占用按场次归属分别呈现、记录对象独立不互相覆盖；
9. 场次增删与非法 id 切换边界稳定；
10. 全部变更后终态仍与单场编排一致。
