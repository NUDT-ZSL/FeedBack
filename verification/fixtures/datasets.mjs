/**
 * 本地样例（不依赖任何在线服务或缓存文件）。
 * 每个样例都是纯 JSON 数据，供多个验证用例复用。
 */

/** 无异常基线：三个对象、三条事件、记录间存在跨对象关联。 */
export const baselineInput = {
  records: [
    { id: 'r-a1', objectId: 'A', timestamp: 1, state: { mode: 'idle' } },
    { id: 'r-a5', objectId: 'A', timestamp: 5, state: { mode: 'moving' }, links: ['r-b5'] },
    { id: 'r-a9', objectId: 'A', timestamp: 9, state: { mode: 'idle' } },
    { id: 'r-b2', objectId: 'B', timestamp: 2, state: { temp: 20 } },
    { id: 'r-b5', objectId: 'B', timestamp: 5, state: { temp: 25 } },
    { id: 'r-c3', objectId: 'C', timestamp: 3, state: { pos: [1, 0] } },
    { id: 'r-c7', objectId: 'C', timestamp: 7, state: { pos: [2, 0] }, links: ['r-c3'] },
  ],
  events: [
    { id: 'e-heat', timestamp: 3, kind: 'heat', links: ['r-b2'] },
    { id: 'e-move', timestamp: 5, kind: 'move', links: ['r-a5'] },
    { id: 'e-pos', timestamp: 7, kind: 'locate', links: ['r-c7'] },
  ],
};

/** 矛盾样例：A 在 t=5 有 moving/stopped 两种状态，t=9 为后续干净记录。 */
export const conflictInput = {
  records: [
    { id: 'r-a1', objectId: 'A', timestamp: 1, state: { mode: 'idle' } },
    { id: 'r-a5x', objectId: 'A', timestamp: 5, state: { mode: 'moving' }, priority: 0 },
    { id: 'r-a5y', objectId: 'A', timestamp: 5, state: { mode: 'stopped' }, priority: 0 },
    { id: 'r-a9', objectId: 'A', timestamp: 9, state: { mode: 'idle' } },
    { id: 'r-b2', objectId: 'B', timestamp: 2, state: { temp: 20 } },
    { id: 'r-c3', objectId: 'C', timestamp: 3, state: { pos: [1, 0] } },
  ],
  events: [
    { id: 'e-move', timestamp: 5, kind: 'move', links: ['r-a5x'] },
    { id: 'e-b', timestamp: 2, kind: 'heat', links: ['r-b2'] },
  ],
};

/** 关联异常样例：缺失指向、自引用、三记录成环。 */
export const anomalyInput = {
  records: [
    { id: 'r-good', objectId: 'A', timestamp: 1, state: { mode: 'idle' } },
    { id: 'r-miss', objectId: 'A', timestamp: 3, state: { mode: 'x' }, links: ['r-ghost'] },
    { id: 'r-self', objectId: 'B', timestamp: 2, state: { temp: 1 }, links: ['r-self'] },
    { id: 'r-c1', objectId: 'C', timestamp: 1, state: { v: 1 }, links: ['r-c2'] },
    { id: 'r-c2', objectId: 'C', timestamp: 2, state: { v: 2 }, links: ['r-c3'] },
    { id: 'r-c3', objectId: 'C', timestamp: 3, state: { v: 3 }, links: ['r-c1'] },
  ],
  events: [
    { id: 'e-miss', timestamp: 1, kind: 'k', links: ['r-nope'] },
    { id: 'e-cycle', timestamp: 1, kind: 'k', links: ['r-c1'] },
  ],
};

/** 关联修正/撤回样例：三条事件分别锚定不同对象。 */
export const mutableInput = {
  records: [
    { id: 'r-a1', objectId: 'A', timestamp: 1, state: { mode: 'idle' } },
    { id: 'r-a5', objectId: 'A', timestamp: 5, state: { mode: 'moving' } },
    { id: 'r-b2', objectId: 'B', timestamp: 2, state: { temp: 20 } },
    { id: 'r-c3', objectId: 'C', timestamp: 3, state: { pos: [1, 0] } },
  ],
  events: [
    { id: 'e1', timestamp: 3, kind: 'k1', links: ['r-a1'] },
    { id: 'e2', timestamp: 3, kind: 'k2', links: ['r-b2'] },
    { id: 'e3', timestamp: 6, kind: 'k3', links: ['r-a5'] },
  ],
};
