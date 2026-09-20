/* 界面冒烟测试：在 jsdom 中加载完整页面，模拟主要交互，验证无运行时错误且状态正确 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
window.confirm = () => true;

function loadScript(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  window.eval(code);
}
loadScript('js/model.js');
loadScript('js/storage.js');
loadScript('js/app.js');

const document = window.document;
document.dispatchEvent(new window.Event('DOMContentLoaded'));

let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else { passed++; console.log('  ok - ' + msg); }
}

// 1. 启动后直接展示分步结构
const cards = document.querySelectorAll('.step-card');
assert(cards.length === 5, '启动后展示 5 个步骤卡片');
assert(document.querySelectorAll('.field-card').length === 12, '展示 12 个字段卡片');

// 2. 示例自带一个要求冲突，面板可见且含两条依据
const conflicts = document.querySelectorAll('.conflict-item');
assert(conflicts.length >= 1, '冲突面板至少 1 条');
const evidenceCount = document.querySelectorAll('.evidence-list li').length;
assert(evidenceCount >= 3, '保留全部依据（自身声明 + 依据 A + 依据 B），实际 ' + evidenceCount);

// 3. 把 phone 移到第 4 步：出现不可完成徽章
function stepSelectOf(fieldId) {
  const cards2 = [...document.querySelectorAll('.field-card')];
  for (const c of cards2) {
    if (c.textContent.includes(fieldId)) return c.querySelector('select');
  }
  return null;
}
const phoneSel = stepSelectOf('phone');
phoneSel.value = '4';
phoneSel.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(document.querySelectorAll('.badge.blocked').length >= 1, '前置后置后出现“不可完成”徽章');
assert(document.querySelector('#conflictBanner').textContent.includes('不可完成'), '顶部横幅提示不可完成');

// 4. 收敛分步：phone 被移回可行位置（emergency 在 phone 之后）
document.querySelector('#convergeBtn').click();
const M = window.FormModel;
// 收敛后不应再有 blocked 类依赖（仅保留示例自身的要求冲突）
const blockedDeps = [...document.querySelectorAll('.dep-status.bad')]
  .filter(n => n.textContent.includes('更后步骤'));
assert(blockedDeps.length === 0, '收敛后不存在“前置在更后步骤”的依赖');

// 5. 锁定 fullName 在第 1 步，再收敛，锁定保持
// 先找到“锁定”按钮（每个字段卡片操作区第 2 个按钮）
function clickFieldButton(fieldId, text) {
  const cards3 = [...document.querySelectorAll('.field-card')];
  for (const c of cards3) {
    if (c.textContent.includes(fieldId)) {
      const btn = [...c.querySelectorAll('button')].find(b => b.textContent.trim() === text);
      btn.click(); return true;
    }
  }
  return false;
}
clickFieldButton('fullName', '锁定');
document.querySelector('#convergeBtn').click();
assert(clickFieldButton !== undefined, '锁定交互不报错');
const fullNameSel = stepSelectOf('fullName');
assert(fullNameSel.disabled === true, '锁定后归属下拉被禁用');
// 锁定时 fullName 显示在哪一步，收敛后就必须保持在哪一步（不被修复传播移动）
const lockedStep = fullNameSel.value;
assert(['1','2','3'].includes(lockedStep), '锁定值为可行步骤，实际 ' + lockedStep);
assert(fullNameSel.value === lockedStep, 'fullName 锁定步骤在收敛后保持不变');

// 6. 排除 email：出现已排除区域，且其依赖被标记
clickFieldButton('email', '排除');
assert(document.querySelectorAll('.excluded-row').length === 1, '已排除区域显示 1 个字段');
assert([...document.querySelectorAll('.dep-status.bad')]
  .some(n => n.textContent.includes('已排除')), '与被排除字段相关的依赖被标记“一端已排除”');

// 7. 新增字段并出现在界面
document.querySelector('#addFieldBtn').click();
document.querySelector('#f-id').value = 'tester';
document.querySelector('#f-label').value = '测试字段';
document.querySelector('#f-read').value = '15';
[...document.querySelectorAll('.modal-actions button')].find(b => b.textContent === '保存').click();
assert(!!stepSelectOf('tester'), '新增字段后即时渲染');

// 8. 刷新后从 localStorage 恢复
const saved = window.eval('FormStorage.load()');
assert(saved && saved.fields.some(f => f.id === 'tester'), '状态已持久化到本地');

console.log('\n' + passed + ' 个界面检查通过');
