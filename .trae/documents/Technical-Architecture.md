## 1. 架构设计

```mermaid
flowchart TB
    subgraph "表示层 (UI)"
        A["DOM控制面板<br>（滑块、树状图）"]
        B["Canvas渲染器<br>（背景、动物、动画）"]
    end
    
    subgraph "业务逻辑层 (Core)"
        C["生态系统引擎<br>ecosystem.ts"]
        D["渲染器<br>renderer.ts"]
        E["UI管理器<br>ui.ts"]
    end
    
    subgraph "数据层 (Data)"
        F["动物实体数据"]
        G["环境参数状态"]
        H["种群统计数据"]
    end
    
    subgraph "外部交互"
        I["Web Audio API<br>（音效生成）"]
        J["requestAnimationFrame<br>（60fps循环）"]
    end
    
    A -- 滑块事件 --> E
    E -- 参数更新 --> C
    C -- 状态数据 --> D
    D -- 绘制指令 --> B
    C -- 统计数据 --> E
    E -- DOM更新 --> A
    C -- 音效触发 --> I
    J -- 帧回调 --> C
```

## 2. 技术选型

- **构建工具**：Vite 5.x + TypeScript 5.x
- **渲染技术**：HTML5 Canvas 2D API（无第三方游戏引擎）
- **UI框架**：原生DOM + CSS（无框架依赖，保持轻量）
- **音效**：Web Audio API（OscillatorNode 生成正弦波）
- **动画**：requestAnimationFrame + CSS transitions
- **开发依赖**：typescript、vite

## 3. 项目结构

```
auto37/
├── package.json          # 项目依赖与脚本
├── vite.config.js        # Vite构建配置
├── tsconfig.json         # TypeScript严格模式配置
├── index.html            # 入口HTML
└── src/
    ├── main.ts           # 应用入口，初始化各模块
    ├── ecosystem.ts      # 生态系统核心逻辑
    ├── renderer.ts       # Canvas渲染器
    ├── ui.ts             # UI控制面板管理
    └── types.ts          # 类型定义
```

## 4. 核心数据模型

### 4.1 类型定义

```typescript
// 动物类型
type AnimalType = 'rabbit' | 'sheep' | 'deer' | 'hamster' | 'squirrel' | 'wolf' | 'eagle' | 'snake';

// 食性
type Diet = 'herbivore' | 'carnivore';

// 动物实体
interface Animal {
  id: number;
  type: AnimalType;
  diet: Diet;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hunger: number;        // 0-100，越高越饿
  maxHunger: number;
  energy: number;
  maxEnergy: number;
  color: string;
  size: number;
  isDying: boolean;
  deathAnimation: number;
}

// 环境参数
interface EnvironmentParams {
  temperature: number;   // -10 ~ 50°C
  precipitation: number; // 0 ~ 500mm
  light: number;         // 0 ~ 100%
  pollution: number;     // 0 ~ 100%
}

// 捕食关系
const PREDATION_MAP: Record<AnimalType, AnimalType[]> = {
  wolf: ['rabbit', 'sheep', 'deer', 'hamster'],
  eagle: ['rabbit', 'squirrel', 'hamster'],
  snake: ['hamster', 'squirrel', 'rabbit'],
};

// 动物配置：maxEnergy 为能量上限，feedingRate 为满植物密度下植食动物的取食速率
const ANIMAL_CONFIG: Record<AnimalType, {
  diet: Diet; color: string; size: number; hungerRate: number;
  maxEnergy: number; feedingRate: number;
}> = {
  rabbit:   { diet: 'herbivore', color: '#ffffff', size: 12, hungerRate: 0.1,  maxEnergy: 80,  feedingRate: 8  },
  sheep:    { diet: 'herbivore', color: '#f5f5dc', size: 18, hungerRate: 0.08, maxEnergy: 120, feedingRate: 7  },
  deer:     { diet: 'herbivore', color: '#8b4513', size: 22, hungerRate: 0.06, maxEnergy: 150, feedingRate: 6  },
  hamster:  { diet: 'herbivore', color: '#ffa500', size: 8,  hungerRate: 0.15, maxEnergy: 60,  feedingRate: 10 },
  squirrel: { diet: 'herbivore', color: '#a0522d', size: 10, hungerRate: 0.12, maxEnergy: 70,  feedingRate: 9  },
  wolf:     { diet: 'carnivore', color: '#808080', size: 20, hungerRate: 0.05, maxEnergy: 200, feedingRate: 0 },
  eagle:    { diet: 'carnivore', color: '#1e3a5f', size: 16, hungerRate: 0.07, maxEnergy: 150, feedingRate: 0 },
  snake:    { diet: 'carnivore', color: '#228b22', size: 14, hungerRate: 0.09, maxEnergy: 120, feedingRate: 0 },
};
```

