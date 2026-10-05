// 纯状态机：幻灯片集合的全部状态推演逻辑。
// 不依赖 React / DOM / 全屏接口，可在 Node 环境离线执行与断言。

export interface DataPoint {
  label: string;
  value: number;
}

export type ChartType = 'bar' | 'line';

export interface SlideData {
  id: string;
  title: string;
  chartType: ChartType;
  data: DataPoint[];
  note: string;
  noteFontSize: number;
}

export type Direction = 'forward' | 'backward';

export interface StoryState {
  slides: SlideData[];
  /** 当前选中下标；集合为空时为 -1 */
  currentIndex: number;
  direction: Direction;
  isPresentation: boolean;
}

export const MAX_SLIDES = 10;
export const NOTE_FONT_SIZE_MIN = 12;
export const NOTE_FONT_SIZE_MAX = 32;

/** 可注入的环境依赖，测试时替换为确定性实现 */
export interface StoryEnv {
  generateId: () => string;
  random: () => number;
}

export const defaultEnv: StoryEnv = {
  generateId: () => Math.random().toString(36).substring(2, 10),
  random: () => Math.random()
};

export type StoryAction =
  | { type: 'addSlide' }
  | { type: 'deleteSlide'; id: string }
  | { type: 'goToSlide'; index: number }
  | { type: 'goNext' }
  | { type: 'goPrev' }
  | { type: 'updateSlide'; id: string; updates: Partial<Omit<SlideData, 'id'>> }
  | { type: 'setPresentation'; value: boolean };

export const createInitialSlides = (env: StoryEnv = defaultEnv): SlideData[] => [
  {
    id: env.generateId(),
    title: '2024年度销售额概览',
    chartType: 'bar',
    data: [
      { label: 'Q1', value: 128000 },
      { label: 'Q2', value: 156000 },
      { label: 'Q3', value: 189000 },
      { label: 'Q4', value: 234000 },
      { label: 'Q1', value: 278000 },
      { label: 'Q2', value: 312000 }
    ],
    note: '<b>关键洞察：</b>年度销售额呈现持续增长态势。<br/><br/><i>主要驱动因素：</i><ul><li>新产品线贡献显著</li><li>东南亚市场快速扩张</li><li>品牌溢价策略生效</li></ul>',
    noteFontSize: 16
  },
  {
    id: env.generateId(),
    title: '用户增长趋势分析',
    chartType: 'line',
    data: [
      { label: '1月', value: 12500 },
      { label: '2月', value: 15800 },
      { label: '3月', value: 19200 },
      { label: '4月', value: 24600 },
      { label: '5月', value: 31200 },
      { label: '6月', value: 38900 }
    ],
    note: '<b>月活用户突破 38K</b>，环比增长 24.7%。<br/><br/><i>增长亮点：</i><ul><li>病毒式传播活动效果显著</li><li>产品体验优化降低流失率</li><li>付费转化率提升至 4.2%</li></ul>',
    noteFontSize: 16
  },
  {
    id: env.generateId(),
    title: '产品品类销售分布',
    chartType: 'bar',
    data: [
      { label: 'A类', value: 45600 },
      { label: 'B类', value: 32100 },
      { label: 'C类', value: 28700 },
      { label: 'D类', value: 19800 },
      { label: 'E类', value: 15400 },
      { label: 'F类', value: 8200 }
    ],
    note: '<b>A类产品</b>贡献最大销售额，占比约 32%。<br/><br/><i>策略建议：</i><ul><li>加大A类产品投入</li><li>优化D/F类产品结构</li><li>探索品类交叉销售机会</li></ul>',
    noteFontSize: 16
  }
];

export const createInitialState = (env: StoryEnv = defaultEnv): StoryState => ({
  slides: createInitialSlides(env),
  currentIndex: 0,
  direction: 'forward',
  isPresentation: false
});

const clampNoteFontSize = (size: number): number => {
  if (Number.isNaN(size)) return NOTE_FONT_SIZE_MIN;
  return Math.min(NOTE_FONT_SIZE_MAX, Math.max(NOTE_FONT_SIZE_MIN, size));
};

