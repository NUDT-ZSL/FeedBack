# 3D 植物生长模拟器

基于 Three.js 的交互式三维植物生长模拟。

## 运行

```bash
npm install
npm run dev      # 浏览器预览
npm run build    # 生产构建
```

## 离线验证（不依赖浏览器）

生长阶段推进、萎蔫判定与进度、开花倒计时的核心逻辑集中在
`src/simulation.ts`（纯函数 + 无头参考仿真，不依赖 THREE.js / DOM），
界面侧的 `Plant` 类与数据面板均复用同一份实现。

```bash
npm run verify
```

该命令将 `src/simulation.ts`、`src/plant.ts` 与 `verify/` 编译到
`.verify-build/` 后运行 `verify/run.js`：

- **双重驱动比对**：同一时间线（参数变更 / 固定步长推进 / 重置）同时作用于
  真实 `Plant` 类（DOM 以本地 stub 替代）与无头参考仿真，逐 tick 比对
  当前阶段、萎蔫标志、萎蔫进度、累计生长时间与开花倒计时文案；
- **绝对期望值断言**：`verify/scenarios.ts` 中的场景对阶段边界临界值
  （5/15/30）、萎蔫进入/退出、萎蔫途中恢复、反复触发、重置后重新推进、
  亚适温度下的慢速率倒计时等情形给出精确期望；
- **差异定位**：任何不一致都会打印场景名、操作序号、tick 时刻、字段名及
  期望值/实际值，进程以非零码退出。

新增口径调整时，只需修改 `src/simulation.ts` 并同步更新
`verify/scenarios.ts` 中的期望，即可离线复算确认影响。
