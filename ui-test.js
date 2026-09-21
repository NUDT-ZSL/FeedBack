/* Drives the inline UI script of index.html with a minimal DOM stub to verify
   regenerate / state-clearing / reachability-change notice behavior. */
'use strict';
const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeCtx() {
  return new Proxy({}, {
    get(t, k) { if (!(k in t)) t[k] = () => {}; return t[k]; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function makeEl(id) {
  const listeners = {};
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    style: {},
    width: 0,
    height: 0,
    classList: { add() {}, remove() {} },
    getContext: () => makeCtx(),
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatch(ev) { (listeners[ev] || []).forEach(fn => fn()); }
  };
}

const els = {};
const defaults = {
  seed: 'ui-27', width: '60', height: '40', roomCount: '10', minRoomSize: '4',
  maxRoomSize: '9', extraCorridors: '3', waterRatio: '0.05', lavaRatio: '0.02', targetCount: '5'
};
for (const id of Object.keys(defaults)) { els[id] = makeEl(id); els[id].value = defaults[id]; }
for (const id of ['map', 'errorBox', 'noticeBox', 'summary', 'unreach', 'genBtn', 'seedBtn']) {
  els[id] = els[id] || makeEl(id);
}

global.document = { getElementById: id => els[id] };
global.location = { search: '' };
global.window = global;
global.Dungeon = require('./dungeon.js');

eval(script);

// initial auto-generate happened on load
assert.ok(els.summary.innerHTML.includes('ui-27'), '初始应自动生成并显示摘要');
assert.ok(els.summary.innerHTML.includes('可达目标'), '摘要应包含可达目标统计');
assert.ok(els.map.width > 0 && els.map.height > 0, '画布尺寸应已设置');
console.log('PASS  初始加载自动生成并渲染摘要');

// find a water ratio that breaks reachability for this seed
const D = require('./dungeon.js');
let breakRatio = null;
for (let r = 0.1; r <= 0.5; r += 0.05) {
  const res = D.generate({ seed: 'ui-27', waterRatio: r, lavaRatio: 0.02 });
  if (res.targets.some(t => !t.reachable)) { breakRatio = r; break; }
}
assert.ok(breakRatio, '测试种子应存在能阻断目标的参数');

els.waterRatio.value = String(breakRatio);
els.waterRatio.dispatch('input');
// debounce 250ms
setTimeout(() => {
  assert.ok(els.noticeBox.textContent.includes('由可达变为不可达'), '应提示目标由可达变为不可达');
  assert.ok(els.noticeBox.textContent.includes('水域'), '应说明是水域约束被破坏');
  assert.ok(els.unreach.innerHTML.includes('不可达目标'), '不可达列表应刷新');
  console.log('PASS  修改参数后即时提示可达性变化及被破坏的约束');

  // invalid params: error shown, old map state cleared
  els.roomCount.value = '999';
  els.roomCount.dispatch('input');
  setTimeout(() => {
    assert.ok(els.errorBox.textContent.includes('参数不合法'), '非法参数应提示');
    assert.strictEqual(els.summary.innerHTML, '', '非法参数时旧摘要应被清除');
    assert.strictEqual(els.unreach.innerHTML, '', '非法参数时旧不可达列表应被清除');
    console.log('PASS  非法参数明确提示且不残留上一次状态');

    // restore valid params: error hidden, map regenerated
    els.roomCount.value = '10';
    els.roomCount.dispatch('input');
    setTimeout(() => {
      assert.ok(els.summary.innerHTML.includes('可达目标'), '恢复合法参数后应重新生成');
      console.log('PASS  恢复合法参数后地图与摘要同步刷新');
      console.log('\nUI 逻辑测试全部通过');
    }, 300);
  }, 300);
}, 300);
