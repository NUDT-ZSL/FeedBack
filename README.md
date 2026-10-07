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

## 多场次编排（orchestration）

编排链路与 React 界面解耦，核心为零依赖 TypeScript 模块，可完全离线运行：

- `src/orchestration/types.ts` — 参与者、资源项、时段、场次、分配、冲突类型
- `src/orchestration/schedule.ts` — 单场编排纯函数 `scheduleSession(spec, pools)`，编排规则、冲突判定与排序语义均在此固化，不依赖场次容器
- `src/orchestration/contention.ts` — 跨场次资源争用检测，同资源时间重叠时按场次归属分别产出冲突记录
- `src/orchestration/store.ts` — `OrchestrationStore`：共享参与者/资源池 + 多场次独立编排结果缓存；切换场次只移动指针，池/场次变更仅把引用方标记为 dirty，`sync()` 只重推受影响场次
- `src/orchestration/batch.ts` — 场景装载、操作回放、逐阶段校验（多场次结果与单场独立编排一致性、无失效引用、切换不重推）
- `src/orchestration/selftest.ts` — 不变量自检套件
- `scripts/run-batch.ts` — 统一批量运行入口；`scripts/scenarios/` 存放场景 JSON

编排语义（与单场版本保持一致）：

1. 参与者按场次内登记顺序，依次取场次 `slots` 中最早未占用的时段（每时段至多一人）；时段耗尽产出 `slot-exhausted`
2. 资源按场次登记顺序选择，要求 `resource.minGrade >= participant.grade` 且该资源未在重叠时段被本场次占用；品级不满足产出 `grade-mismatch`，品级满足但全部占用产出 `resource-unavailable`
3. 已移除的参与者/资源不会出现在分配中，产出 `missing-participant` / `missing-resource`
4. 同一资源被多个场次的重叠时段占用时，每个归属场次各得一条 `resource-contention`（带 `otherSessionId`），互不覆盖
5. 输出 `order` 按参与者登记/排入顺序稳定排列；同输入结果确定

离线批量验证：

```bash
npm run batch                           # 自检 + 运行 scripts/scenarios/ 下全部场景
npm run batch path/to/scenario.json     # 运行指定场景，可传多个
```

场景 JSON 结构：`participants` / `resources` / `sessions` 定义初始共享池与场次，`operations` 回放变更（`upsertParticipant`、`removeParticipant`、`upsertResource`、`removeResource`、`addSession`、`removeSession`、`updateSessionSpec`、`switchSession`）。任一阶段校验失败时进程以非零码退出，便于接入 CI 或离线验收。
