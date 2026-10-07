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

---

# 织造排产与工时推演 —— 离线验证能力

`src/scheduling/` 是排产与工时推演的唯一事实来源（纯 TypeScript，不依赖 DOM/React），
`verify/` 是不启动界面即可批量运行的离线验证器。

## 模块结构

- `src/scheduling/types.ts` —— 织机/订单/工序/能力模型与推演结果类型
- `src/scheduling/validate.ts` —— 依赖闭环、指向缺失、能力缺口、优先级冲突的前置校验
- `src/scheduling/engine.ts` —— 确定性推演内核（拓扑序 + 织机裁决 + 顺延依据 + 工时结论）
- `src/scheduling/incremental.ts` —— 局部调整后的受影响集合分析与增量重推
- `src/scheduling/entries.ts` —— 多个触发入口（手动排产/订单变更联动/织机看板重排/增量重推），全部委派同一内核
- `src/scheduling/canonical.ts` —— 结果规范化序列，用于跨入口与增量/全量一致性比较

## 运行验证

```bash
npm run verify            # 人类可读中文报告，失败定位到具体工序/织机/依据段
node verify/run.ts --json # 机读报告
npm run typecheck:verify  # 仅对排产与验证代码做严格类型检查
```

验证覆盖五个套件（共 36 项断言）：正常排布、边界条件、失败路径、跨入口一致性、增量重推。
退出码非 0 即存在不一致，报告中每条 ✘ 都指出对不上的实体与依据。

## 确定性规则（同输入必同输出，与入口无关）

1. 拓扑序：Kahn 算法，就绪集合中始终先取 stepId 字典序最小者；
2. 织机裁决：候选按 (优先级升序, 最早空档开工, 织机 id 字典序) 取最优，全部候选的取舍原因留痕；
3. 开工时刻：max(订单投料, 各前置完工) 之后的第一段不重叠空档；
4. 顺延依据：开工晚于就绪时刻时，记录占用织机的具体工序与时刻。

## 失败与裁决语义

- error（拒绝排产）：依赖闭环（输出闭环路径）、指向不存在的织机/工序/订单、工序类型无织机承接、非法字段、id 重复；
- warning（可裁决）：同一工序类型被多台织机以不同优先级覆盖——按上述裁决键确定性选择，裁决记录包含每个候选的选中/落选原因，绝不静默择一。

## 增量重推

`rescheduleIncremental(input, baseline, change)` 支持两类局部调整：
工序前置依赖变更、织机能力（新增/改优先级/移除）变更。
受影响集合按三条可追溯规则闭包传播（依赖后继、同工序类型、能力池织机），
未受影响工序作为锚点保持基线结论；验证器对每条用例断言
“增量重推结果与整体重排逐字节一致”且“未受影响工序结论不被改动”。
