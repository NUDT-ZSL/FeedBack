# 数字灵感板 · 情节编排工具

纯前端、可完全离线运行的交互式灵感板：在无限画布上拖拽灵感卡片，用连线标注因果与时序，并把同一情节线的卡片归入可折叠的「卡组」。

## 快速开始

```bash
npm install        # 首次安装依赖（之后完全离线可用）
npm run dev        # 开发模式
npm run build      # 生产构建（tsc 类型检查 + vite 打包）
npm run verify     # 统一批量验证入口（命令行）
```

无任何 CDN / 外部字体 / 后端依赖；画布状态通过 `localStorage` 持久化。

## 功能概览

- **卡片**：创建、拖拽、缩放（右下角手柄）、双击编辑、调色板、本地图片插入
- **连线**：箭头 / 虚线两种类型，连线模式下依次点击两张卡片创建；选中后可改标签、颜色、类型
- **框选**：框选工具拖出选区；命中折叠卡组时视为命中容器本身，不会选中内部卡片
- **视口**：滚轮以指针为中心缩放（0.5–3x），空白处拖拽平移；不改变卡组与成员的相对关系
- **卡组**：
  - 框选卡片后点「＋卡组」创建；卡组是画布上的容器，可整体拖动（成员随之平移）
  - 折叠后成员卡片隐藏，容器以缩略摘要（名称 / 成员数 / 前几个标题）呈现；展开后成员恢复原有位置与大小
  - 连线规则：两端同组且折叠 → 隐藏；跨组或组内外 → 端点吸附到折叠容器边界，展开后自动恢复原始卡片端点
  - 一张卡片不能同时属于两个卡组：重复归入会弹出 `membership-conflict` 提示且状态不变
  - 删除卡组时成员卡片与相关连线全部保留，每条受影响连线都有 `connection-endpoint-detached` 提示
  - 右侧面板支持重命名、成员排序（↑↓）、移出成员、加入选中卡片
- **持久化**：折叠状态、卡组归属、成员顺序随 `CanvasState`（v2）一起保存；v1 旧状态（无 `groups` 字段）自动兼容迁移，缺字段按默认值补齐并给出迁移说明

## 统一批量验证

同一套验证引擎（`src/engine/verify.ts`）有两个入口，结果一致：

- 命令行：`npm run verify`（Node 22 直接运行 TS，无需额外依赖；失败时退出码为 1）
- 界面：工具栏「批量验证」按钮，弹窗展示每条用例的可观察断言

覆盖路径：折叠/展开、跨组连线吸附、成员归属冲突、删除卡组后的连线引用、持久化与旧状态兼容、框选与视口变换。

## 代码结构

```
src/
  types.ts                 类型与常量（Card / Connection / CardGroup / CanvasState v2 / GroupEvent）
  engine/                  纯逻辑层，不依赖 React，UI 与验证脚本共用
    geometry.ts            矩形边界吸附等几何计算
    groups.ts              卡组规则：折叠、归属冲突、连线端点解析、框选命中
    storage.ts             localStorage 持久化 + v1→v2 兼容迁移
    verify.ts              统一批量验证引擎
  hooks/useBoardState.ts   画布状态与所有操作的动作层（引擎结果 → React state + 提示）
  components/              Toolbar / Board / CardView / GroupView / ConnectionsLayer / GroupsPanel / VerifyPanel
scripts/verify.ts          命令行验证入口（npm run verify）
```

数据流向：`useBoardState` 持有唯一 `CanvasState` → 引擎纯函数计算新状态与 `GroupEvent[]` → React 重新渲染，事件以 toast 呈现。
