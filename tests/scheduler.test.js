/* Scheduler core tests: determinism, capacity/dependency constraints,
   failure propagation, retry/priority-change replan consistency, validation. */
const assert = require('assert');
const S = require('../scheduler.js');

function mkTasks() {
  return [
    { id: 'T01', assetId: 'V-101', type: 'transcode', duration: 4, priority: 5, deps: [] },
    { id: 'T02', assetId: 'V-102', type: 'transcode', duration: 3, priority: 3, deps: [] },
    { id: 'T03', assetId: 'V-103', type: 'edit', duration: 6, priority: 4, deps: ['T01'] },
    { id: 'T04', assetId: 'V-104', type: 'subtitle', duration: 2, priority: 2, deps: ['T01'] },
    { id: 'T05', assetId: 'V-105', type: 'mux', duration: 5, priority: 5, deps: ['T03', 'T04'] },
    { id: 'T06', assetId: 'V-106', type: 'compress', duration: 3, priority: 1, deps: ['T05'] },
    { id: 'T07', assetId: 'V-101', type: 'edit', duration: 4, priority: 3, deps: ['T02'] },
    { id: 'T08', assetId: 'V-103', type: 'subtitle', duration: 2, priority: 4, deps: ['T03'] },
    { id: 'T09', assetId: 'V-104', type: 'mux', duration: 3, priority: 2, deps: ['T07', 'T08'] },
    { id: 'T10', assetId: 'V-105', type: 'compress', duration: 2, priority: 1, deps: ['T09'] }
  ];
}
const ASSETS = ['V-101', 'V-102', 'V-103', 'V-104', 'V-105', 'V-106'];

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// 1. Determinism: identical input -> identical plan, repeatedly
test('deterministic: same batch scheduled twice gives identical plan', () => {
  const a = S.schedule(mkTasks(), 3);
  const b = S.schedule(mkTasks(), 3);
  assert.deepStrictEqual(a, b);
  const shuffled = mkTasks().reverse();
  const c = S.schedule(shuffled, 3);
  assert.deepStrictEqual(a, c); // input order must not matter
});

// 2. Capacity + dependency constraints hold
test('constraints: no channel overlap, deps finish before dependents start', () => {
  const channels = 3;
  const plan = S.schedule(mkTasks(), channels);
  const byId = new Map(plan.map(p => [p.taskId, p]));
  for (const t of mkTasks()) {
    for (const d of t.deps) {
      assert(byId.get(d).end <= byId.get(t.id).start, t.id + ' starts before dep ' + d + ' ends');
    }
  }
  for (let c = 0; c < channels; c++) {
    const iv = plan.filter(p => p.channel === c).sort((x, y) => x.start - y.start);
    for (let i = 1; i < iv.length; i++) {
      assert(iv[i - 1].end <= iv[i].start, 'channel ' + c + ' overlap');
    }
  }
});

// 3. Failure propagation: downstream closure marks exactly the dependents
test('failure propagation: downstream closure is exact transitive set', () => {
  const tasks = mkTasks();
  const closure = S.downstreamClosure(tasks, ['T01']);
  assert.deepStrictEqual([...closure].sort(), ['T03', 'T04', 'T05', 'T06', 'T08', 'T09', 'T10']);
  const none = S.downstreamClosure(tasks, ['T10']);
  assert.strictEqual(none.size, 0);
});

