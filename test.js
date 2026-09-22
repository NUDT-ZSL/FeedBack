// 离线逻辑自测：node test.js
const fs = require('fs');
const src = ['data.js', 'engine.js', 'derive.js', 'schedule.js']
  .map(f => fs.readFileSync(f, 'utf8')).join('\n');
eval(src);

let failed = 0;
function ok(cond, msg) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) failed++;
}

// 1. 图谱校验：环与缺失依赖 -> 不可信
const g = validateGraph();
ok(g.cycleNodes.has('KP11') && g.cycleNodes.has('KP12'), '识别出依赖环 KP11<->KP12');
ok(g.missingEdges.some(e => e.from === 'KP13' && e.to === 'KP99'), '识别出缺失依赖 KP13->KP99');
ok(g.untrustworthy.has('KP11') && g.untrustworthy.has('KP12') && g.untrustworthy.has('KP13'),
   '环与缺失依赖涉及的知识点被标为不可信');
ok(!g.untrustworthy.has('KP10'), '可信子图不被误伤');

// 2. 记录整理：去重、按时刻排序、矛盾保留双方
const l1 = learnerRecords('L1');
ok(l1.KP01.length === 1, '完全重复的记录被去重');
ok(l1.KP02[l1.KP02.length - 1].verdict === 'mastered',
   '时刻倒序时按时间戳取最新，而非文件顺序');
const c1 = detectConflicts('L1');
ok(Object.keys(c1).length === 1 && c1.KP03.records.length === 2,
   'KP03 矛盾被识别且双方来源均保留');

// 3. 掌握度传播与解锁
const r2 = deriveState('L2', {});
ok(r2.state.KP02.status === 'inferred' && r2.state.KP03.status === 'inferred',
   '掌握 KP04 沿依赖向前推断 KP02/KP03 已掌握');
ok(r2.state.KP05.status === 'conflict', 'KP05 矛盾不被静默覆盖');
const r3 = deriveState('L3', {});
ok(r3.state.KP04.unlocked === false && r3.state.KP04.missingPrereqs.includes('KP02'),
   '前置未掌握时 KP04 未解锁并给出原因');
const r1 = deriveState('L1', {});
ok(r1.order.indexOf('KP01') < r1.order.indexOf('KP04') &&
   r1.order.indexOf('KP04') < r1.order.indexOf('KP07'),
   '学习顺序满足前置依赖');
ok(!r1.order.includes('KP11') && !r1.order.includes('KP13'), '不可信节点不进入学习路径');

// 4. 增量重推与整体重推一致
const prev = deriveState('L1', {});
const inc = incrementalRecompute('L1', { KP03: 'mastered' }, 'KP03', prev);
ok(inc.consistent, '裁决 KP03 后增量重推与整体重推一致');
ok(inc.affected.has('KP03') && inc.affected.has('KP04') && inc.affected.has('KP10'),
   '受影响集合覆盖后续路径');
ok(inc.result.state.KP04.unlocked === true, '裁决后 KP04 解锁');

// 5. 节奏参数变化 -> 重新排期并可对比前移/后移
const s1 = buildSchedule(inc.result, { dailyMinutes: 60, minDwellDays: 1 });
const s2 = buildSchedule(inc.result, { dailyMinutes: 30, minDwellDays: 2 });
const moved = diffSchedules(s1, s2);
ok(moved.length > 0 && moved.every(m => m.delta > 0), '投入减少后后续知识点整体后移');
ok(s1.KP04.end - s1.KP04.start === Math.max(1, Math.ceil(5 * 60 / 60)),
   '停留天数 = max(最短停留, 学时换算)');

console.log(failed ? ('\n' + failed + ' 项失败') : '\n全部通过');
process.exit(failed ? 1 : 0);
