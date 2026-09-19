/* smoke.js — 用 DOM 桩在 Node 中执行 app.js,验证启动/刷新/交互路径不抛异常 */
const fs = require('fs');
const vm = require('vm');

function makeCtx() {
  const noop = () => {};
  return new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : noop), set: () => true });
}
function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {}, classList: { add(){}, remove(){} },
    set className(v) { this._cls = v; }, get className() { return this._cls; },
    set textContent(v) { this._txt = v; }, get textContent() { return this._txt; },
    set innerHTML(v) { this.children = []; }, get innerHTML() { return ''; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, onclick: null, value: '', scrollTop: 0, scrollHeight: 0,
    getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }),
    getContext: () => makeCtx(),
    parentElement: null
  };
  el.parentElement = { getBoundingClientRect: () => ({ width: 960, height: 640 }) };
  return el;
}
const ids = {};
['view','tree','annList','conflictList','log','reparentTarget','annId','annAnchor','annText',
 'annSource','relFrom','relTo','relType','btnResetCam','btnDelete','btnReparent','btnAddAnn',
 'btnConflict','btnAddRel'].forEach(id => { ids[id] = makeEl('div'); ids[id].id = id; });
const opsButtons = [];
['1,0,0','0,1,0','0,0,1'].forEach(m => { const b = makeEl('button'); b.dataset.move = m; opsButtons.push(b); });
const rotB = makeEl('button'); rotB.dataset.rot = '0,15,0'; opsButtons.push(rotB);
const sclB = makeEl('button'); sclB.dataset.scale = '1.2'; opsButtons.push(sclB);

const sandbox = {
  console,
  document: {
    getElementById: id => ids[id],
    createElement: t => makeEl(t),
    querySelectorAll: sel => opsButtons.filter(b =>
      (sel === '[data-move]' && b.dataset.move) ||
      (sel === '[data-rot]' && b.dataset.rot) ||
      (sel === '[data-scale]' && b.dataset.scale)),
  },
  window: { addEventListener() {} },
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('core.js', 'utf8'), sandbox, { filename: 'core.js' });
sandbox.Core = sandbox.window.Core;
vm.runInContext(fs.readFileSync('app.js', 'utf8'), sandbox, { filename: 'app.js' });

/* 启动后应已完成 seed + refresh */
vm.runInContext(`
  if (state.annotations.size !== 4) throw new Error('seed 标注数量异常: ' + state.annotations.size);
  if (state.relations.length !== 2) throw new Error('seed 关系数量异常');
  var v = Core.computeView(state, camera, viewport);
  if (v.annotations.length !== 4) throw new Error('视图标注数量异常');
  if (!v.annotations.every(a => a.status)) throw new Error('缺少可见性状态');
`, sandbox);

/* 模拟交互:移动对象、删除对象、注入冲突、成环关系 */
vm.runInContext(`
  selectedObject = 'desk';
  document.querySelectorAll('[data-move]')[0].onclick();
  var ann = state.annotations.get('A-001');
  var w = Core.worldAnchor(state, ann);
  if (Math.abs(w[0] - (-1)) > 1e-6) throw new Error('移动后锚点未随动: ' + w);
  selectedAnn = 'A-001';
  document.getElementById('btnConflict').onclick();
  if (state.conflicts.length !== 1) throw new Error('冲突未生成');
  Core.addRelation(state, 'A-001', 'A-003', 'reference');
  var r = Core.addRelation(state, 'A-001', 'A-002', 'dependency');
  if (r.ok) throw new Error('成环未被拒绝');
  selectedObject = 'cabinet';
  document.getElementById('btnDelete').onclick();
  if (!state.annotations.get('A-002').invalid) throw new Error('删除后标注未失效');
  refresh();
  console.log('SMOKE OK: 标注 ' + state.annotations.size + ', 冲突 ' + state.conflicts.length +
    ', 日志 ' + state.log.length + ' 条');
`, sandbox);
console.log('smoke.js 全部通过');
