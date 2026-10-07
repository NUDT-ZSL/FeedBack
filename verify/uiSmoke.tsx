import React from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App';

const html = renderToString(React.createElement(App));
const checks: Array<[string, boolean]> = [
  ['三炉标签（甲/乙/丙）', html.includes('甲炉') && html.includes('乙炉') && html.includes('丙炉')],
  ['撤回上一手按钮', html.includes('撤回上一手')],
  ['丹盘面板', html.includes('丹盘')],
  ['葫芦架（三葫芦）', html.includes('紫金葫芦') && html.includes('翡翠葫芦') && html.includes('黑玉葫芦')],
  ['丹录面板', html.includes('丹录')],
  ['药柜', html.includes('药柜')],
  ['炉温读数', html.includes('炉温')],
  ['选中炉状态卡', html.includes('空炉待料')]
];
let failed = 0;
console.log('\n五、界面冒烟（服务端渲染整树）');
for (const [name, pass] of checks) {
  console.log(`  ${pass ? '✅' : '❌'} ${name}`);
  if (!pass) failed++;
}
if (failed > 0) {
  console.error(`\n界面冒烟：${failed} 项失败`);
  process.exit(1);
}
console.log('  界面冒烟全部通过');
