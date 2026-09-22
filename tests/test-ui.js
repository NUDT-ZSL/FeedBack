/*
 * test-ui.js — 用 jsdom 对界面做冒烟测试
 * 运行: node tests/test-ui.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'file://' + path.join(__dirname, '..', 'index.html'),
  runScripts: 'dangerously',
  resources: 'usable'
});

dom.window.addEventListener('load', function () {
  const doc = dom.window.document;
  try {
    // 初始：5 条批注卡片，状态分布 2 已解决 / 2 待确认 / 1 已失效
    let cards = doc.querySelectorAll('.comment-card');
    assert.strictEqual(cards.length, 5, '批注卡片数');
    assert.strictEqual(doc.querySelectorAll('.comment-card.resolved').length, 2);
    assert.strictEqual(doc.querySelectorAll('.comment-card.pending').length, 2);
    assert.strictEqual(doc.querySelectorAll('.comment-card.invalid').length, 1);

    // 文档中应有 4 个高亮（失效批注无高亮）
    assert.strictEqual(doc.querySelectorAll('#docView mark').length, 4, '高亮数');

    // 待确认批注执行“保留”-> 变为已解决
    const keepBtn = doc.querySelector('.comment-card.pending .keep');
    keepBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(doc.querySelectorAll('.comment-card.pending').length, 1);
    assert.strictEqual(doc.querySelectorAll('.comment-card.resolved').length, 3);

    // 待确认批注执行“删除”-> 从列表移除
    const dropBtn = doc.querySelector('.comment-card.pending .drop');
    dropBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(doc.querySelectorAll('.comment-card').length, 4);
    assert.match(doc.getElementById('trashInfo').textContent, /已删除 1 条/);

    // 拖动滑块到 0：未应用任何编辑，所有批注应回到已解决
    const range = doc.getElementById('stepRange');
    range.value = '0';
    range.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.strictEqual(doc.querySelectorAll('.comment-card.resolved').length, 4, '0 步时应全部 resolved');
    assert.match(doc.getElementById('stepLabel').textContent, /0 \/ 5/);

    // 点击“应用全部编辑”恢复
    doc.getElementById('applyAllBtn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.match(doc.getElementById('stepLabel').textContent, /5 \/ 5/);

    console.log('UI 冒烟测试全部通过');
    process.exit(0);
  } catch (err) {
    console.error('UI 测试失败:', err.message);
    process.exit(1);
  }
});
setTimeout(function () { console.error('UI 测试超时'); process.exit(1); }, 10000);