// 4. Replan after retry / priority change equals full from-scratch reschedule
test('replan consistency: retry and priority change match full reschedule', () => {
  const tasks = mkTasks().map(t => ({ ...t, status: 'scheduled' }));
  const CHANNELS = 3;
  const applyPlan = (plan) => {
    const byId = new Map(plan.map(p => [p.taskId, p]));
    for (const t of tasks) {
      if (t.status === 'pending' || t.status === 'scheduled') {
        const p = byId.get(t.id);
        Object.assign(t, { channel: p.channel, start: p.start, end: p.end, status: 'scheduled' });
      }
    }
  };
  const schedulable = () => tasks.filter(t => t.status === 'pending' || t.status === 'scheduled');
  const fixed = () => tasks.filter(t => t.status === 'done')
    .map(t => ({ taskId: t.id, channel: t.channel, start: t.start, end: t.end }));
  const snapshot = () => schedulable()
    .map(t => ({ taskId: t.id, channel: t.channel, start: t.start, end: t.end }))
    .sort((a, b) => (a.taskId < b.taskId ? -1 : 1));
  const sortPlan = p => p.slice().sort((a, b) => (a.taskId < b.taskId ? -1 : 1));

  applyPlan(S.schedule(schedulable(), CHANNELS));
  // complete T01, T02; fail T03 and block its downstream
  for (const id of ['T01', 'T02']) tasks.find(t => t.id === id).status = 'done';
  const t03 = tasks.find(t => t.id === 'T03');
  Object.assign(t03, { status: 'failed', channel: null, start: null, end: null });
  const closure = S.downstreamClosure(tasks, ['T03']);
  for (const t of tasks) {
    if (closure.has(t.id) && (t.status === 'scheduled' || t.status === 'pending')) {
      Object.assign(t, { status: 'blocked', channel: null, start: null, end: null });
    }
  }
  applyPlan(S.schedule(schedulable(), CHANNELS, fixed()));
  // retry the failed chain, then replan
  for (const t of tasks) {
    if (t.status === 'failed' || t.status === 'blocked') t.status = 'pending';
  }
  applyPlan(S.schedule(schedulable(), CHANNELS, fixed()));
  assert.deepStrictEqual(snapshot(), sortPlan(S.schedule(schedulable(), CHANNELS, fixed())));
  // priority change: T10 to top priority, replan, compare with fresh reschedule
  tasks.find(t => t.id === 'T10').priority = 9;
  applyPlan(S.schedule(schedulable(), CHANNELS, fixed()));
  assert.deepStrictEqual(snapshot(), sortPlan(S.schedule(schedulable(), CHANNELS, fixed())));
});

// 5. Validation: cycle and missing asset are reported and block scheduling
test('validation: cycle and missing asset reported with task ids', () => {
  const bad = [
    { id: 'X1', assetId: 'V-101', duration: 2, priority: 3, deps: ['X3'] },
    { id: 'X2', assetId: 'V-102', duration: 2, priority: 3, deps: ['X1'] },
    { id: 'X3', assetId: 'V-103', duration: 2, priority: 3, deps: ['X2'] },
    { id: 'X4', assetId: 'V-999', duration: 2, priority: 3, deps: [] }
  ];
  const errors = S.validate(bad, ASSETS);
  const types = errors.map(e => e.type);
  assert(types.includes('cycle'), 'cycle not detected');
  assert(types.includes('missing-asset'), 'missing asset not detected');
  const cycle = errors.find(e => e.type === 'cycle');
  assert(cycle.message.includes('X1') && cycle.message.includes('X2') && cycle.message.includes('X3'));
  const miss = errors.find(e => e.type === 'missing-asset');
  assert(miss.message.includes('X4') && miss.message.includes('V-999'));
  assert.strictEqual(S.validate(mkTasks(), ASSETS).length, 0);
  // downstream-of-cycle task must not be flagged as a cycle member
  const withTail = bad.concat([{ id: 'X5', assetId: 'V-101', duration: 1, priority: 1, deps: ['X1'] }]);
  const c2 = S.validate(withTail, ASSETS).find(e => e.type === 'cycle');
  assert(!c2.message.includes('X5'), 'downstream task wrongly flagged as cycle member');
});

// 6. Fixed reservations are honored (done tasks keep their slots)
test('fixed slots: completed tasks keep channel/time reservations', () => {
  const fixed = [{ taskId: 'T01', channel: 0, start: 0, end: 4 }];
  const plan = S.schedule(mkTasks().filter(t => t.id !== 'T01'), 3, fixed);
  for (const p of plan) {
    if (p.channel === 0) assert(p.start >= 4, 'overlaps fixed slot');
  }
  assert(plan.some(p => p.taskId === 'T03' && p.start >= 4), 'dependent respects done task end');
});

console.log('\n' + passed + ' tests passed');
