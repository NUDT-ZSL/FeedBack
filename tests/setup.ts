if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window: unknown }).window = {
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    addEventListener(): void {},
    removeEventListener(): void {},
  };
}

if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame === 'undefined') {
  (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
}
