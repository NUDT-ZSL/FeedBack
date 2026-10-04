// 离线验证设施：
// - DeckDriver 以纯函数方式重演任意操作序列（含演示/键盘/全屏替身）
// - expectState 对标题、图表类型、数据点、注释内容与字号、选中项、方向等逐字段断言
// - runAll 批量执行全部用例并输出可读的通过/失败结论

import {
  ChartType,
  DataPoint,
  DeckAction,
  DeckState,
  Direction,
  MAX_SLIDES,
  NEW_SLIDE_VALUE_MIN,
  NEW_SLIDE_VALUE_SPAN,
  RandomSource,
  SlideData,
  createInitialDeckState,
  deckReducer
} from '../src/model/slides.js';
import {
  FullscreenPort,
  createNullFullscreenPort,
  fullscreenChangeAction,
  resolveKeyCommand,
  togglePresentation
} from '../src/model/presentation.js';

export interface AssertionFailure {
  step: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export class AssertionError extends Error {
  constructor(
    public failures: AssertionFailure[],
    public actionTrace: string[]
  ) {
    super(
      failures.map(f => `[${f.step}] ${f.field}: 期望 ${formatValue(f.expected)}, 实际 ${formatValue(f.actual)}`).join('\n')
    );
  }
}

const formatValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value);
};

const deepEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// 确定性随机源：让新增幻灯片的数据在离线测试中可重复断言。
export const createSeededRandom = (seed: number): RandomSource => {
  let idCounter = 0;
  let state = seed >>> 0 || 1;
  return {
    nextId: () => `test-id-${++idCounter}`,
    nextValue: () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return NEW_SLIDE_VALUE_MIN + (state % NEW_SLIDE_VALUE_SPAN);
    }
  };
};

const describeAction = (action: DeckAction): string => {
  switch (action.type) {
    case 'go-to':
      return `go-to(${action.index})`;
    case 'update-slide':
    case 'update-current-slide': {
      const fields = Object.keys(action.updates).join(',');
      return action.type === 'update-slide'
        ? `update-slide(${action.id}; ${fields})`
        : `update-current(${fields})`;
    }
    default:
      return action.type;
  }
};

export class DeckDriver {
  state: DeckState;
  history: string[] = [];

  constructor(
    initial: DeckState = createInitialDeckState(),
    private readonly rng: RandomSource = createSeededRandom(42)
  ) {
    this.state = initial;
  }

  dispatch(action: DeckAction): this {
    this.history.push(describeAction(action));
    this.state = deckReducer(this.state, action, this.rng);
    return this;
  }

  addSlide(): this { return this.dispatch({ type: 'add-slide' }); }
  deleteCurrent(): this { return this.dispatch({ type: 'delete-current-slide' }); }
  goTo(index: number): this { return this.dispatch({ type: 'go-to', index }); }
  next(): this { return this.dispatch({ type: 'go-next' }); }
  prev(): this { return this.dispatch({ type: 'go-prev' }); }
  enterPresentation(): this { return this.dispatch({ type: 'presentation-enter' }); }
  exitPresentation(): this { return this.dispatch({ type: 'presentation-exit' }); }

  update(id: string, updates: Partial<SlideData>): this {
    return this.dispatch({ type: 'update-slide', id, updates });
  }

  updateCurrent(updates: Partial<SlideData>): this {
    return this.dispatch({ type: 'update-current-slide', updates });
  }

  async togglePresentation(port: FullscreenPort = createNullFullscreenPort()): Promise<this> {
    this.history.push('toggle-presentation');
    const result = await togglePresentation(this.state, port);
    this.state = result.state;
    this.history.push(`=> ${result.action.type}`);
    return this;
  }

  // 以纯逻辑方式重演一次键盘事件，返回是否应 preventDefault。
  press(key: string): boolean {
    const command = resolveKeyCommand(key, this.state);
    if (!command) return false;
    this.history.push(`key(${JSON.stringify(key)})`);
    this.dispatch(command.action);
    return command.preventDefault;
  }

  fullscreenChange(port: FullscreenPort = createNullFullscreenPort()): this {
    this.history.push('fullscreenchange');
    const action = fullscreenChangeAction(this.state, port);
    if (action) this.dispatch(action);
    return this;
  }

  get slides(): SlideData[] { return this.state.slides; }
  get current(): SlideData { return this.state.slides[this.state.currentIndex]; }

  recentActions(count = 10): string[] {
    return this.history.slice(-count);
  }
}

export interface ExpectedCurrent {
  title?: string;
  chartType?: ChartType;
  note?: string;
  noteFontSize?: number;
  data?: readonly DataPoint[];
}

export interface ExpectedState {
  slideCount?: number;
  currentIndex?: number;
  direction?: Direction;
  isPresentation?: boolean;
  revisions?: number;
  titles?: readonly string[];
  chartTypes?: readonly ChartType[];
  notes?: readonly string[];
  noteFontSizes?: readonly number[];
  dataLengths?: readonly number[];
  current?: ExpectedCurrent;
}

