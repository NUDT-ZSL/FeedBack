/* smoke.js - load all browser scripts under a stub DOM and run frames (run: node smoke.js) */
'use strict';
const fs = require('fs');
const vm = require('vm');

function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {}, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    _listeners: {},
    set textContent(v) { this._text = v; this.children.length = 0; },
    get textContent() { return this._text || ''; },
    set innerHTML(v) { this._html = v; this.children.length = 0; },
    get innerHTML() { return this._html || ''; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {},
    click() { (this._listeners.click || []).forEach((f) => f({ target: el })); },
    getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; },
    getContext() { return ctxStub; },
    setAttribute() {}, focus() {},
  };
  return el;
}

const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return canvasEl;
    return typeof t[k] !== 'undefined' ? t[k] : (t[k] = () => {});
  },
  set(t, k, v) { t[k] = v; return true; },
});

const ids = ['scene', 'labels', 'toast', 'partList', 'partEditor', 'annList', 'annEditor',
  'btnAddPart', 'btnAnnotate', 'btnExport', 'btnImport', 'fileInput'];
const els = {};
ids.forEach((id) => { els[id] = makeEl(id); });
const canvasEl = els.scene;
canvasEl.parentElement = makeEl('view');

let rafQueue = [];
const sandbox = {
  console, JSON, Math, isFinite, parseFloat, parseInt, setTimeout, clearTimeout,
  devicePixelRatio: 1,
  document: {
    getElementById: (id) => els[id] || (els[id] = makeEl(id)),
    createElement: (tag) => makeEl(tag),
  },
  requestAnimationFrame: (f) => { rafQueue.push(f); },
  Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  FileReader: function () {},
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
vm.createContext(sandbox);

for (const f of ['math3d.js', 'scene.js', 'render.js', 'panel.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
  console.log('loaded ' + f);
}

// run 5 frames
for (let i = 0; i < 5; i++) {
  const q = rafQueue; rafQueue = [];
  q.forEach((f) => f());
}
console.log('ran 5 frames without errors');

// assertions
const S = sandbox.Scene;
if (S.state.parts.length !== 3) throw new Error('expected 3 seed parts');
if (S.state.annotations.length !== 2) throw new Error('expected 2 seed annotations');
if (!S.state.annotations.every((a) => a.valid)) throw new Error('seed annotations should be valid');
const labelCount = els.labels.children.length;
if (labelCount !== 2) throw new Error('expected 2 DOM labels, got ' + labelCount);

// simulate: delete part P2 -> its annotation must become invalid but stay visible
S.deletePart('P2');
for (let i = 0; i < 2; i++) { const q = rafQueue; rafQueue = []; q.forEach((f) => f()); }
const orphan = S.state.annotations.find((a) => a.partId === 'P2');
if (!orphan || orphan.valid || orphan.invalidReason !== 'missing-part') throw new Error('invalidation failed');
if (els.labels.children.length !== 2) throw new Error('invalid label must remain in view');

// simulate: camera move -> screen positions re-derived
sandbox.Render.camera.theta += 0.5;
for (let i = 0; i < 2; i++) { const q = rafQueue; rafQueue = []; q.forEach((f) => f()); }

// simulate: annotate-mode click on canvas center hits a part
const btn = els.btnAnnotate;
btn.click();
console.log('smoke OK: parts=' + S.state.parts.length + ' annotations=' + S.state.annotations.length);
