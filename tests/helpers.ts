/**
 * Headless DOM stand-ins. The managers under test (EnvironmentManager,
 * FishManager) register window event listeners and read window.innerWidth /
 * innerHeight; main.ts is never imported, so no WebGL context is needed.
 * Importing this module installs the fake window as a global, so it must be
 * imported before constructing any manager.
 */

export type FakeListener = (event: Record<string, unknown>) => void;

export class FakeWindow {
  public innerWidth = 1920;
  public innerHeight = 1080;
  public devicePixelRatio = 1;
  private listeners = new Map<string, Set<FakeListener>>();

  public addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  public removeEventListener(type: string, fn: FakeListener): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Synchronously delivers an event to all registered listeners. */
  public dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      fn(event);
    }
  }
}

export const fakeWindow = new FakeWindow();
(globalThis as Record<string, unknown>).window = fakeWindow;

export interface FakeDocument {
  getElementById(id: string): { textContent: string | null } | null;
  text(id: string): string | null;
}

/** Minimal document: elements are created lazily so writes never get lost. */
export function createFakeDocument(): FakeDocument {
  const elements = new Map<string, { textContent: string | null }>();
  return {
    getElementById(id: string) {
      let el = elements.get(id);
      if (!el) {
        el = { textContent: '' };
        elements.set(id, el);
      }
      return el;
    },
    text(id: string) {
      return elements.get(id)?.textContent ?? null;
    },
  };
}

/** Asserts every component of every supplied vector-like value is finite. */
export function allFinite(values: Array<{ x: number; y: number; z: number }>): boolean {
  return values.every(
    (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
  );
}
