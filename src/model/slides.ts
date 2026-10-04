// 幻灯片集合的纯状态逻辑（无 DOM、无 React、无全屏依赖）。
// 所有界面操作（新增/删除/切换/编辑/演示/键盘）都收敛为对 DeckState 的纯函数推演，
// 以便在 Node 环境下离线断言任意操作序列后的状态。

export type ChartType = 'bar' | 'line';
export type Direction = 'forward' | 'backward';

export interface DataPoint {
  label: string;
  value: number;
}

export interface SlideData {
  id: string;
  title: string;
  chartType: ChartType;
  data: DataPoint[];
  note: string;
  noteFontSize: number;
}

export const MAX_SLIDES = 10;
export const NOTE_FONT_SIZE_MIN = 12;
export const NOTE_FONT_SIZE_MAX = 32;
export const NEW_SLIDE_POINT_COUNT = 6;
export const NEW_SLIDE_VALUE_MIN = 10000;
export const NEW_SLIDE_VALUE_SPAN = 50000;

export interface RandomSource {
  nextId(): string;
  nextValue(): number;
}

export const defaultRandomSource: RandomSource = {
  nextId: () => Math.random().toString(36).substring(2, 10),
  nextValue: () =>
    Math.floor(Math.random() * NEW_SLIDE_VALUE_SPAN) + NEW_SLIDE_VALUE_MIN
};

export interface DeckState {
  slides: SlideData[];
  currentIndex: number;
  direction: Direction;
  isPresentation: boolean;
  /** 已确认提交的更新次数：重复提交相同内容（无实质变化）不计入。 */
  revisions: number;
}

export type DeckAction =
  | { type: 'add-slide' }
  | { type: 'delete-current-slide' }
  | { type: 'go-to'; index: number }
  | { type: 'go-next' }
  | { type: 'go-prev' }
  | { type: 'update-slide'; id: string; updates: Partial<SlideData> }
  | { type: 'update-current-slide'; updates: Partial<SlideData> }
  | { type: 'presentation-enter' }
  | { type: 'presentation-exit' }
  | { type: 'fullscreen-lost' };

const clampNoteFontSize = (size: number): number => {
  if (!Number.isFinite(size)) return NOTE_FONT_SIZE_MIN;
  return Math.min(NOTE_FONT_SIZE_MAX, Math.max(NOTE_FONT_SIZE_MIN, Math.round(size)));
};

const sanitizeDataPoint = (point: DataPoint): DataPoint => ({
  label: String(point.label),
  value: Number.isFinite(point.value) ? point.value : 0
});

const sanitizeUpdates = (updates: Partial<SlideData>): Partial<SlideData> => {
  const clean: Partial<SlideData> = {};
  if (updates.title !== undefined) clean.title = String(updates.title);
  if (updates.chartType !== undefined) clean.chartType = updates.chartType;
  if (updates.note !== undefined) clean.note = String(updates.note);
  if (updates.noteFontSize !== undefined) {
    clean.noteFontSize = clampNoteFontSize(updates.noteFontSize);
  }
  if (updates.data !== undefined) {
    clean.data = updates.data.map(sanitizeDataPoint);
  }
  return clean;
};

const isSameData = (a: DataPoint[], b: DataPoint[]): boolean =>
  a.length === b.length &&
  a.every((point, idx) => point.label === b[idx].label && point.value === b[idx].value);

const applyUpdates = (slide: SlideData, updates: Partial<SlideData>): SlideData | null => {
  const clean = sanitizeUpdates(updates);
  const next: SlideData = { ...slide, ...clean };
  const changed =
    next.title !== slide.title ||
    next.chartType !== slide.chartType ||
    next.note !== slide.note ||
    next.noteFontSize !== slide.noteFontSize ||
    (clean.data !== undefined && !isSameData(clean.data, slide.data));
  return changed ? next : null;
};

const createNewSlide = (ordinal: number, rng: RandomSource): SlideData => ({
  id: rng.nextId(),
  title: `新幻灯片 ${ordinal}`,
  chartType: 'bar',
  data: Array.from({ length: NEW_SLIDE_POINT_COUNT }, (_, idx) => ({
    label: String.fromCharCode(65 + idx),
    value: rng.nextValue()
  })),
  note: '',
  noteFontSize: 16
});

export const deckReducer = (
  state: DeckState,
  action: DeckAction,
  rng: RandomSource = defaultRandomSource
): DeckState => {
  switch (action.type) {
    case 'add-slide': {
      // 达到数量上限时静默忽略，选中项与集合保持不变。
      if (state.slides.length >= MAX_SLIDES) return state;
      const slide = createNewSlide(state.slides.length + 1, rng);
      return {
        ...state,
        slides: [...state.slides, slide],
        currentIndex: state.slides.length,
        direction: 'forward'
      };
    }
    case 'delete-current-slide': {
      // 仅剩一张时忽略删除；删除后选中项收敛到合法范围，
      // 选中项前移时方向标记为 backward，否则保持原方向。
      if (state.slides.length <= 1) return state;
      const slides = state.slides.filter((_, idx) => idx !== state.currentIndex);
      const currentIndex = Math.min(state.currentIndex, slides.length - 1);
      return {
        ...state,
        slides,
        currentIndex,
        direction: currentIndex < state.currentIndex ? 'backward' : state.direction
      };
    }
    case 'go-to': {
      // 越界、负索引或当前索引：静默跳过。
      if (
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index >= state.slides.length ||
        action.index === state.currentIndex
      ) {
        return state;
      }
      return {
        ...state,
        currentIndex: action.index,
        direction: action.index > state.currentIndex ? 'forward' : 'backward'
      };
    }
    case 'go-next': {
      if (state.currentIndex >= state.slides.length - 1) return state;
      return { ...state, currentIndex: state.currentIndex + 1, direction: 'forward' };
    }
    case 'go-prev': {
      if (state.currentIndex <= 0) return state;
      return { ...state, currentIndex: state.currentIndex - 1, direction: 'backward' };
    }
    case 'update-slide':
    case 'update-current-slide': {
      const id =
        action.type === 'update-slide'
          ? action.id
          : state.slides[state.currentIndex]?.id;
      if (id === undefined) return state;
      let changed = false;
      const slides = state.slides.map(slide => {
        if (slide.id !== id) return slide;
        const next = applyUpdates(slide, action.updates);
        if (next === null) return slide;
        changed = true;
        return next;
      });
      // 无实质变化（含重复提交相同内容）：整体状态原样返回，不新增提交记录。
      if (!changed) return state;
      return { ...state, slides, revisions: state.revisions + 1 };
    }
    case 'presentation-enter':
      return state.isPresentation ? state : { ...state, isPresentation: true };
    case 'presentation-exit':
    case 'fullscreen-lost':
      return state.isPresentation ? { ...state, isPresentation: false } : state;
    default:
      return state;
  }
};

export const createDeckState = (slides: SlideData[]): DeckState => ({
  slides,
  currentIndex: 0,
  direction: 'forward',
  isPresentation: false,
  revisions: 0
});

export const createInitialSlides = (): SlideData[] => [
  {
    id: defaultRandomSource.nextId(),
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
    id: defaultRandomSource.nextId(),
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
    id: defaultRandomSource.nextId(),
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

export const createInitialDeckState = (): DeckState =>
  createDeckState(createInitialSlides());
