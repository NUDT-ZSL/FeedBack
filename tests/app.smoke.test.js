// 界面层冒烟测试：用最小 DOM 桩在 Node 中执行 app.js，
// 验证初始渲染、补报拒绝、补报扣减、冲突消解、阶段校验拒绝等关键交互。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// 最小 DOM 桩：只实现 app.js 用到的能力
// ---------------------------------------------------------------------------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.handlers = {};
    this.value = '';
    this._text = '';
    this.id = undefined;
  }
  get classList() {
    const self = this;
    return {
      add(cls) {
        if (!self.className.split(/\s+/).includes(cls)) {
          self.className = (self.className + ' ' + cls).trim();
        }
      },
    };
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set innerHTML(v) {
    if (v === '') this.children = [];
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
  }
  addEventListener(type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
  }
  click() {
    (this.handlers.click || []).forEach((f) => f());
  }
  matches(sel) {
    if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    return this.tagName === sel.toUpperCase();
  }
  *walk() {
    for (const c of this.children) {
      yield c;
      yield* c.walk();
    }
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/);
    let current = [this];
    for (const part of parts) {
      const next = [];
      for (const node of current) {
        for (const d of node.walk()) {
          if (d.matches(part)) next.push(d);
        }
      }
      current = next;
    }
    return current;
  }
}

function buildDocument() {
  const root = new El('body');
  const mk = (tag, id, parent) => {
    const e = new El(tag);
    if (id) e.id = id;
    (parent || root).appendChild(e);
    return e;
  };
  mk('p', 'session-meta');
  mk('section', 'resume-banner');
  mk('div', 'timeline');
  mk('span', 'conservation-badge');
  mk('tbody', null, mk('table', 'stage-result-table'));
  mk('div', 'net-list');
  mk('div', 'interruption-list');
  mk('ul', 'event-log');
  for (const id of [
    'inp-session-name',
    'inp-session-start',
    'inp-session-now',
    'inp-rep-id',
    'inp-rep-source',
    'inp-rep-start',
    'inp-rep-end',
  ]) {
    mk('input', id);
  }
  mk('select', 'inp-rep-status');
  mk('tbody', null, mk('table', 'stage-edit-table'));
  for (const id of ['btn-apply-session', 'btn-apply-stages', 'btn-add-stage', 'btn-add-report', 'btn-clear-log', 'btn-reset']) {
    mk('button', id);
  }
  return {
    createElement: (tag) => new El(tag),
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
}

// ---------------------------------------------------------------------------
// 装载环境并执行 app.js（IIFE，加载即完成首次渲染）
// ---------------------------------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = buildDocument();
globalThis.FocusEngine = require('../src/engine.js');
require('../src/app.js');

const $ = (sel) => globalThis.document.querySelector(sel);
const $$ = (sel) => globalThis.document.querySelectorAll(sel);

// ---------------------------------------------------------------------------
// 以下测试共享同一份应用状态，按声明顺序执行
// ---------------------------------------------------------------------------
test('初始渲染：恢复位置、阶段表、净区间、冲突标记齐全', () => {
  const banner = $('#resume-banner').textContent;
  assert.match(banner, /继续进入：第 4 阶段「文档整理」/);
  assert.match(banner, /剩余额度 30 分钟/);
  assert.match(banner, /1 个打断存在冲突/);

  assert.equal($$('#stage-result-table tbody tr').length, 5);
  assert.match($('#conservation-badge').textContent, /守恒校验通过/);

  const netText = $('#net-list').textContent;
  assert.match(netText, /T\+20 ~ T\+35/);
  assert.match(netText, /T\+70 ~ T\+100/); // intr-2 与 intr-3 归并
  assert.match(netText, /整体裁掉/); // intr-5 越界说明

  const intrText = $('#interruption-list').textContent;
  assert.match(intrText, /冲突：双方已保留，未纳入推导/);
  assert.match(intrText, /应用监控/);
  assert.match(intrText, /日历同步/);
});

test('补报零长区间被拒绝并展示原因', () => {
  $('#inp-rep-id').value = 'intr-x';
  $('#inp-rep-source').value = '手动记录';
  $('#inp-rep-start').value = '50';
  $('#inp-rep-end').value = '50';
  $('#inp-rep-status').value = 'active';
  $('#btn-add-report').click();
  assert.match($('#event-log').textContent, /拒绝补报.*零长/s);
});

test('补报有效打断：立即重推、扣减并更新恢复位置', () => {
  $('#inp-rep-id').value = 'intr-9';
  $('#inp-rep-source').value = '手动记录';
  $('#inp-rep-start').value = '120';
  $('#inp-rep-end').value = '140';
  $('#inp-rep-status').value = 'active';
  $('#btn-add-report').click();

  const logText = $('#event-log').textContent;
  assert.match(logText, /净打断新增 \[120, 140\)/);
  assert.match(logText, /扣减：阶段「自测验证」重复计入 20 分钟已扣掉/);
  assert.match(logText, /同一时刻不计两次/);

  const banner = $('#resume-banner').textContent;
  assert.match(banner, /继续进入：第 3 阶段「自测验证」/);
  assert.match(banner, /剩余额度 20 分钟/);
  assert.match($('#conservation-badge').textContent, /守恒校验通过/);
});

test('消解冲突：采纳一方后冲突清除并纳入推导', () => {
  const adoptBtns = $$('#interruption-list button').filter((b) => b.textContent === '采纳此来源');
  assert.equal(adoptBtns.length, 2); // intr-4 双方各一个
  adoptBtns[0].click(); // 采纳「应用监控」[150,170) 未消解

  assert.match($('#event-log').textContent, /冲突消解：打断「intr-4」采纳来源「应用监控」/);
  assert.match($('#net-list').textContent, /T\+150 ~ T\+170/);
  assert.doesNotMatch($('#interruption-list').textContent, /冲突：双方已保留/);
  assert.match($('#interruption-list').textContent, /冲突已人工消解/);
  assert.doesNotMatch($('#resume-banner').textContent, /存在冲突/);
});

test('阶段校验：预算非正被拒绝并指出位置', () => {
  const budgetInputs = $$('#stage-edit-table input').filter((i) => i.dataset.field === 'budgetMin');
  budgetInputs[0].value = '0';
  $('#btn-apply-stages').click();
  assert.match($('#event-log').textContent, /拒绝阶段设置：第 1 个阶段.*必须为正数/);
});
