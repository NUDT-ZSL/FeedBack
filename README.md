# 虚拟篆刻工坊（多印章工作台）

基于 React + TypeScript + Vite + zustand 的浏览器篆刻工坊，支持并行管理多方印章：

- 每方印各自保存文字、字体、尺寸、阴刻/阳刻、笔画偏移与独立的撤销/重做历史。
- 切换印章时参数面板、印石画布、盖印预览整体切换；盖印与导出只作用于当前印章。
- 新增印章一律回到初始空白状态；删除当前印章自动选中相邻一方，删空回到引导态。
- 印章数量、顺序与全部状态（含笔画偏移、历史栈）持久化到 `localStorage`，刷新后完整恢复。

## 常用命令

- `npm run dev`：本地开发
- `npm run verify`：**离线批量验证**（Node 22 直接执行 `scripts/verify.ts`，无需浏览器）
- `npm run check`：TypeScript 类型检查
- `npm run lint`：ESLint
- `npm run build`：生产构建

## 结构

- `src/utils/workshopCore.ts`：纯逻辑核心——增删切换、参数修改、撤销重做、序列化/恢复
- `src/utils/sealGenerator.ts`：印面布局、SVG 生成（纯函数）、canvas 渲染与 PNG 导出
- `src/store/workshopStore.ts`：zustand 状态层 + `localStorage` 持久化
- `src/components/SealTabs.tsx`：印章页签（新增/删除/切换）
- `src/components/ParamPanel.tsx`：当前印章参数面板
- `src/components/SealCanvas.tsx` / `StampPreview.tsx`：印石设计稿与盖印/导出预览
- `scripts/verify.ts`：批量验证入口（增删切换、状态隔离、刷新恢复、导出正确性）
