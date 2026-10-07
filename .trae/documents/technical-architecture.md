## 1. 架构设计

```mermaid
graph TD
    A["浏览器"] --> B["React 18 + TypeScript"]
    B --> C["App.tsx 主容器"]
    C --> D["UI层 (HTML/CSS)"]
    C --> E["3D层 (Three.js + R3F)"]
    D --> D1["TalismanPanel.tsx<br/>符咒库面板"]
    D --> D2["符咒拖拽逻辑<br/>HTML5 Drag & Drop API"]
    E --> E1["Observatory.tsx<br/>观星台场景"]
    E --> E2["ArmillarySphere<br/>浑天仪组件"]
    E --> E3["Planets<br/>五行星组件"]
    E --> E4["ConstellationLabels<br/>星宿标签组件"]
    E --> E5["TalismanFlags<br/>符咒旗帜组件"]
    E --> E6["BaguaDiagram<br/>八卦阵图组件"]
    E --> E7["LightBeam<br/>金色光柱特效"]
    F["数据层"] --> F1["starData.ts<br/>行星/星宿/八卦数据"]
    G["状态管理"] --> G1["React useState<br/>旋转角度/拖拽状态"]
```

## 2. 技术描述

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **3D引擎**: Three.js r160 + @react-three/fiber 8 + @react-three/drei 9
- **类型声明**: @types/three, @types/react, @types/react-dom
- **样式方案**: CSS Modules + CSS Variables (主题色定义)
- **字体**: Google Fonts - ZCOOL XiaoWei (楷体)
- **无后端**：纯前端应用，所有数据本地mock

## 3. 项目文件结构

```
d:\Solocoder\VersionFast\tasks\auto249\
├── package.json
├── index.html
├── vite.config.js
├── tsconfig.json
├── src/
│   ├── main.tsx          # React入口
│   ├── App.tsx           # 主应用组件
│   ├── components/
│   │   ├── Observatory.tsx      # 3D场景主组件
│   │   └── TalismanPanel.tsx    # UI符咒面板
│   ├── lib/
│   │   └── starData.ts          # 数据定义
│   └── styles/
│       └── global.css           # 全局样式
```

## 4. 核心技术实现

### 4.1 3D渲染方案
- 使用 @react-three/fiber (R3F) 声明式创建Three.js场景
- 使用 @react-three/drei 提供的辅助组件：Html, Billboard, Stars等
- 自定义 useFrame 钩子实现行星轨道运动和动画

### 4.2 浑天仪拖拽旋转
- 监听鼠标按下/移动/松开事件
- 将鼠标位移转换为X/Y轴旋转角度（0-360度）
- 使用 useRef 获取浑天仪group引用，实时更新rotation
- 行星轨道随浑天仪group旋转自动倾斜

### 4.3 符咒拖拽系统
- HTML5 Drag and Drop API实现符咒拖拽
- ondragstart 记录拖拽的符咒类型
- ondragover 允许放置，高亮目标位置
- ondrop 检测位置是否匹配，触发对应特效
- 拖拽时使用自定义半透明拖拽图像 + CSS阴影

### 4.4 数据模型定义

**行星数据类型**:
```typescript
interface Planet {
  name: string;
  color: string;
  orbitRadius: number;
  period: number;
  size: number;
}
```

**星宿数据类型**:
```typescript
interface Constellation {
  name: string;
  position: [number, number, number];
}
```

**八卦数据类型**:
```typescript
interface Trigram {
  name: string;
  symbol: string;
  color: string;
  position: number;
  direction: [number, number];
}
```

### 4.5 性能优化
- 使用 Three.js InstancedMesh 渲染星点粒子
- 行星运动使用 requestAnimationFrame + useFrame 60FPS
- 符咒旗帜飘动使用顶点shader动画，减少JS计算
- 使用 React.memo 避免不必要的组件重渲染

## 5. 配置文件说明

### 5.1 vite.config.js
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  }
});
```

### 5.2 tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

### 5.3 package.json 依赖
- react: ^18.2.0
- react-dom: ^18.2.0
- three: ^0.160.0
- @react-three/fiber: ^8.15.12
- @react-three/drei: ^9.92.7
- typescript: ^5.3.3
- vite: ^5.0.8
- @vitejs/plugin-react: ^4.2.1
- @types/three: ^0.160.0
- @types/react: ^18.2.43
- @types/react-dom: ^18.2.17

## 6. 动画与过渡规范

| 交互类型 | 动画属性 | 时长 | 缓动函数 |
|---------|---------|------|----------|
| 所有过渡 | transition | 0.3s | ease-out |
| 按钮按下 | transform: scale | 0.15s | cubic-bezier(0.4, 0, 0.2, 1) |
| 按钮释放 | transform: scale | 0.15s | cubic-bezier(0.4, 0, 0.2, 1) |
| 符咒拖拽 | box-shadow | 0.3s | ease-out |
| 阵图高亮 | border-color / box-shadow | 0.2s | ease-out |
| 光柱出现 | opacity / scale | 0.3s | ease-out |
| 光柱消失 | opacity | 2s | ease-out |
| 符咒弹回 | transform | 0.4s | cubic-bezier(0.68, -0.55, 0.265, 1.55) |

## 7. 推演内核（与渲染解耦）

落点判定、推演结果与状态流转已从页面 / 场景组件中抽出为纯 TypeScript 内核，不依赖 React、DOM 与真实时钟，可离线批量驱动。

```
src/kernel/
├── divinationKernel.ts   # 状态机内核：事件、状态、落点判定、到期清理
├── batch.ts              # 统一批量运行入口 runBatch(events)
├── scenarios.ts          # 内置场景集（命中/未命中/重复投递/中途切换/边界/旋转叠加）
└── cli.ts                # 离线命令行入口（npm run batch，或重放自定义事件 JSON）
```

### 7.1 核心约定

- **落点判定只看方向**：`resolveTrigramPosition([x, y])` 以落点相对八卦阵图中心的方向（x 向右、y 向上）做 `atan2` 归位，与向量长度、阵图尺寸、缩放、滚动、指针精度无关；页面仅负责把屏幕坐标换算成方向后投递。
- **时间注入**：所有事件携带 `at` 时间戳；光柱 2000ms 消失、错误 400ms 复位均由内核按时间戳判定，`nextExpiryAt()` 告诉外部何时唤醒，杜绝陈旧 setTimeout 覆盖新状态。
- **字段独立演化**：`rotation` / `isRotating` / `draggedTalisman` / `isDragOverBagua` / `lightBeam` / `baguaError` 为同一状态对象上的独立字段，命中只写光柱、未命中只写错误。
- **投递幂等**：落点后当前拖拽符咒立即清空；同一次拖拽的重复投递、中途切换符咒后的陈旧投递一律忽略（`ignored: true`），最终状态与单次干净投递一致。
- **无变化不换引用**：被忽略的事件返回同一个 state 引用，React 绑定时 setState 自动跳过无效渲染。

### 7.2 React 绑定

`src/hooks/useDivinationKernel.ts` 以 `dispatch(event)` 接收 DOM 输入、以 `state` 驱动渲染，并依据 `nextExpiryAt()` 调度唯一的到期唤醒定时器；`App.tsx` 不再持有旋转 / 拖拽 / 光柱 / 错误的多份副本。

### 7.3 离线复现

```bash
npm run batch                         # 运行全部内置场景并断言
node --experimental-strip-types src/kernel/cli.ts events.json   # 重放事件序列
```

相同事件序列（含注入时间戳）的逐步状态快照与推演结果完全一致、可复现。
