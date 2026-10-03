## 1. 架构设计
```mermaid
graph TD
    A["App.tsx (主布局组件)"] --> B["WaveformVisualizer.tsx (波形可视化)"]
    A --> C["SpectrumVisualizer.tsx (频谱可视化)"]
    A --> D["AudioEngine.ts (音频引擎)"]
    D --> P["PlaybackState.ts (播放状态唯一来源)"]
    D --> E["Web Audio API"]
    E --> F["AudioBufferSourceNode"]
    E --> G["AnalyserNode"]
    E --> H["GainNode"]
    A --> I["UI Controls (播放/暂停/停止/循环)"]
    A --> J["Audio Info Display (时间/采样率/大小)"]
```

## 2. 技术描述
- 前端：React@18 + TypeScript@5 + Vite@5
- 构建工具：Vite + @vitejs/plugin-react
- 音频处理：原生Web Audio API（无第三方库）
- 图形渲染：HTML5 Canvas 2D API
- 状态管理：React useState/useRef/useEffect（轻量级场景无需状态管理库）
- 样式：纯CSS + CSS变量（无Tailwind等CSS框架）

## 3. 文件结构
```
├── package.json
├── vite.config.js
├── tsconfig.json
├── index.html
└── src/
    ├── main.ts (应用入口)
    ├── App.tsx (主布局组件)
    ├── AudioEngine.ts (Web Audio API封装)
    ├── PlaybackState.ts (播放状态唯一可信来源)
    ├── WaveformVisualizer.tsx (波形可视化组件)
    └── SpectrumVisualizer.tsx (频谱可视化组件)
```

## 4. 核心模块说明

### 4.1 AudioEngine.ts
- 负责音频文件加载和解码
- 作为 PlaybackState 的执行层：把状态变化翻译成音频图操作（启动/停止 AudioBufferSourceNode）
- 实时提取频谱数据（ByteFrequencyData）和时域数据（ByteTimeDomainData）
- 通过订阅快照（subscribe）将播放状态推送给UI层
- 支持选区播放（播放范围由 PlaybackState 中的选区决定）

### 4.2 WaveformVisualizer.tsx
- Canvas绘制完整音频波形（采样点压缩为垂直柱状）
- 支持鼠标拖拽选择播放区域
- 显示播放进度指示线
- 渐变描边（蓝色→紫色）和发光效果
- 选区高亮显示和起止时间显示

### 4.3 SpectrumVisualizer.tsx
- 128条频谱条，使用requestAnimationFrame动画循环
- 条带颜色渐变（低频蓝青色→高频橙红色）
- 弹性回落动画（使用速度和衰减模拟物理惯性）
- 暂停时保持当前频谱状态

### 4.4 PlaybackState.ts（播放状态唯一可信来源）
- 集中维护播放状态：播放/暂停、当前位置、选区起止、循环开关、时长
- 不依赖 Web Audio / DOM，时钟可注入，支持离线单元测试（tests/PlaybackState.test.ts）
- 保证不变量：位置始终在有效范围内；选区存在时位置始终落在选区内；
  停止/自然结束（非循环）/重新加载后位置归零且选区清空；切换循环不影响其它状态
- 通过 subscribe 推送不可变快照，UI 只镜像快照，不各自维护播放状态

### 4.5 App.tsx
- 订阅 AudioEngine 的播放状态快照并渲染
- 组合所有子组件
- 处理文件上传（拖拽和点击）
- 渲染播放控制按钮和音频信息
- 响应式布局处理

## 5. 性能优化策略
- Canvas绘制使用requestAnimationFrame维持60fps
- 波形数据预处理：离线计算一次，存储压缩后的采样点
- 频谱数据使用TypedArray减少内存开销
- 避免在动画循环中创建新对象
- 使用离屏Canvas预渲染渐变和静态元素
- 拖拽选区时只重绘必要区域

## 6. 类型定义
```typescript
// AudioEngine 类型
interface AudioMetadata {
  duration: number;
  sampleRate: number;
  fileSize: number;
  fileName: string;
}

interface AudioAnalysisData {
  frequencyData: Uint8Array;
  timeDomainData: Uint8Array;
  currentTime: number;
}

interface Selection {
  start: number;
  end: number;
}

// 组件Props类型
interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  selection: Selection | null;
  onSelectionChange: (selection: Selection | null) => void;
  onSeek: (time: number) => void;
}

interface SpectrumVisualizerProps {
  frequencyData: Uint8Array | null;
  isPlaying: boolean;
}
```
