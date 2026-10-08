# 活字印刷排样

基于 React + TypeScript + Vite 的活字印刷排样互动应用：从字库架拖拽字模到版盘排样，支持墨色/字号全局调节、捺印预览与 PNG 导出。

## 架构与数据流

所有交互状态逻辑收敛在纯函数核心 `src/state/composition.ts`（不依赖 React / DOM / 网络），UI 组件只负责渲染与事件转发：

- `src/state/composition.ts`：版盘状态机。`placeFromRack`（取字落位）、`takeBack`（取回字架）、`movePlaced`（版盘内移动/交换）、`clearBoard`（清空回收）、`setInkColor` / `setFontSize` / `setInkMix`（全局设置）、`exportSnapshot`（只读导出快照）、`validateState`（一致性不变量校验）。非法操作抛出带 `code` 的 `CompositionError`，且保证状态不被部分修改。
- `src/App.tsx`：持有 `CompositionState`，把核心操作接到组件事件上，落位被拒时触发格子抖动反馈。
- `src/components/TypeRack.tsx` / `CompositionArea.tsx` / `InkControl.tsx`：字库架、版盘（9 列 × 5 行网格）、墨色字号控制面板。

## 离线批量验证

验证链路无需浏览器、无需网络（安装依赖后），统一入口：

```bash
npm install        # 仅首次需要网络
npm test           # 批量运行全部验证（node:test，直接跑 TypeScript）
npm run verify     # 类型检查 + 全部验证
```

测试位于 `test/`，覆盖正常路径与边界路径：

- `test/placement.test.ts`：取字落位、字符归属唯一（字架/版盘互斥）、重复落位与占用格拒绝、取回后位置与占用同步、取回再放回、版盘内移动与交换、清空回收。
- `test/settings.test.ts`：墨色/字号/浓淡切换对已落位与后续落位字符表现一致、快速连续切换以最后一次为准、非法设置被拒绝且原状态保留。
- `test/export.test.ts`：空版盘导出、导出为纯只读（连续导出一致、不改状态）、导出→清空→再排样无残留、导出→取回→再放回内容同步。
- `test/boundaries.test.ts`：版盘满格（45 格）后继续落位被拒绝且状态不变、满格取回一格可再落位、满格导出/清空、取回-放回循环。
- `test/fuzz.test.ts`：固定种子的随机混合操作序列（每步后执行 `validateState` 不变量校验），同一种子结果可复现，用于批量回归快速连续操作下的状态一致性。

`test/helpers/invariants.ts` 提供一致性断言与确定性随机数发生器，新增用例可直接复用。

## 本地运行

```bash
npm run dev        # 开发服务器（端口 5173）
npm run build      # 类型检查并产出 dist/
```
