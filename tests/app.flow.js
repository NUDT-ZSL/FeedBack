/* Flow test: drive app.js through fail -> blocked propagation -> retry -> consistency. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '',
    classList: { add() {}, remove() {} },
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    querySelectorAll() { return []; },
    closest() { return null; }
  };
}
const els = {};
const ids = ['errors', 'task-rows', 'gantt', 'failures', 'stats', 'log', 'asset-list',
  'f-asset', 'f-deps', 'f-id', 'channel-count', 'btn-schedule', 'btn-check', 'btn-demo',
  'btn-baddemo', 'btn-clear', 'asset-form', 'task-form', 'f-new-asset', 'f-type',
  'f-duration', 'f-priority'];
for (const id of ids) els[id] = makeEl(id);
global.document = { getElementById: id => els[id] || makeEl(id) };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.Scheduler = require('../scheduler.js');
eval(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'));

const state = () => JSON.parse(store['mpq-state-v1']);
const clickRows = (act, id) => {
  const ev = { target: { closest: () => ({ dataset: { act, id } }) } };
  els['task-rows'].listeners.click.forEach(fn => fn(ev));
};
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok - ' + name); };

test('fail T03 marks exact downstream as blocked (pending retry)', () => {
  clickRows('fail', 'T03');
  const tasks = state().tasks;
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  assert.strictEqual(byId.T03.status, 'failed');
  for (const id of ['T05', 'T06', 'T08', 'T09', 'T10']) {
    assert.strictEqual(byId[id].status, 'blocked', id + ' should be blocked');
    assert.strictEqual(byId[id].channel, null, id + ' slot cleared');
  }
  for (const id of ['T01', 'T02', 'T04', 'T07']) {
    assert.strictEqual(byId[id].status, 'scheduled', id + ' unaffected');
  }
  assert(els.failures.innerHTML.includes('待重试'), 'failure panel shows blocked tasks');
});

test('retry failed chain reschedules and matches full from-scratch reschedule', () => {
  // complete T01 first so the retry happens against a partially-executed batch
  clickRows('done', 'T01');
  clickRows('retry', 'T03');
  const tasks = state().tasks;
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  assert.strictEqual(byId.T01.status, 'done');
  for (const id of ['T03', 'T05', 'T06', 'T08', 'T09', 'T10']) {
    assert.strictEqual(byId[id].status, 'scheduled', id + ' rescheduled');
  }
  // full from-scratch reschedule of the same state
  const schedulable = tasks.filter(t => t.status === 'scheduled');
  const fixed = tasks.filter(t => t.status === 'done')
    .map(t => ({ taskId: t.id, channel: t.channel, start: t.start, end: t.end }));
  const fresh = global.Scheduler.schedule(schedulable, state().channels, fixed);
  const freshById = Object.fromEntries(fresh.map(p => [p.taskId, p]));
  for (const t of schedulable) {
    const f = freshById[t.id];
    assert(t.channel === f.channel && t.start === f.start && t.end === f.end,
      t.id + ' differs from full reschedule');
  }
});

test('priority change replans and stays consistent with full reschedule', () => {
  els['task-rows'].listeners.change.forEach(fn => fn({ target: { dataset: { prio: 'T10' }, value: '9' } }));
  const tasks = state().tasks;
  assert.strictEqual(tasks.find(t => t.id === 'T10').priority, 9);
  const schedulable = tasks.filter(t => t.status === 'scheduled');
  const fixed = tasks.filter(t => t.status === 'done')
    .map(t => ({ taskId: t.id, channel: t.channel, start: t.start, end: t.end }));
  const fresh = global.Scheduler.schedule(schedulable, state().channels, fixed);
  const freshById = Object.fromEntries(fresh.map(p => [p.taskId, p]));
  for (const t of schedulable) {
    const f = freshById[t.id];
    assert(t.channel === f.channel && t.start === f.start && t.end === f.end,
      t.id + ' differs after priority change');
  }
});

test('bad batch blocks scheduling and reports problem tasks', () => {
  els['btn-baddemo'].listeners.click.forEach(fn => fn());
  const html = els.errors.innerHTML;
  assert(html.includes('X1') && html.includes('X2') && html.includes('X3'), 'cycle tasks reported');
  assert(html.includes('X4') && html.includes('V-999'), 'missing asset reported');
  const tasks = state().tasks;
  assert(tasks.filter(t => t.status === 'scheduled').every(t => !t.id.startsWith('X')),
    'bad tasks must not be scheduled');
});

console.log('\n' + passed + ' flow tests passed');
