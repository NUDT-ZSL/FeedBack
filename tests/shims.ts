// 无浏览器环境垫片：安装最小 DOM 桩并替换 Math.random 为确定性伪随机数。
// 该模块必须在任何 import 到 src/（three / CanvasTexture / document）之前先执行。

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Gradient {
  addColorStop: (offset: number, color: string) => void;
}

function makeGradient(): Gradient {
  return { addColorStop() {} };
}

function make2dContext(): CanvasRenderingContext2D {
  return {
    fillRect() {},
    fillText() {},
    createRadialGradient: makeGradient,
    createLinearGradient: makeGradient
  } as unknown as CanvasRenderingContext2D;
}

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => make2dContext()
  } as unknown as HTMLCanvasElement;
}

export function installShims(): void {
  const documentStub = {
    createElement: (_tag: string): HTMLCanvasElement => makeCanvas()
  } as unknown as Document;
  (globalThis as { document?: Document }).document = documentStub;
}

let randomImpl = mulberry32(20261004);

export function resetSeed(seed: number): void {
  randomImpl = mulberry32(seed >>> 0);
}

export function installDeterministicRandom(): void {
  Math.random = () => randomImpl();
}
