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

## 城门破坏后的守军突围与士气连锁

城门耐久归零后，游戏会在回合末按**固定顺序**结算一条完整的守军突围链路：

1. **军粮 upkeep** —— 补给线被切断，守军每回合固定耗粮（`DEFENDER_GRAIN_UPKEEP_PER_TURN`）
2. **突围决策** —— 按当前士气与剩余军粮决定是否突围、突围方向（选择封堵最薄弱的缺口）与投入兵力（受军粮/士气上限约束）
3. **突围执行** —— 投入兵力按人耗粮并向缺口机动，到达缺口即出城；每回合重置 `inSortie` 标记，同一士兵不会被重复计入
4. **箭矢拦截** —— 城墙残余段落放箭掩护突围，按起义军封堵人数消耗箭筒，未被压制的封堵者截杀突围士兵
5. **士气连锁** —— 逃出提振士气、阵亡打击士气，掩护成败同时调整城墙残余段落的防守强度（`wallDefense`，影响巷战反击伤害）；士气增量每回合只计算并应用一次
6. **溃散判定** —— 士气跌破 `ROUT_MORALE_THRESHOLD` 或军粮耗尽即转为溃散（弃城），溃散/全部撤出直接汇入胜负判定（起义军胜）

军粮不足、士气过低、缺口被封堵、无可用缺口等边界都会产出可观察的 `BreakoutEvent`（见画面上方「守军突围连锁」面板），不会静默跳过。城门未破坏时连锁完全不触发，原有攻防/部署/命中/胜负逻辑不变。

### 相关文件

- `src/types.ts` —— `DefenderState`、`BreakoutEvent` 与连锁常量
- `src/BreakoutLogic.ts` —— 纯函数结算模块（决策/突围/拦截/士气/溃散）
- `src/GameLogic.ts` —— 在 `endTurn` 中接入连锁并汇入胜负；初始守军 `createInitialGarrison`
- `src/simulation.ts` —— 统一批量推演入口（连续模式 / 逐回合深拷贝模式 / 一致性快照）
- `scripts/simulate.ts` —— 离线验收脚本
- `src/components/BreakoutPanel.tsx` / `BatchPanel.tsx` —— 连锁观察面板与批量推演弹窗

### 离线交互与验收

- `npm run dev`：浏览器中可点底部「砸毁城门」直接触发，观察突围与士气连锁全过程；「批量推演」按钮可弹窗跑连续/逐回合推演并查看一致性校验
- `npm run simulate`：命令行统一验收入口（可加 `-- --turns=16`），覆盖连锁不触发、完整链路、军粮/士气/残段边界、连续 vs 逐回合一致、种子可复现、同回合幂等防重复结算等场景
