/**
 * 最小化的浏览器环境桩。
 *
 * 只实现太阳系场景构造与逐帧更新路径实际访问到的 DOM 2D 画布与
 * 元素接口，不做任何真实渲染，因此验证不依赖 GPU、真实帧率或布局。
 */

interface StubElement {
  tagName: string;
  width: number;
  height: number;
  className: string;
  dataset: Record<string, string>;
  innerHTML: string;
  style: Record<string, string>;
  classList: {
    toggle: (name: string, force?: boolean) => void;
    add: (name: string) => void;
    contains: (name: string) => boolean;
    _classes: Set<string>;
  };
  appendChild: (child: unknown) => unknown;
  getContext: (type: string) => Stub2DContext | null;
}

interface Stub2DContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  fillRect: (...args: number[]) => void;
  beginPath: () => void;
  moveTo: (...args: number[]) => void;
  lineTo: (...args: number[]) => void;
  stroke: () => void;
  fill: () => void;
  ellipse: (...args: number[]) => void;
  createRadialGradient: (...args: number[]) => { addColorStop: () => void };
  createLinearGradient: (...args: number[]) => { addColorStop: () => void };
}

function create2DContext(): Stub2DContext {
  const gradient = { addColorStop(): void {} };
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect(): void {},
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    fill(): void {},
    ellipse(): void {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient
  };
}

function createElement(tagName: string): StubElement {
  const classes = new Set<string>();
  return {
    tagName: tagName.toUpperCase(),
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    innerHTML: '',
    style: {},
    classList: {
      _classes: classes,
      toggle(name: string, force?: boolean): void {
        const has = classes.has(name);
        const on = force === undefined ? !has : force;
        if (on) classes.add(name);
        else classes.delete(name);
      },
      add(name: string): void {
        classes.add(name);
      },
      contains(name: string): boolean {
        return classes.has(name);
      }
    },
    appendChild(): void {
      return undefined;
    },
    getContext: (): Stub2DContext | null =>
      tagName === 'canvas' ? create2DContext() : null
  };
}

export interface InstalledStubs {
  elements: StubElement[];
  restore: () => void;
}

/** 在 globalThis 上安装 document / window 桩；返回创建过的元素与还原函数。 */
export function installDomStubs(): InstalledStubs {
  const elements: StubElement[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const previous: Record<string, unknown> = {
    document: g.document,
    window: g.window
  };

  g.document = {
    createElement(tagName: string): StubElement {
      const el = createElement(tagName);
      elements.push(el);
      return el;
    },
    getElementById(): StubElement | null {
      return null;
    }
  };

  g.window = {
    innerWidth: 1920,
    innerHeight: 1080
  };

  return {
    elements,
    restore(): void {
      g.document = previous.document;
      g.window = previous.window;
    }
  };
}
