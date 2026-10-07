// Deterministic virtual clock shared by performance.now() and setTimeout().
let nowMs = 1000;
let nextId = 1;
const timers = new Map();

export const clock = {
  now() {
    return nowMs;
  },
  reset(startMs = 1000) {
    nowMs = startMs;
    nextId = 1;
    timers.clear();
  },
  setTimeout(callback, delayMs = 0) {
    const id = nextId++;
    timers.set(id, { callback, fireAt: nowMs + Math.max(0, Number(delayMs) || 0) });
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
  advance(ms) {
    const target = nowMs + Math.max(0, Number(ms) || 0);
    for (;;) {
      let earliest = null;
      for (const [id, timer] of timers) {
        if (timer.fireAt > target) continue;
        if (earliest === null || timer.fireAt < earliest.fireAt ||
            (timer.fireAt === earliest.fireAt && id < earliest.id)) {
          earliest = { id, ...timer };
        }
      }
      if (earliest === null) break;
      nowMs = earliest.fireAt;
      timers.delete(earliest.id);
      earliest.callback();
    }
    nowMs = target;
  },
  pendingTimerCount() {
    return timers.size;
  },
};
