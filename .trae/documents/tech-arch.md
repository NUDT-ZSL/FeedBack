## 1. 架构设计

```mermaid
flowchart LR
    A["React UI 层"] --> B["组件层"]
    B --> B1["CodeEditor"]
    B --> B2["CodePreview"]
    B --> B3["SnippetCard"]
    B --> B4["FavoritesPanel"]
    A --> C["状态管理层"]
    C --> C1["useState (本地状态)"]
    C --> C2["useCallback / useMemo"]
    A --> D["工具层"]
    D --> D1["snippetsData (数据/持久化)"]
    A --> E["第三方库"]
    E --> E1["react-syntax-highlighter"]
    E --> E2["react-hot-toast"]
```

## 2. 技术说明

- 前端：React@18 + TypeScript@5 + Vite@5
- 构建工具：Vite + @vitejs/plugin-react
- 语法高亮：react-syntax-highlighter
- Toast 提示：react-hot-toast
- 数据持久化：localStorage（浏览器本地存储）
- 状态管理：React Hooks（useState、useCallback、useMemo、React.memo）

## 3. 文件结构

```
auto40/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── components/
    │   ├── CodeEditor.tsx
    │   ├── CodePreview.tsx
    │   ├── SnippetCard.tsx
    │   └── FavoritesPanel.tsx
    └── utils/
        └── snippetsData.ts
```

## 4. 数据模型

### 4.1 数据模型定义

```mermaid
erDiagram
    SNIPPET {
        string id PK "唯一标识"
        string title "标题"
        string code "代码内容"
        string language "编程语言"
        string theme "高亮主题"
        number timestamp "保存时间戳"
        boolean isFavorite "是否收藏"
    }
```

### 4.2 TypeScript 类型定义

```typescript
interface Snippet {
  id: string;
  title: string;
  code: string;
  language: 'javascript' | 'typescript' | 'python' | 'html' | 'css' | 'java' | 'go';
  theme: 'monokai' | 'dracula' | 'oneDark';
  timestamp: number;
  isFavorite: boolean;
}

type LanguageType = Snippet['language'];
type ThemeType = Snippet['theme'];
```

## 5. 组件职责说明

| 组件 | 输入Props | 输出/回调 | 职责 |
|------|-----------|-----------|------|
| CodeEditor | code, language, theme | onCodeChange, onLanguageChange, onThemeChange | 代码编辑、语言/主题选择 |
| CodePreview | code, language, theme | - | 语法高亮渲染、行号显示 |
| SnippetCard | snippet | onLoad, onToggleFavorite | 片段卡片展示与交互 |
| FavoritesPanel | snippets, isOpen, filterLanguage | onClose, onLoad, onRemoveFavorite, onFilterChange | 收藏侧边栏管理 |
| App | - | - | 主应用布局、状态管理、拖拽分隔线 |
