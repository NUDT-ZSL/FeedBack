// 可控假定时器：替代全局 setTimeout/setInterval，支持 advance(ms) 加速推进，
// 让依赖定时器的告警闪烁可以在无真实等待的条件下被确定性判定。
export function installFakeTimers() {
  const real = {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
  };

  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function schedule(type, fn, delay) {
    const id = nextId++;
    timers.set(id, { type, fn, delay, nextFire: now + delay });
    return id;
  }

  function cancel(id) {
    timers.delete(id);
  }

  globalThis.setTimeout = (fn, delay = 0) => schedule('timeout', fn, delay);
  globalThis.setInterval = (fn, delay = 0) => schedule('interval', fn, delay);
  globalThis.clearTimeout = cancel;
  globalThis.clearInterval = cancel;

  function advance(ms) {
    const target = now + ms;
    for (;;) {
      let nextEntry = null;
      let nextKey = null;
      for (const [id, timer] of timers) {
        if (
          timer.nextFire <= target &&
          (nextEntry === null ||
            timer.nextFire < nextEntry.nextFire ||
            (timer.nextFire === nextEntry.nextFire && id < nextKey))
        ) {
          nextEntry = timer;
          nextKey = id;
        }
      }
      if (!nextEntry) break;
      now = nextEntry.nextFire;
      if (nextEntry.type === 'interval') {
        nextEntry.nextFire += nextEntry.delay;
      } else {
        timers.delete(nextKey);
      }
      nextEntry.fn();
    }
    now = target;
  }

  return {
    advance,
    pendingCount: () => timers.size,
    now: () => now,
    restore() {
      globalThis.setTimeout = real.setTimeout;
      globalThis.setInterval = real.setInterval;
      globalThis.clearTimeout = real.clearTimeout;
      globalThis.clearInterval = real.clearInterval;
    },
  };
}
