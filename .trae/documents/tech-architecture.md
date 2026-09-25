## 1. 架构设计

```mermaid
flowchart TD
    subgraph "前端层"
        "main.tsx" --> "App.tsx"
        "App.tsx" --> "EditorPanel.tsx"
        "App.tsx" --> "NavPanel.tsx"
        "EditorPanel.tsx" --> "段落分割模块"
        "NavPanel.tsx" --> "搜索匹配模块"
        "段落分割模块" --> "倒排索引模块"
        "搜索匹配模块" --> "倒排索引模块"
    end
    subgraph "工具层"
        "倒排索引模块" --> "crypto-js哈希"
        "虚拟滚动模块" --> "NavPanel.tsx"
        "位置记忆模块" --> "NavPanel.tsx"
    end
```

## 2. 技术说明

- 前端：React@18 + TypeScript + Vite + TailwindCSS@3
- 初始化工具：vite-init（react-ts模板）
- 状态管理：Zustand
- 文本哈希：crypto-js
- 后端：无
- 数据库：无（纯前端内存索引）

## 3. 文件结构与调用关系

```
├── package.json                    # 依赖：react, react-dom, typescript, vite, crypto-js
├── vite.config.js                  # 构建配置，index.html作为入口
├── tsconfig.json                   # 严格模式，target ES2020，moduleResolution bundler
├── index.html                      # 入口页面，含文本编辑器区域和导航面板区域
└── src/
    ├── main.tsx                    # React根组件，初始化应用状态和段落索引引擎
    ├── App.tsx                     # 主组件，管理文档文本和导航结果的共享状态
    ├── EditorPanel.tsx             # 文本编辑面板组件
    ├── NavPanel.tsx                # 导航面板组件
    ├── store.ts                    # Zustand状态管理
    ├── paragraphEngine.ts          # 段落分割引擎
    ├── invertedIndex.ts            # 倒排索引模块
    └── types.ts                    # TypeScript类型定义
```

### 数据流向

```
main.tsx
  └── 初始化 → App.tsx
        ├── EditorPanel.tsx
        │     ├── 文本变化 → paragraphEngine.splitParagraphs()
        │     ├── 段落列表 → store.updateParagraphs()
        │     └── 滚动事件 → store.updateVisibleParagraph()
        ├── NavPanel.tsx
        │     ├── 搜索输入 → invertedIndex.search()
        │     ├── 匹配结果 → 渲染高亮列表
        │     ├── 点击段落 → EditorPanel.scrollTo()
        │     └── 位置记忆 → store.jumpHistory
        └── store.ts (Zustand)
              ├── documentText: string
              ├── paragraphs: Paragraph[]
              ├── searchQuery: string
              ├── searchResults: SearchResult[]
              ├── visibleParagraphId: number
              └── jumpHistory: number[]
```

## 4. 路由定义

| 路由 | 用途 |
|------|------|
| / | 单页应用，包含编辑面板和导航面板 |

## 5. 核心模块说明

### 5.1 paragraphEngine.ts - 段落分割引擎

- 输入：完整文档文本
- 处理：按连续两个换行（\n\n）或Markdown标题（# ~ ######）分割
- 输出：Paragraph[]，每个包含 id、文本内容、行号范围、首行摘要（≤20字符）、标题（若有）

### 5.2 invertedIndex.ts - 倒排索引模块

- 输入：Paragraph[]
- 处理：将段落摘要和标题分词后构建倒排表，支持忽略大小写和标点的模糊匹配
- 输出：search(query: string) → SearchResult[]，包含段落ID和匹配位置

### 5.3 store.ts - 状态管理

- documentText: 当前文档文本
- paragraphs: 分割后的段落数组
- searchQuery: 当前搜索词
- searchResults: 搜索结果
- visibleParagraphId: 当前可见段落ID
- jumpHistory: 跳跃历史（最多3个）
- updateDocumentText: 更新文档文本并触发重新分段
- updateSearchQuery: 更新搜索词并触发搜索
- addJumpPosition: 添加跳跃位置到历史

### 5.4 虚拟滚动

- 当段落数 > 200时启用
- 仅渲染可视区域内的导航条目
- 使用固定条目高度计算滚动范围

## 6. 类型定义

```typescript
interface Paragraph {
  id: number;
  content: string;
  startLine: number;
  endLine: number;
  summary: string;
  title?: string;
}

interface SearchResult {
  paragraphId: number;
  summary: string;
  title?: string;
  matchRanges: [number, number][];
}

interface AppState {
  documentText: string;
  paragraphs: Paragraph[];
  searchQuery: string;
  searchResults: SearchResult[];
  visibleParagraphId: number | null;
  jumpHistory: number[];
}
```
