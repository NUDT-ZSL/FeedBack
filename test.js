/* 引擎自动化验证：node test.js */
'use strict';
const E = require('./engine.js');

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); }
  else { failures++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

// 1. 往返转换精度
const lat0 = 39.9042, lng0 = 116.4074;
const g = E.CONVERTERS['WGS84>GCJ02'](lat0, lng0);
const w = E.CONVERTERS['GCJ02>WGS84'](g.lat, g.lng);
check('WGS84->GCJ02->WGS84 往返 < 1e-8 度', near(w.lat, lat0, 1e-8) && near(w.lng, lng0, 1e-8), JSON.stringify(w));
const b = E.CONVERTERS['GCJ02>BD09'](g.lat, g.lng);
const g2 = E.CONVERTERS['BD09>GCJ02'](b.lat, b.lng);
check('GCJ02->BD09->GCJ02 往返 < 1e-6 度', near(g2.lat, g.lat, 1e-6) && near(g2.lng, g.lng, 1e-6));
const m = E.CONVERTERS['WGS84>WEBMERC'](lat0, lng0);
const w2 = E.CONVERTERS['WEBMERC>WGS84'](m.lat, m.lng);
check('WGS84->WEBMERC->WGS84 往返 < 1e-9 度', near(w2.lat, lat0, 1e-9) && near(w2.lng, lng0, 1e-9));

// 2. 精度沿链传播（RSS 合成）
const chain = {
  id: 'c1', name: '测试链',
  datumCorrections: { 'CGCS2000': { dEast: 1.0, dNorth: -2.0, loss: 0.5 } },
  steps: [
    { id: 's1', name: 'WGS84转GCJ02', src: 'WGS84', dst: 'GCJ02', loss: 0.3 },
    { id: 's2', name: 'GCJ02转BD09', src: 'GCJ02', dst: 'BD09', loss: 0.4 }
  ]
};
const p1 = { id: 'p1', name: 'A', rep: 'WGS84', datum: 'CGCS2000', lat: lat0, lng: lng0, accuracy: 1.0, chainId: 'c1' };
const t1 = E.computeTrace(p1, chain);
check('轨迹状态 ok 且含基准校正+2步', t1.status === 'ok' && t1.steps.length === 3);
const expectAcc = Math.sqrt(1.0 * 1.0 + 0.5 * 0.5 + 0.3 * 0.3 + 0.4 * 0.4);
check('最终精度按 RSS 累积', near(t1.final.accuracy, expectAcc, 1e-12), t1.final.accuracy + ' vs ' + expectAcc);
check('最终表示为 BD09', t1.final.rep === 'BD09');
check('基准校正已改变坐标', !near(t1.steps[0].input.lat, t1.steps[0].output.lat, 1e-12));

// 3. 断链检测：表示不匹配
const pBad = { id: 'p2', name: 'B', rep: 'GCJ02', datum: 'GCJ02', lat: lat0, lng: lng0, accuracy: 1.0, chainId: 'c1' };
const tBad = E.computeTrace(pBad, chain);
check('表示不匹配被拒绝且无最终坐标', tBad.status === 'broken' && tBad.final === null && tBad.breakIndex === 0);
check('断点原因含期望/实际表示', tBad.breakReason.indexOf('WGS84') >= 0 && tBad.breakReason.indexOf('GCJ02') >= 0);

// 4. 断链检测：缺少转换实现
const chainMissing = { id: 'c2', name: '缺实现链', steps: [{ id: 's9', name: 'BD09直转WGS84', src: 'BD09', dst: 'WGS84', loss: 0.1 }] };
const p3 = { id: 'p3', name: 'C', rep: 'BD09', datum: 'BD09', lat: lat0, lng: lng0, accuracy: 1.0, chainId: 'c2' };
const tMiss = E.computeTrace(p3, chainMissing);
check('缺少转换实现被拒绝', tMiss.status === 'broken' && tMiss.final === null && tMiss.breakReason.indexOf('缺少转换实现') >= 0);
const issues = E.validateChain(chainMissing);
check('链自检报告缺实现', issues.length === 1 && issues[0].indexOf('缺少转换实现') >= 0);

// 5. 增量重推与全量一致；影响面正确
const points = [
  p1,
  { id: 'p4', name: 'D', rep: 'WGS84', datum: 'WGS84', lat: 31.23, lng: 121.47, accuracy: 2.0, chainId: 'c1' },
  { id: 'p5', name: 'E', rep: 'WGS84', datum: 'CGCS2000', lat: 23.13, lng: 113.26, accuracy: 0.5, chainId: 'c1' },
  { id: 'p6', name: 'F', rep: 'BD09', datum: 'BD09', lat: 30.0, lng: 120.0, accuracy: 1.0, chainId: 'c2' }
];
const chains = [chain, chainMissing];
let v = E.verifyConsistent(points, chains, { type: 'step', chainId: 'c1' });
check('步骤修改：增量==全量', v.ok);
check('步骤修改：只影响该链上的点', v.affectedIds.sort().join(',') === 'p1,p4,p5', v.affectedIds.join(','));
v = E.verifyConsistent(points, chains, { type: 'datum', chainId: 'c1', datum: 'CGCS2000' });
check('基准参数修改：增量==全量', v.ok);
check('基准参数修改：只影响该基准的点', v.affectedIds.sort().join(',') === 'p1,p5', v.affectedIds.join(','));
v = E.verifyConsistent(points, chains, { type: 'point', pointId: 'p6' });
check('单点修改：增量==全量', v.ok && v.affectedIds.join(',') === 'p6');

// 6. 修改步骤损失后结果确实变化且与全量一致
chain.steps[1].loss = 2.0;
const t1b = E.computeTrace(p1, chain);
check('步骤损失修改后精度变大', t1b.final.accuracy > t1.final.accuracy);
v = E.verifyConsistent(points, chains, { type: 'step', chainId: 'c1' });
check('修改后再校验：增量==全量', v.ok);

console.log(failures === 0 ? '\n全部通过' : '\n失败 ' + failures + ' 项');
process.exit(failures === 0 ? 0 : 1);
