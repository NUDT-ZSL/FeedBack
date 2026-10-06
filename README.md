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

## 长安西市 · 驯猴百戏

基于 React + TypeScript + zustand + framer-motion 的古代街头百戏策略小游戏：60 秒内安排猴子表演动作、控制疲劳、调动观众情绪，赢取尽可能多的铜钱打赏。

### 启动

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run lint
```

### 模块与数据流

- `src/types.ts`：游戏状态类型（MonkeyState / AudienceState / Coin / Cheer 等）。
- `src/config.ts`：动作参数表（耗时、疲劳、成功率、情绪加成、铜钱倍率、冷却）、舞台几何、围观人群。
- `src/store.ts`：zustand 统一状态管理，暴露 `start / togglePause / pause / selectAction / tick`。
- `src/components/Stage.tsx`：木竿、猴子 CSS 动作动画、围观人群、铜钱抛物线（framer-motion）、欢呼气泡。
- `src/components/ActionPanel.tsx`：动作按钮、冷却倒计时、疲劳绿→红渐变、招牌技充能条。
- `src/components/StatusPanel.tsx`：倒计时、得分、疲劳圆环、情绪条、连击/充能、历史最高。
- `src/pages/Home.tsx`：组合三栏布局、驱动 100ms 游戏循环、暂停/切后台自动暂停与结算覆盖层。

数据流：`ActionPanel → selectAction → store.tick（动作结算/情绪/疲劳/铜钱）→ Stage + StatusPanel`。所有时间戳均为“游戏时间”，暂停时停止推进，恢复后无时间漂移。

### 核心规则

60 秒限时，铜/银/金评级；疲劳 ≥80% 成功率减半、满 100% 罢工 3 秒；成功动作提升观众情绪，情绪越高抛钱越多（基础 2 枚、每 20 点情绪 +1，上限 8 枚）；连续两次失手情绪 -10；铜钱 0.5 秒抛物线落地、闪烁两次后计分，同屏上限 20 枚。

### 新增能力：连击彩气与招牌技「封侯大戏」

- **连击 / 满堂彩**：连续成功累计连击，≥3 触发满堂彩，额外 +2 枚铜钱、单枚价值 10→15 文、情绪多 +5，任意失手清零。
- **招牌技充能**：普通动作成功充能（满堂彩更多），充满 100 后可释放 4 秒「封侯大戏」，双倍铜钱 × 双份抛钱、情绪 +20；失败返还 50 点能量，避免一局努力清零。
- **暂停/恢复**：顶部按钮暂停，切到后台标签页自动暂停；结算页显示评级、最高连击、成败次数。
- **持久化**：历史最高分与对局数存入 localStorage（读取带容错，写入失败静默降级）。
- **重复与边界保护**：表演中重复点击、冷却中、罢工期间、能量不足时动作均被拦截；重新开局完整重置；时间归零时场上铜钱仍会计入得分。
