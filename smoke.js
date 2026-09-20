/* UI 冒烟测试：用极简 DOM 桩在 Node 中跑 app.js 的初始化渲染。node smoke.js */
'use strict';

function makeNode(tag) {
  const n = {
    tag: tag, children: [], style: {}, value: '', textContent: '', className: '',
    colSpan: 0, type: '', step: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
  };
  let html = '';
  Object.defineProperty(n, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = v;
      n.children = [];
      const m = v.match(/<td>/g);
      if (m) m.forEach(function () { n.children.push(makeNode('td')); });
    }
  });
  return n;
}
const byId = {};
function node(id) {
  if (!byId[id]) byId[id] = makeNode(id);
  return byId[id];
}
// 点表单需要命名控件
const pointForm = node('point-form');
pointForm.elements = {};
['name', 'rep', 'datum', 'lat', 'lng', 'accuracy', 'chainId'].forEach(function (n) {
  pointForm.elements[n] = makeNode('input-' + n);
});
pointForm.addEventListener = function () {};

const tbodySel = ['#points-table tbody', '#steps-table tbody', '#datum-table tbody', '#trace-table tbody'];
const bySel = {};

global.document = {
  getElementById: function (id) { return node(id); },
  querySelector: function (sel) {
    if (!bySel[sel]) bySel[sel] = makeNode(sel);
    return bySel[sel];
  },
  createElement: function (tag) { return makeNode(tag); }
};
const store = {};
global.localStorage = {
  getItem: function (k) { return store[k] || null; },
  setItem: function (k, v) { store[k] = String(v); }
};

global.Engine = require('./engine.js');
require('fs').readFileSync('app.js', 'utf8');
eval(require('fs').readFileSync('app.js', 'utf8'));

// 初始化后：点表应有 3 行，日志已写入，状态已持久化
const rows = bySel['#points-table tbody'].children.length;
console.log('点表行数:', rows);
console.log('日志:', node('log').textContent);
console.log('轨迹表行数:', bySel['#trace-table tbody'].children.length);
console.log('轨迹摘要:', node('trace-summary').innerHTML.slice(0, 80));
if (rows !== 3) { console.log('SMOKE FAIL'); process.exit(1); }
if (!store['coordtool.state.v1']) { console.log('SMOKE FAIL: 未持久化'); process.exit(1); }
console.log('SMOKE PASS');
