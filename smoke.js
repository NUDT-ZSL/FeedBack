/*
 * smoke.js — 用最小 DOM 桩在 Node 中执行 app.js，验证“启动即可操作”的渲染链路无运行时错误。
 * 运行：node smoke.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---- 最小 DOM 桩 ----
function makeElement(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', value: '', hidden: false, title: '',
    children: [], listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    querySelectorAll() { return []; },
    reset() { this.children = []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    set(v) { if (v === '') this.children = []; else throw new Error('stub 仅支持 innerHTML=""'); },
    get() { return ''; }
  });
  return el;
}

const ids = ['thresholdInput', 'resetSeedBtn', 'clearBtn', 'matrixWrap', 'cohortASelect', 'cohortBSelect',
  'pairCacheBadge', 'pairResult', 'stratumSummaryWrap', 'stratumASelect', 'stratumBSelect', 'strataResultResult',
  'cohortForm', 'obsForm', 'sizeForm', 'stratumList', 'ingestMsg', 'conflictWrap', 'rejectWrap'];
const registry = {};
ids.forEach(id => { registry[id] = makeElement('div'); });
registry.thresholdInput.value = '2';

// 表单字段桩（cohortForm/obsForm/sizeForm 的命名字段）
function fakeForm() {
  const f = makeElement('form');
  ['name', 'stratum', 'start', 'size', 'cohortId', 'period', 'active', 'source', 'reportedAt', 'newSize']
    .forEach(n => { f[n] = makeElement('input'); });
  return f;
}
['cohortForm', 'obsForm', 'sizeForm'].forEach(id => { registry[id] = fakeForm(); });

global.document = {
  getElementById: id => registry[id] || null,
  createElement: tag => makeElement(tag),
  querySelectorAll: () => []
};
global.Option = function (text, value) { const o = makeElement('option'); o.textContent = text; o.value = value; return o; };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

// ---- 加载并执行 ----
const Engine = require(path.join(__dirname, 'engine.js'));
global.Engine = Engine;
const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
eval(appSrc);

// ---- 断言：启动后各面板均有内容（需求 7） ----
assert.ok(registry.matrixWrap.children.length === 1, '留存矩阵应已渲染');
assert.ok(registry.pairResult.children.length > 0, '两两比较结果应已渲染');
assert.ok(registry.stratumSummaryWrap.children.length === 1, '分层摘要应已渲染');
assert.ok(registry.conflictWrap.children.length > 0, '冲突记录应已渲染（示例数据含冲突）');
assert.ok(registry.rejectWrap.children.length > 0, '拒绝日志面板应已渲染');

// 矩阵文本应包含冲突标记
const matrixText = JSON.stringify(registry.matrixWrap.children[0], (k, v) => k === 'listeners' ? undefined : v);
assert.ok(matrixText.includes('⚠ 冲突'), '矩阵应显示冲突标记');

// 比较结果应包含共同窗口说明与反转说明
const pairText = JSON.stringify(registry.pairResult, (k, v) => k === 'listeners' ? undefined : v);
assert.ok(pairText.includes('共同观察窗口'), '应展示可比窗口');
assert.ok(pairText.includes('反转'), '应展示方向反转信息');
assert.ok(pairText.includes('已排除'), '应展示窗口外排除说明');

// 分层摘要应包含“不可比”标记
const strataText = JSON.stringify(registry.stratumSummaryWrap, (k, v) => k === 'listeners' ? undefined : v);
assert.ok(strataText.includes('不可比'), '分层摘要应包含不可比标记');

// 模拟一次表单上报：给 obsForm 字段赋值并触发 submit
const form = registry.obsForm;
form.cohortId.value = 'IFB-06';
form.period.value = '4';
form.active.value = '500';
form.source.value = '数据平台';
form.reportedAt.value = '';
const evt = { preventDefault() {}, target: form };
form.listeners.submit.forEach(fn => fn(evt));
assert.strictEqual(registry.ingestMsg.hidden, false, '上报后应显示反馈消息');
assert.ok(registry.ingestMsg.className.includes('accepted'), '合法上报应被接受');
const pairText2 = JSON.stringify(registry.pairResult, (k, v) => k === 'listeners' ? undefined : v);
assert.ok(pairText2.includes('第 0 期 ~ 第 4 期'), '新增观测后共同窗口应立即扩展到第 4 期');

// 模拟一次非法上报：活跃数超规模 → 立即显示拒绝原因
form.period.value = '5';
form.active.value = '9999';
form.listeners.submit.forEach(fn => fn(evt));
assert.ok(registry.ingestMsg.className.includes('rejected'), '非法上报应被拒绝');
assert.ok(registry.ingestMsg.textContent.includes('超过规模'), '拒绝原因应指出问题与位置');

console.log('smoke: 启动渲染 + 上报联动 + 拒绝反馈 全部通过');
