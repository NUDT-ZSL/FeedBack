/* Smoke test: run app.js init + interactions against a minimal DOM stub. */
const assert = require('assert');
const fs = require('fs');

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

// app.js is an IIFE that runs init on load
eval(fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8'));

// after init, demo batch should be loaded and scheduled
const saved = JSON.parse(store['mpq-state-v1']);
assert.strictEqual(saved.tasks.length, 10, 'demo batch should have 10 tasks');
assert(saved.tasks.every(t => t.status === 'scheduled'), 'all demo tasks scheduled');
assert(saved.tasks.every(t => t.channel !== null && t.start !== null), 'all have slots');
assert(els['task-rows'].innerHTML.includes('T05'), 'task table rendered');
assert(els.gantt.innerHTML.includes('block'), 'gantt rendered');
assert(els.errors.classList !== null, 'error box exists');
console.log('ok - app init loads demo batch, schedules and renders');

// determinism through the persisted state: reload app and compare plans
const planA = saved.tasks.map(t => [t.id, t.channel, t.start, t.end].join(':')).join('|');
delete require.cache; 
eval(fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8'));
const saved2 = JSON.parse(store['mpq-state-v1']);
const planB = saved2.tasks.map(t => [t.id, t.channel, t.start, t.end].join(':')).join('|');
assert.strictEqual(planA, planB, 'reloaded batch must produce identical plan');
console.log('ok - reloading persisted state reproduces identical schedule');
console.log('\nsmoke tests passed');