export function expectState(
  deck: DeckDriver,
  step: string,
  expected: ExpectedState
): void {
  const state = deck.state;
  const failures: AssertionFailure[] = [];
  const check = (field: string, actual: unknown, wanted: unknown) => {
    if (!deepEqual(actual, wanted)) {
      failures.push({ step, field, expected: wanted, actual });
    }
  };

  if (expected.slideCount !== undefined) check('slideCount', state.slides.length, expected.slideCount);
  if (expected.currentIndex !== undefined) check('currentIndex', state.currentIndex, expected.currentIndex);
  if (expected.direction !== undefined) check('direction', state.direction, expected.direction);
  if (expected.isPresentation !== undefined) check('isPresentation', state.isPresentation, expected.isPresentation);
  if (expected.revisions !== undefined) check('revisions', state.revisions, expected.revisions);
  if (expected.titles !== undefined) check('titles', state.slides.map(s => s.title), expected.titles);
  if (expected.chartTypes !== undefined) check('chartTypes', state.slides.map(s => s.chartType), expected.chartTypes);
  if (expected.notes !== undefined) check('notes', state.slides.map(s => s.note), expected.notes);
  if (expected.noteFontSizes !== undefined) {
    check('noteFontSizes', state.slides.map(s => s.noteFontSize), expected.noteFontSizes);
  }
  if (expected.dataLengths !== undefined) {
    check('dataLengths', state.slides.map(s => s.data.length), expected.dataLengths);
  }
  if (expected.current !== undefined) {
    const current = state.slides[state.currentIndex];
    const cur = expected.current;
    if (cur.title !== undefined) check('current.title', current.title, cur.title);
    if (cur.chartType !== undefined) check('current.chartType', current.chartType, cur.chartType);
    if (cur.note !== undefined) check('current.note', current.note, cur.note);
    if (cur.noteFontSize !== undefined) check('current.noteFontSize', current.noteFontSize, cur.noteFontSize);
    if (cur.data !== undefined) check('current.data', current.data, cur.data);
  }

  if (failures.length > 0) {
    throw new AssertionError(failures, deck.recentActions());
  }
}

export function assertTrue(condition: boolean, step: string, message: string, deck?: DeckDriver): void {
  if (!condition) {
    throw new AssertionError(
      [{ step, field: message, expected: true, actual: condition }],
      deck ? deck.recentActions() : []
    );
  }
}

// 记录调用、可按需让 request/exit 失败的全屏替身。
export interface FakeFullscreenPort extends FullscreenPort {
  requests: number;
  exits: number;
  active: boolean;
  failRequest: boolean;
  failExit: boolean;
}

export const createFakeFullscreenPort = (options?: {
  failRequest?: boolean;
  failExit?: boolean;
  active?: boolean;
}): FakeFullscreenPort => ({
  requests: 0,
  exits: 0,
  active: options?.active ?? false,
  failRequest: options?.failRequest ?? false,
  failExit: options?.failExit ?? false,
  async request() {
    this.requests += 1;
    if (this.failRequest) throw new Error('fullscreen request denied');
    this.active = true;
  },
  async exit() {
    this.exits += 1;
    if (this.failExit) throw new Error('exit fullscreen failed');
    this.active = false;
  },
  get isActive() {
    return this.active;
  }
});

export interface TestCase {
  name: string;
  run: () => void | Promise<void>;
}

export const case_ = (name: string, run: () => void | Promise<void>): TestCase => ({ name, run });

interface RunOutcome {
  passed: number;
  failed: number;
  failureLines: string[];
}

export const runCases = async (suites: { name: string; cases: TestCase[] }[]): Promise<RunOutcome> => {
  let passed = 0;
  let failed = 0;
  const failureLines: string[] = [];

  for (const suite of suites) {
    console.log(`\n## ${suite.name}`);
    for (const testCase of suite.cases) {
      try {
        await testCase.run();
        passed += 1;
        console.log(`  [PASS] ${testCase.name}`);
      } catch (error) {
        failed += 1;
        console.log(`  [FAIL] ${testCase.name}`);
        failureLines.push(`套件「${suite.name}」用例「${testCase.name}」`);
        if (error instanceof AssertionError) {
          for (const failure of error.failures) {
            const line = `  - 步骤「${failure.step}」字段 ${failure.field}：期望 ${formatValue(failure.expected)}，实际 ${formatValue(failure.actual)}`;
            console.log(line);
            failureLines.push(line);
          }
          if (error.actionTrace.length > 0) {
            const trace = `    操作序列（末 ${error.actionTrace.length} 步）: ${error.actionTrace.join(' -> ')}`;
            console.log(trace);
            failureLines.push(trace);
          }
        } else if (error instanceof Error) {
          const line = `  - 未捕获错误: ${error.message}`;
          console.log(line);
          failureLines.push(line);
        }
      }
    }
  }
  return { passed, failed, failureLines };
};

export { MAX_SLIDES };
