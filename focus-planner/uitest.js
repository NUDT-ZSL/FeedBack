'use strict';
/* UI 冒烟测试：在 jsdom 中加载真实页面，模拟键盘操作 */
var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
var window = dom.window, document = window.document;
window.HTMLElement.prototype.scrollIntoView = function () {};
window.eval(fs.readFileSync(path.join(__dirname, 'core.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'));

var failures = 0;
function ok(cond, name) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name); }
}
function key(k, opts) {
  opts = opts || {}; opts.key = k; opts.bubbles = true; opts.cancelable = true;
  document.dispatchEvent(new window.KeyboardEvent('keydown', opts));
}
function rows(sel) { return document.querySelectorAll(sel); }
function status() { return document.querySelector('#statusbar').textContent; }

// 1. 启动即进入可操作界面：示例自动加载，列表/层级/约束均已渲染
ok(rows('#list-rows li').length === 11, '启动后列表渲染 11 个元素（9 在路径 + 2 不可达）');
ok(rows('#cons-rows li').length === 4, '约束面板渲染 4 条约束');
ok(document.querySelectorAll('#tree-rows .tree-el').length === 11, '层级视图渲染 11 个元素');
ok(!document.querySelector('#banner').classList.contains('show'), '示例必需元素全部可达，无断裂告警');
ok(/j2[\s\S]*已覆盖/.test(document.querySelector('#cons-rows').textContent), '同源冲突约束 j2 标记为已覆盖');
ok(/k2[\s\S]*已覆盖/.test(document.querySelector('#cons-rows').textContent), '循环约束 k2 标记为已覆盖');

// 2. 面板切换与选择移动
key('3');
ok(document.querySelector('#panel-cons').classList.contains('active'), '按 3 切换到约束面板');
key('ArrowDown');
ok(/约束 j2/.test(status()), '方向键在约束间移动并朗读状态');
key('1');
key('ArrowDown');
ok(/路径第 2 位/.test(status()), '列表中移动选择并报告路径位置');

// 3. 调整优先级：j1 降到 2 后应被 j2(3) 覆盖
key('3'); // 约束面板，选中回到 j1（首个）
key('ArrowUp'); // 确保在 j1
for (var i = 0; i < 8; i++) key('ArrowDown', { ctrlKey: true }); // 10 -> 2
ok(/j1[\s\S]*已覆盖/.test(document.querySelector('#cons-rows').textContent), '调低优先级后 j1 被 j2 覆盖');
ok(/优先级调整/.test(status()), '优先级调整给出即时反馈');

// 4. 删除约束：删掉 j2 后 j1 应恢复生效
key('ArrowDown'); // 移到 j2
key('Delete');
ok(rows('#cons-rows li').length === 3, '删除后约束数减一');
ok(/j1[\s\S]*生效/.test(document.querySelector('#cons-rows').textContent), 'j2 删除后 j1 恢复生效');

// 5. 键盘新增约束：name -> submit（跳过全部必需元素，应触发断裂提示）
key('i');
ok(!document.querySelector('#insert-form').hidden, '按 i 打开新增表单');
document.querySelector('#ins-from').value = 'name';
document.querySelector('#ins-to').value = 'submit';
document.querySelector('#ins-pri').value = '99';
document.querySelector('#ins-ok').click();
ok(rows('#cons-rows li').length === 4, '新增后约束数加一');
ok(document.querySelector('#banner').classList.contains('show'), '跳过必需元素后出现断裂告警');
ok(/断裂段/.test(document.querySelector('#banner').textContent), '告警指出断裂段与原因约束');

// 6. 走查模式：停在断裂处并给出可读原因
key('w');
key('n');
key('n'); // name -> submit 后路径结束
ok(/走查停在/.test(status()) && /从未进入路径/.test(status()), '走查停在断裂处并说明原因');
key('r');
ok(/走查已重置/.test(status()), '走查可重置');
key('Escape');

// 7. 删除问题约束后恢复可达，告警消失
key('3');
// 选到最后一条（新增的 j5）
key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
key('Delete');
ok(!document.querySelector('#banner').classList.contains('show'), '删除问题约束后断裂告警消失');
ok(/全部必需元素均可达/.test(status()), '修改后反馈确认可达性恢复');

// 8. 修改后焦点未丢失（仍在某个面板内）
var ae = document.activeElement;
ok(ae && ae.closest && ae.closest('section.panel'), '连续修改后键盘焦点保留在面板内');

// 9. 完整走查到达终点
key('w');
for (var j = 0; j < 12; j++) key('n');
ok(/走查完成/.test(status()), '修复后走查顺利到达终点');

console.log(failures === 0 ? '\nUI 冒烟测试全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);