### 4.2 能量收支

- **代谢消耗**：每帧 `energy -= hungerRate * METABOLIC_DRAIN_SCALE * dt`，所有动物都消耗能量。
- **植食取食**：每帧 `energy += 植物密度 * feedingRate * dt`，植物密度由温度、降水、光照、污染共同决定；能量不超过 `maxEnergy`。
- **捕食转移**：捕食成功时捕食者获得被捕食者剩余能量的 `ENERGY_TRANSFER_RATIO`（0.5），被捕食者当帧立即退出模拟；同帧通过 `consumedIds` 保证一个猎物只被结算一次。
- **死亡**：`energy <= 0` 或 `hunger >= maxHunger` 都进入死亡动画；动画期间个体不进入空间网格、不会被捕食者选中，也不计入存活统计。
- **参数帧末生效**：`setParams()` 只写入 `pendingParams`，`update()` 开头统一应用，同帧多次修改时取食与捕食均按最终参数结算。
- **存活统计**：每帧末尾重建 `populationStats`，只统计非死亡动画中的个体；食物链面板中存活为零的被捕食者对应连线降级为灰色虚线，种群柱状图高度与数值同步。
- **离线验证**：`npm run verify` 运行 `verify/energy-verify.ts`（esbuild 打包后由 Node 执行），覆盖能量耗尽死亡、捕食能量转移、同帧重复结算、参数同帧多次修改与连续推进自洽性。

### 4.3 数据流向

1. **初始化**：用户配置初始动物数量 → ecosystem.ts 生成随机位置的动物数组
2. **帧更新**：requestAnimationFrame 触发 → 应用本帧最终参数 → 每帧更新位置、饥饿度与能量收支 → 捕食能量转移 → 存活统计
3. **参数更新**：滑块事件 → ui.ts → ecosystem.setParams()（帧末生效）→ 影响植物密度 → 影响植食动物取食能量
4. **渲染**：renderer.ts 从 ecosystem 获取状态 → Canvas 绘制背景、动物、动画、柱状图

## 5. 性能优化策略

- **空间分区**：将800x800地图划分为网格（50x50每格），碰撞检测只检测相邻格子
- **对象池**：捕食动画和能量数字使用对象池复用，避免频繁GC
- **批量绘制**：同类动物统一绘制路径，减少Canvas API调用
- **节流**：种群统计每10帧更新一次，UI更新与渲染解耦
- **离屏Canvas**：背景网格预先绘制到离屏Canvas缓存

## 6. API定义（内部模块接口）

### ecosystem.ts 暴露接口

```typescript
class Ecosystem {
  constructor(initialCount: number);
  update(deltaTime: number): void;
  setParams(params: Partial<EnvironmentParams>): void;
  getAnimals(): Animal[];
  getPopulationStats(): Record<AnimalType, number>;
  getPlantDensity(): number;
  getFloatingTexts(): FloatingText[];
}
```

### renderer.ts 暴露接口

```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement, ecosystem: Ecosystem);
  render(): void;
  resize(width: number, height: number): void;
}
```

### ui.ts 暴露接口

```typescript
class UIManager {
  constructor(container: HTMLElement, ecosystem: Ecosystem, audio: AudioManager);
  init(): void;
  updatePopulation(stats: Record<AnimalType, number>): void;
}
```