const createNewSlide = (slidesLength: number, env: StoryEnv): SlideData => ({
  id: env.generateId(),
  title: `新幻灯片 ${slidesLength + 1}`,
  chartType: 'bar',
  data: Array.from({ length: 6 }, (_, idx) => ({
    label: String.fromCharCode(65 + idx),
    value: Math.floor(env.random() * 50000) + 10000
  })),
  note: '',
  noteFontSize: 16
});

export function storyReducer(state: StoryState, action: StoryAction, env: StoryEnv = defaultEnv): StoryState {
  switch (action.type) {
    case 'addSlide': {
      // 达到上限：静默忽略，状态完全不变
      if (state.slides.length >= MAX_SLIDES) return state;
      const newSlide = createNewSlide(state.slides.length, env);
      return {
        ...state,
        slides: [...state.slides, newSlide],
        direction: 'forward',
        currentIndex: state.slides.length
      };
    }

    case 'deleteSlide': {
      const idx = state.slides.findIndex(slide => slide.id === action.id);
      // 不存在的目标：静默忽略
      if (idx === -1) return state;
      const slides = state.slides.filter(slide => slide.id !== action.id);
      // 选中项收敛到合法区间；集合为空时为 -1
      const currentIndex = slides.length === 0
        ? -1
        : Math.min(state.currentIndex, slides.length - 1);
      // 方向标记收敛：删除导致选中项前移记为 backward，否则保持 forward
      const direction: Direction = idx < state.currentIndex ? 'backward' : 'forward';
      return { ...state, slides, currentIndex, direction };
    }

    case 'goToSlide': {
      // 越界或原地跳转：静默跳过
      if (action.index < 0 || action.index >= state.slides.length || action.index === state.currentIndex) {
        return state;
      }
      return {
        ...state,
        direction: action.index > state.currentIndex ? 'forward' : 'backward',
        currentIndex: action.index
      };
    }

    case 'goNext': {
      // 末页边界：不越界推进
      if (state.currentIndex >= state.slides.length - 1) return state;
      return { ...state, direction: 'forward', currentIndex: state.currentIndex + 1 };
    }

    case 'goPrev': {
      // 首页边界：不越界推进
      if (state.currentIndex <= 0) return state;
      return { ...state, direction: 'backward', currentIndex: state.currentIndex - 1 };
    }

    case 'updateSlide': {
      const updates = { ...action.updates };
      if (updates.noteFontSize !== undefined) {
        updates.noteFontSize = clampNoteFontSize(updates.noteFontSize);
      }
      let changed = false;
      const slides = state.slides.map(slide => {
        if (slide.id !== action.id) return slide;
        changed = true;
        return { ...slide, ...updates };
      });
      // 目标不存在：静默忽略
      return changed ? { ...state, slides } : state;
    }

    case 'setPresentation': {
      if (state.isPresentation === action.value) return state;
      return { ...state, isPresentation: action.value };
    }

    default:
      return state;
  }
}

/** 键盘策略：返回应派发的动作；无需响应时返回 null */
export function actionForKey(key: string, state: StoryState): StoryAction | null {
  if (state.isPresentation) {
    if (key === 'Escape' || key === ' ') return { type: 'setPresentation', value: false };
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') return { type: 'goNext' };
  if (key === 'ArrowLeft' || key === 'ArrowUp') return { type: 'goPrev' };
  return null;
}

/** 与 DOM 无关的轻量 Store，供非 React 环境（含测试）驱动状态机 */
export interface StoryStore {
  getState: () => StoryState;
  dispatch: (action: StoryAction) => StoryState;
}

export const createStoryStore = (
  initialState: StoryState,
  env: StoryEnv = defaultEnv
): StoryStore => {
  let state = initialState;
  return {
    getState: () => state,
    dispatch: (action: StoryAction) => {
      state = storyReducer(state, action, env);
      return state;
    }
  };
};
