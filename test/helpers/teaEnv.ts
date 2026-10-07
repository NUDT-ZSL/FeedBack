// 离线测试环境：可加速的假时钟 + 最小 DOM 替身。
// 不依赖网络、真实浏览器或 Three.js，仅模拟 TeaController 用到的
// window.setInterval/clearInterval 与 document.querySelector/classList。

interface FakeTimer {
  id: number;
  callback: () => void;
  interval: number | null;
  due: number;
}

export class FakeClock {
  private now = 0;
  private nextId = 1;
  private timers = new Map<number, FakeTimer>();

  setTimeout = (callback: () => void, delay = 0): number =>
    this.schedule(callback, delay, null);

  setInterval = (callback: () => void, delay = 0): number =>
    this.schedule(callback, delay, delay);

  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };

  clearInterval = (id: number): void => {
    this.timers.delete(id);
  };

  private schedule(
    callback: () => void,
    delay: number,
    interval: number | null
  ): number {
    const id = this.nextId++;
    this.timers.set(id, { id, callback, interval, due: this.now + delay });
    return id;
  }

  get pendingCount(): number {
    return this.timers.size;
  }

  tick(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let next: FakeTimer | null = null;
      for (const timer of this.timers.values()) {
        if (
          timer.due <= target &&
          (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id))
        ) {
          next = timer;
        }
      }
      if (!next) break;
      this.now = next.due;
      if (next.interval === null) {
        this.timers.delete(next.id);
      } else {
        next.due = this.now + next.interval;
      }
      next.callback();
    }
    this.now = target;
  }
}

export class FakeElement {
  private classes = new Set<string>();
  toggleCount = 0;

  classList = {
    add: (name: string): void => {
      this.classes.add(name);
    },
    remove: (name: string): void => {
      this.classes.delete(name);
    },
    toggle: (name: string): boolean => {
      this.toggleCount++;
      if (this.classes.has(name)) {
        this.classes.delete(name);
        return false;
      }
      this.classes.add(name);
      return true;
    },
    contains: (name: string): boolean => this.classes.has(name)
  };
}

export class FakeDocument {
  readonly elements = new Map<string, FakeElement>();

  register(paramKey: string): FakeElement {
    const element = new FakeElement();
    this.elements.set(paramKey, element);
    return element;
  }

  querySelector = (selector: string): FakeElement | null => {
    const match = /^\[data-param="(.+)"\]$/.exec(selector);
    if (!match) return null;
    return this.elements.get(match[1]) ?? null;
  };
}

export interface TeaTestEnv {
  clock: FakeClock;
  document: FakeDocument;
  elementFor(paramKey: string): FakeElement;
  restore(): void;
}

export function installTeaEnv(): TeaTestEnv {
  const clock = new FakeClock();
  const fakeDocument = new FakeDocument();
  for (const key of ['waterTemp', 'pourAngle', 'brewDuration']) {
    fakeDocument.register(key);
  }

  const fakeWindow = {
    setTimeout: clock.setTimeout,
    setInterval: clock.setInterval,
    clearTimeout: clock.clearTimeout,
    clearInterval: clock.clearInterval
  };

  const globalRef = globalThis as Record<string, unknown>;
  const previousWindow = globalRef.window;
  const previousDocument = globalRef.document;
  globalRef.window = fakeWindow;
  globalRef.document = fakeDocument;

  return {
    clock,
    document: fakeDocument,
    elementFor(paramKey: string): FakeElement {
      const element = fakeDocument.querySelector(`[data-param="${paramKey}"]`);
      if (!element) throw new Error(`未注册的参数元素: ${paramKey}`);
      return element;
    },
    restore(): void {
      if (previousWindow === undefined) delete globalRef.window;
      else globalRef.window = previousWindow;
      if (previousDocument === undefined) delete globalRef.document;
      else globalRef.document = previousDocument;
    }
  };
}
