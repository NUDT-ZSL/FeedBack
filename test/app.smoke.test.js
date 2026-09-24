/* 端到端冒烟测试：在 jsdom 中加载真实页面与脚本，模拟用户操作 */
'use strict';
var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');
var dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
var win = dom.window;

// localStorage 由 jsdom 提供；注入引擎与应用脚本
win.eval(fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'));

var failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  PASS ' + msg);
  else { failures++; console.error('  FAIL ' + msg); }
}
var doc = win.document;

console.log('[A] 初始渲染');
ok(doc.querySelectorAll('#device-list .card').length === 4, '渲染 4 个设备预设');
ok(doc.querySelectorAll('#rule-list .card').length === 4, '渲染 4 条规则');
ok(doc.querySelectorAll('#preview-list .device-preview').length === 4, '渲染 4 个设备预览');
ok(doc.querySelectorAll('#preview-list [data-adj]').length > 0, '并列冲突渲染出人工裁决按钮');
ok(doc.querySelectorAll('#gap-panel .gap-item').length >= 1, '缺口面板有内容（并列重叠告警）');

console.log('[B] 人工裁决');
var adjBtn = doc.querySelector('#preview-list [data-adj]');
var before = doc.querySelectorAll('#preview-list [data-adj]').length;
adjBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
ok(doc.querySelectorAll('#preview-list [data-adj]').length < before, '裁决后未裁决冲突减少');
ok(doc.querySelector('#preview-list .src-adj') !== null, '预览中显示"人工裁决"来源');
ok(doc.querySelector('#preview-list [data-revoke]') !== null, '出现撤销裁决按钮');

console.log('[C] 修改规则 -> 增量更新');
doc.querySelector('#rule-list .card [data-act="edit"]').dispatchEvent(new win.Event('click', { bubbles: true }));
doc.getElementById('rule-priority').value = '9';
doc.getElementById('rule-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
ok(doc.getElementById('consistency-badge').textContent.indexOf('未校验') >= 0, '修改后徽章回到未校验态');
doc.getElementById('btn-verify').dispatchEvent(new win.Event('click', { bubbles: true }));
ok(doc.getElementById('consistency-badge').className.indexOf('ok') >= 0, '全量重推校验通过（增量==全量）');

console.log('[D] 新增设备 -> 只重算该设备');
doc.getElementById('dev-name').value = '超大屏';
doc.getElementById('dev-width').value = '2560';
doc.getElementById('dev-dpr').value = '1';
doc.getElementById('device-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
ok(doc.querySelectorAll('#device-list .card').length === 5, '设备列表新增成功');
doc.getElementById('btn-verify').dispatchEvent(new win.Event('click', { bubbles: true }));
ok(doc.getElementById('consistency-badge').className.indexOf('ok') >= 0, '新增设备后增量与全量一致');

console.log('[E] 缺口标出：删除全局规则后出现无命中设备');
var delBtns = doc.querySelectorAll('#rule-list .card [data-act="del"]');
win.confirm = function () { return true; };
delBtns[0].dispatchEvent(new win.Event('click', { bubbles: true }));
ok(doc.querySelectorAll('#gap-panel .gap-item.err').length > 0, '出现宽度缺口告警');
ok(doc.querySelector('#preview-list .unresolved') !== null, '无命中设备在预览中标出而非默认值');
doc.getElementById('btn-verify').dispatchEvent(new win.Event('click', { bubbles: true }));
ok(doc.getElementById('consistency-badge').className.indexOf('ok') >= 0, '删除规则后增量与全量一致');

console.log(failures === 0 ? 'SMOKE TEST PASSED' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
