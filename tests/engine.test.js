const assert = require('node:assert/strict');
const E = require('../static/engine.js');

const SQ = [[0, 0], [0, 1], [1, 1], [1, 0]]; // 单位方块围栏
const T0 = Date.parse('2026-09-22T08:00:00Z');
const pt = (sec, lat, lng) => ({ time: new Date(T0 + sec * 1000).toISOString(), lat, lng });

function mkFence(rules, extra) {
  return Object.assign({ id: 'F1', name: '测试围栏', polygon: SQ, priority: 1, rules }, extra);
}

// 1. 点包含
assert.equal(E.pointInPolygon(0.5, 0.5, SQ), true);
assert.equal(E.pointInPolygon(1.5, 0.5, SQ), false);

// 2. 无效点跳过且不中断
{
  const r = E.simulate([mkFence({})], [
    pt(0, 0.5, 0.5),
    { lat: 0.5, lng: 0.5 },              // 缺时间戳
    { time: 'not-a-time', lat: 0, lng: 0 },
    pt(10, 0.5, 0.5),
    { time: new Date(T0 + 20000).toISOString(), lat: 95, lng: 0 }, // 非法纬度
    pt(30, 2, 2)
  ]);
  assert.equal(r.skipped.length, 3);
  assert.equal(r.points.length, 3);
  assert.ok(r.events.some(e => e.type === 'enter'));
}

// 3. 边界抖动过滤：短暂进出不触发
{
  const r = E.simulate([mkFence({ minDwellSec: 5, minExitSec: 5 })], [
    pt(0, 2, 2), pt(1, 0.5, 0.5), pt(2, 2, 2), pt(3, 0.5, 0.5), pt(4, 2, 2)
  ]);
  assert.equal(r.events.length, 0);
}

// 4. 稳定进入 + 停留超时 + 离开
{
  const r = E.simulate([mkFence({ minDwellSec: 5, minExitSec: 5,
    dwell: { enabled: true, timeoutSec: 20 } })], [
    pt(0, 2, 2), pt(10, 0.5, 0.5), pt(16, 0.5, 0.5),   // 10s 进入，16s 确认
    pt(35, 0.5, 0.5),                                   // 停留 25s >= 20s
    pt(40, 2, 2), pt(46, 2, 2)                          // 离开确认
  ]);
  const types = r.events.map(e => e.type);
  assert.deepEqual(types, ['enter', 'dwell', 'exit']);
}

// 5. 超速事件与合并
{
  const r = E.simulate([mkFence({ minDwellSec: 0, minExitSec: 0,
    overspeed: { enabled: true, maxSpeedKmh: 30 } })], [
    pt(0, 0.1, 0.1), pt(10, 0.1, 0.1),
    pt(20, 0.1, 0.105),  // ~55 km/h
    pt(30, 0.1, 0.110),  // ~55 km/h，应合并为一条
    pt(40, 0.1, 0.1101), // 低速，结束超速段
    pt(50, 2, 2)
  ]);
  const os = r.events.filter(e => e.type === 'overspeed');
  assert.equal(os.length, 1);
  assert.ok(os[0].reason.includes('km/h'));
}

// 6. 重叠围栏冲突消解：高优先级胜出，其余被压制
{
  const f1 = mkFence({ minDwellSec: 0 }, { id: 'A', name: 'A区', priority: 1 });
  const f2 = mkFence({ minDwellSec: 0 }, { id: 'B', name: 'B区', priority: 2 });
  const r = E.simulate([f1, f2], [pt(0, 0.5, 0.5), pt(10, 0.5, 0.5)]);
  const enters = r.events.filter(e => e.type === 'enter');
  assert.equal(enters.length, 1);
  assert.equal(enters[0].fenceId, 'A');
  assert.equal(enters[0].suppressed.length, 1);
  assert.equal(enters[0].suppressed[0].fenceId, 'B');
  assert.ok(enters[0].suppressed[0].suppressedReason.includes('压制'));
}

// 7. 轨迹乱序导入后按时间排序判定
{
  const r = E.simulate([mkFence({ minDwellSec: 0, minExitSec: 0 })], [
    pt(20, 2, 2), pt(0, 0.5, 0.5), pt(10, 0.5, 0.5)
  ]);
  assert.deepEqual(r.events.map(e => e.type), ['enter', 'exit']);
}

// 8. 级联压制：进入被压制后，对应离开一并压制
{
  const f1 = mkFence({ minDwellSec: 0, minExitSec: 0 }, { id: 'A', name: 'A区', priority: 1 });
  const f2 = mkFence({ minDwellSec: 0, minExitSec: 0 },
    { id: 'B', name: 'B区', priority: 2,
      polygon: [[-1, -1], [-1, 3], [3, 3], [3, -1]] }); // 完全包含 A
  const r = E.simulate([f1, f2], [
    pt(0, 0.5, 0.5), pt(10, 0.5, 0.5),
    pt(20, 1.5, 1.5),  // 离开 A，仍在 B 内
    pt(30, 5, 5)       // 离开 B
  ]);
  assert.deepEqual(r.events.map(e => e.fenceId + ':' + e.type),
    ['A:enter', 'A:exit']);
  assert.equal(r.suppressedCascade.length, 1);
  assert.equal(r.suppressedCascade[0].type, 'exit');
  assert.equal(r.suppressedCascade[0].fenceId, 'B');
  assert.ok(r.suppressedCascade[0].cascadeReason.includes('压制'));
}

console.log('engine tests: all passed');
