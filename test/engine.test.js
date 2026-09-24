/* 引擎测试：node test/engine.test.js */
'use strict';
var E = require('../js/engine.js');

var failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); }
  else { failures++; console.error('  FAIL ' + msg); }
}

function rule(id, min, max, pri, props) {
  return { id: id, name: id, minWidth: min, maxWidth: max, priority: pri, props: props };
}
function dev(id, w) { return { id: id, name: id, width: w, dpr: 1, orientation: 'landscape' }; }

console.log('[1] 优先级裁决');
var rules = [rule('A', 0, 1200, 1, { columns: 2 }), rule('B', 0, 800, 5, { columns: 4 })];
var r = E.computeDevice(dev('d1', 600), rules, {});
ok(r.props.columns.value === 4 && r.props.columns.source.ruleId === 'B', '高优先级规则胜出');
ok(r.props.columns.suppressed.length === 1 && r.props.columns.suppressed[0].ruleId === 'A', '被压制候选保留');
ok(r.props.columns.suppressed[0].reason.indexOf('优先级') === 0, '压制依据含优先级说明');

console.log('[2] 同优先级按区间收窄裁决');
rules = [rule('A', 0, 1200, 3, { gutter: 24 }), rule('B', 320, 768, 3, { gutter: 16 })];
r = E.computeDevice(dev('d1', 600), rules, {});
ok(r.props.gutter.value === 16 && r.props.gutter.source.ruleId === 'B', '区间更窄者胜出');
ok(r.props.gutter.suppressed[0].reason.indexOf('收窄') > 0, '压制依据含收窄说明');
r = E.computeDevice(dev('d2', 1000), rules, {});
ok(r.props.gutter.value === 24 && r.props.gutter.source.ruleId === 'A', '宽区间外只命中 A');

console.log('[3] 完全并列 -> 不静默择一，人工裁决后生效');
rules = [rule('A', 0, 768, 2, { font: 14 }), rule('B', 0, 768, 2, { font: 16 })];
r = E.computeDevice(dev('d1', 500), rules, {});
ok(r.props.font.status === 'unresolved' && r.props.font.value === null, '并列冲突标记为未裁决');
var sig = r.props.font.signature;
var adj = {}; adj[sig] = 'B';
r = E.computeDevice(dev('d1', 500), rules, adj);
ok(r.props.font.value === 16 && r.props.font.source.type === 'adjudication', '人工裁决生效并记录来源');

console.log('[4] 缺口检测');
rules = [rule('A', 0, 480, 1, { columns: 1 }), rule('B', 768, 1024, 1, { columns: 3 })];
var devices = [dev('phone', 375), dev('gapdev', 600), dev('pc', 1440)];
var gaps = E.detectGaps(rules, devices);
ok(gaps.uncoveredSegments.some(function (s) { return s.from === 481 && s.to === 767; }), '检出未覆盖段 481-767');
ok(gaps.uncoveredSegments.some(function (s) { return s.from === 1025 && s.to === 1440; }), '检出尾部未覆盖段');
ok(gaps.uncoveredDevices.indexOf('gapdev') >= 0 && gaps.uncoveredDevices.indexOf('pc') >= 0, '检出无规则命中的设备');
ok(gaps.uncoveredDevices.indexOf('phone') < 0, '已覆盖设备不误报');

console.log('[5] 同优先级区间重叠告警');
rules = [rule('A', 0, 800, 2, { columns: 2 }), rule('B', 600, 1200, 2, { columns: 4, rows: 2 })];
gaps = E.detectGaps(rules, []);
ok(gaps.equalPriorityOverlaps.length === 1 && gaps.equalPriorityOverlaps[0].from === 600 &&
   gaps.equalPriorityOverlaps[0].to === 800 && gaps.equalPriorityOverlaps[0].sharedProps.join() === 'columns',
   '检出同优先级重叠及共享属性');

console.log('[6] 增量更新与全量重推一致（随机变更 500 轮）');
var seed = 42;
function rand(n) { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; }
var propPool = ['columns', 'gutter', 'font', 'rows'];
for (var iter = 0; iter < 500; iter++) {
  var rs = [], ds = [];
  for (var i = 0; i < 6; i++) {
    var mn = rand(1000), mx = mn + rand(800);
    var pr = {};
    for (var p = 0; p < propPool.length; p++) if (rand(2)) pr[propPool[p]] = rand(50);
    rs.push(rule('R' + i, mn, mx, rand(4), pr));
  }
  for (var j = 0; j < 8; j++) ds.push(dev('D' + j, rand(1800)));
  var full = E.computeAll(ds, rs, {});
  var inc = E.applyIncremental({}, ds, rs, {}, ds.map(function (d) { return d.id; }));
  // 随机改一条规则，走增量路径
  var idx = rand(rs.length), oldR = rs[idx];
  var newR = rule(oldR.id, rand(1000), 0, rand(4), {});
  newR.maxWidth = newR.minWidth + rand(800);
  newR.props[propPool[rand(propPool.length)]] = rand(50);
  var rs2 = rs.slice(); rs2[idx] = newR;
  var affected = E.affectedByRuleChange(oldR, newR, ds);
  var incAfter = E.applyIncremental(inc, ds, rs2, {}, affected);
  var fullAfter = E.computeAll(ds, rs2, {});
  if (!E.deepEqual(incAfter, fullAfter)) {
    failures++;
    console.error('  FAIL 第 ' + iter + ' 轮增量与全量不一致');
    console.error('  affected=' + JSON.stringify(affected));
    break;
  }
}
ok(failures === 0, '全部随机轮次增量结果 == 全量重推');

console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
