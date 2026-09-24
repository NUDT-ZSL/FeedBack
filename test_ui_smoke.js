/* UI 冒烟测试：用最小 DOM 桩跑通 app.js 的初始化渲染与一次到货量修改。node test_ui_smoke.js */
'use strict';
const fs = require('fs');

function makeEl() {
  return { innerHTML: '', value: '', hidden: false, dataset: {},
    addEventListener() {}, };
}
const els = {};
const listeners = {};
global.document = {
  querySelector(sel) { return els[sel] || (els[sel] = makeEl()); },
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
};
global.window = global;

eval(fs.readFileSync('engine.js', 'utf8'));
eval(fs.readFileSync('app.js', 'utf8'));

let fails = 0;
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) fails++;
}

check('materials table rendered', els['#matBody'].innerHTML.indexOf('钢材A') >= 0);
check('adjudication panel shows branch', els['#adjPanel'].innerHTML.indexOf('钢材A') >= 0 &&
  els['#adjPanel'].innerHTML.indexOf('data-adj') >= 0);
check('product cards rendered', els['#prodCards'].innerHTML.indexOf('机箱') >= 0 &&
  els['#prodCards'].innerHTML.indexOf('控制盒') >= 0);
check('pending badge shown', els['#prodCards'].innerHTML.indexOf('待裁决') >= 0);
check('shortage badge shown', els['#prodCards'].innerHTML.indexOf('缺口') >= 0);
check('recompute log written', els['#logList'].innerHTML.indexOf('整体重推') >= 0);

// 模拟用户裁决 钢材A → 钢材B
const change = listeners.change[0];
change({ target: { dataset: { adj: 'M-ST-A' }, value: 'M-ST-B' } });
check('after adjudication log incremental', els['#logList'].innerHTML.indexOf('仅重推受影响成品') >= 0);
check('after adjudication no pending', els['#prodCards'].innerHTML.indexOf('待裁决') < 0);

// 模拟用户把 钢材A 到货量改成 0
change({ target: { dataset: { m: 'M-ST-A', f: 'arrival' }, value: '0' } });
check('arrival edit triggers incremental', els['#logList'].innerHTML.indexOf('到货量修正') >= 0);

console.log(fails === 0 ? 'UI SMOKE PASSED' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
