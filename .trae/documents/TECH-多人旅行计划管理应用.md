## 1. 架构设计

```mermaid
graph TD
    A["React应用层"] --> B["页面组件层"]
    A --> C["自定义Hooks层"]
    A --> D["工具函数层"]
    B --> E["首页/项目列表"]
    B --> F["创建向导页"]
    B --> G["行程时间线页"]
    B --> H["预算分摊页"]
    B --> I["物品清单页"]
    C --> J["useTravelData（localStorage持久化）"]
    C --> K["useVirtualScroll（虚拟滚动）"]
    C --> L["useDragAndDrop（拖拽排序）"]
    D --> M["动画工具函数"]
    D --> N["预算计算工具"]
    D --> O["图表绘制工具"]
    P["数据持久化层"] --> Q["localStorage"]
```

## 2. 技术描述

- **前端框架**：React 18 + TypeScript 5
- **构建工具**：Vite 5
- **状态管理**：React Context + useReducer（轻量级）
- **样式方案**：CSS Modules + CSS Variables（主题色管理）
- **图表方案**：原生Canvas 2D API（饼图绘制，无第三方库）
- **动画方案**：CSS Animations + Transitions + requestAnimationFrame
- **数据存储**：浏览器localStorage（无后端）
- **唯一ID生成**：uuid v4
- **路由方案**：React Router v6（或条件渲染，根据复杂度选择）

## 3. 路由定义

| 路由 | 页面 | 用途 |
|------|------|------|
| / | 首页 | 展示所有旅行项目卡片，入口页面 |
| /create | 创建向导 | 4步骤创建新旅行项目 |
| /trip/:id/itinerary | 行程时间线 | 编辑和查看行程安排 |
| /trip/:id/budget | 预算分摊 | 计算和展示预算分摊 |
| /trip/:id/packing | 物品清单 | 管理出行物品清单 |
| /trip/:id | 项目详情 | 项目总览和导航入口 |

## 4. 数据模型

### 4.1 数据模型定义

```mermaid
erDiagram
    TRAVEL_PROJECT {
        string id "项目ID（uuid）"
        string title "项目标题"
        string destination "目的地"
        string startDate "开始日期"
        string endDate "结束日期"
        string coverImage "封面图URL（base64或外链）"
        string createdAt "创建时间"
    }
    
    MEMBER {
        string id "成员ID"
        string projectId "所属项目ID"
        string name "成员姓名"
        string avatar "头像URL或emoji"
        string role "角色：leader/finance/member"
    }
    
    ITINERARY_ITEM {
        string id "活动ID"
        string projectId "项目ID"
        string date "日期（YYYY-MM-DD）"
        string time "时间（HH:mm）"
        string location "地点"
        string description "备注"
        number budget "预算"
        number order "排序权重"
    }
    
    BUDGET_SPLIT {
        string id "分摊记录ID"
        string projectId "项目ID"
        string description "花费描述"
        number totalAmount "总金额"
        string splitType "分摊方式：equal/proportional"
        object proportions "比例配置 {memberId: percentage}"
        string[] participantIds "参与成员ID列表"
        string createdAt "创建时间"
    }
    
    PACKING_ITEM {
        string id "物品ID"
        string projectId "项目ID"
        string category "分类：documents/clothing/medicine/other"
        string name "物品名称"
        boolean isChecked "是否已携带"
        string checkedBy "勾选人成员ID"
        boolean isCustom "是否自定义物品"
        number order "排序"
    }
    
    TRAVEL_PROJECT ||--o{ MEMBER : "包含"
    TRAVEL_PROJECT ||--o{ ITINERARY_ITEM : "包含"
    TRAVEL_PROJECT ||--o{ BUDGET_SPLIT : "包含"
    TRAVEL_PROJECT ||--o{ PACKING_ITEM : "包含"
```

### 4.2 数据结构定义（TypeScript）

```typescript
type MemberRole = 'leader' | 'finance' | 'member';
type SplitType = 'equal' | 'proportional';
type PackingCategory = 'documents' | 'clothing' | 'medicine' | 'electronics' | 'toiletries' | 'other';

interface TravelProject {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverImage: string;
  createdAt: string;
}

interface Member {
  id: string;
  projectId: string;
  name: string;
  avatar: string;
  role: MemberRole;
}

interface ItineraryItem {
  id: string;
  projectId: string;
  date: string;
  time: string;
  location: string;
  description: string;
  budget: number;
  order: number;
}

interface BudgetSplit {
  id: string;
  projectId: string;
  description: string;
  totalAmount: number;
  splitType: SplitType;
  proportions: Record<string, number>;
  participantIds: string[];
  createdAt: string;
}

interface PackingItem {
  id: string;
  projectId: string;
  category: PackingCategory;
  name: string;
  isChecked: boolean;
  checkedBy?: string;
  isCustom: boolean;
  order: number;
}

interface TravelData {
  projects: TravelProject[];
  members: Member[];
  itineraryItems: ItineraryItem[];
  budgetSplits: BudgetSplit[];
  packingItems: PackingItem[];
}
```

## 5. 文件结构

```
├── package.json
├── vite.config.js
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── types/
    │   └── index.ts          # 类型定义
    ├── hooks/
    │   ├── useTravelData.ts  # localStorage数据管理
    │   └── useVirtualScroll.ts # 虚拟滚动
    ├── components/
    │   ├── TravelCard.tsx    # 项目卡片
    │   ├── ItineraryCard.tsx # 行程活动卡片
    │   ├── BudgetPieChart.tsx # 预算饼图
    │   ├── PackingList.tsx   # 物品清单
    │   ├── StepWizard.tsx    # 创建向导
    │   ├── Timeline.tsx      # 时间线组件
    │   └── Navbar.tsx        # 导航栏
    ├── pages/
    │   ├── HomePage.tsx
    │   ├── CreatePage.tsx
    │   ├── ItineraryPage.tsx
    │   ├── BudgetPage.tsx
    │   └── PackingPage.tsx
    ├── utils/
    │   ├── budget.ts         # 预算计算
    │   ├── canvas.ts         # 图表绘制
    │   └── animations.css    # 动画关键帧
    └── styles/
        ├── variables.css     # CSS变量主题
        └── global.css        # 全局样式
```

## 6. 性能优化策略

1. **首屏性能**
   - 路由懒加载（React.lazy + Suspense）
   - 代码分割按页面粒度拆分
   - 图片懒加载（IntersectionObserver）
   - 关键CSS内联

2. **虚拟滚动**
   - 行程活动列表超过50项时启用虚拟滚动
   - 只渲染可视区域内的DOM节点
   - 使用IntersectionObserver检测可见性

3. **动画性能**
   - 使用transform和opacity属性实现动画（GPU加速）
   - 避免在动画中触发layout/paint
   - 使用will-change提示浏览器优化

4. **数据持久化**
   - 防抖保存localStorage（延迟300ms）
   - 增量更新，避免全量序列化
   - 恢复数据时使用requestIdleCallback

## 7. 第三方依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| react | ^18.2.0 | UI框架 |
| react-dom | ^18.2.0 | DOM渲染 |
| react-router-dom | ^6.22.0 | 路由管理 |
| typescript | ^5.4.0 | 类型系统 |
| vite | ^5.2.0 | 构建工具 |
| @vitejs/plugin-react | ^4.2.0 | React插件 |
| uuid | ^9.0.0 | 唯一ID生成 |
| @types/uuid | ^9.0.0 | uuid类型定义 |
