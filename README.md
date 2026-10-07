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

## 太医署问诊推演引擎

四诊采集 → 裁决 → 辨证 → 方剂排序 → 剂量配比 → 疗效预估 的完整链路已从页面组件中抽出，
收敛为 `src/diagnosis/` 下的纯函数推演引擎：不依赖 React / 网络 / 系统时钟 / 随机数，
同一组输入在任意入口、任意时刻推演结果严格一致。

### 目录结构

- `src/diagnosis/types.ts` — 领域类型（采集记录、冲突、证候、方剂、剂量、疗效、依赖问题）
- `src/diagnosis/collection.ts` — 采集层：重复采集不覆盖，按来源与时刻保留冲突，裁决后才参与辨证
- `src/diagnosis/dependencies.ts` — 依赖图：证候/体质/病史间的依赖闭环与指向缺失检测，显式暴露不静默跳过
- `src/diagnosis/engine.ts` — 推演主链路（证候 → 方剂 → 剂量 → 疗效），全纯函数
- `src/diagnosis/session.ts` — 推演会话：全量推演 + 增量重推（只重算受影响节点，结果与全量严格一致）
- `src/diagnosis/data/rules.ts` — 固定规则数据（证候规则、方剂库、药材、体质/病史修正）
- `src/stores/clinicStore.ts` — 问诊室 store：页面只通过它调用引擎，不持有推演规则
- `samples/cases/` — 固定样例（含冲突裁决、记录修正、体质/病史相互影响等场景）
- `scripts/` — 离线执行与验收脚本

### 离线验收（不依赖外部账号或在线服务）

```bash
npm run deduction:run     # 批量推演全部样例，结果写入 samples/out/results.json
npm run deduction:verify  # 五项验收：确定性 / 样例预期 / 冲突保留 / 依赖问题暴露 / 增量=全量
npm run deduction:smoke   # UI 冒烟：初始渲染 + 完整问诊流程状态断言
```

重复运行以上命令，输出内容一致。
