const assert = require('assert');
const { Workbench } = require('../js/core');

function fresh(objects, plane) {
  const wb = new Workbench();
  const r = wb.loadGroups({ name: 'S1', objects });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  if (plane) wb.setPlane(plane);
  return wb;
}

function compact(x) {
  if (x instanceof Map) return Object.fromEntries(Array.from(x.entries()).sort().map(([k,v]) => [k, compact(v)]));
  if (Array.isArray(x)) return x.map(compact);
  if (x && typeof x === 'object') {
    const out = {};
    for (const k of Object.keys(x).sort()) {
      if (k === 'stats') continue;
      out[k] = compact(x[k]);
    }
    return out;
  }
  return x;
}

function testRejectsDuplicateAndBadSize() {
  const wb = new Workbench();
  const r = wb.loadGroups({ name: 'S1', objects: [
    { id: 'PIPE-1', size: [2, 0, 1], position: [0,0,0] },
    { id: 'PIPE-1', size: [1,1,1], position: [3,0,0] }
  ]});
  assert.strictEqual(r.ok, false);
  assert(r.errors.some(e => e.code === 'INVALID_SIZE' && e.source === 'S1' && e.index === 1));
  assert(r.errors.some(e => e.code === 'DUPLICATE_ID' && e.objectId === 'PIPE-1' && e.chain.includes('S1')));
}

function testMissingParentChain() {
  const wb = new Workbench();
  const r = wb.loadGroups({ name: 'S1', objects: [{ id: 'A', parentId: 'GHOST', size: [1,1,1] }] });
  assert.strictEqual(r.ok, false);
  const e = r.errors.find(e => e.code === 'MISSING_PARENT');
  assert.deepStrictEqual(e.chain, ['A', 'GHOST', '<不存在>']);
}

function testCycles() {
  const wb = new Workbench();
  const r = wb.loadGroups({ name: 'S1', objects: [
    { id: 'A', parentId: 'C', size: [1,1,1] },
    { id: 'B', parentId: 'A', size: [1,1,1] },
    { id: 'C', parentId: 'B', size: [1,1,1] }
  ]});
  assert.strictEqual(r.ok, false);
  assert(r.errors.some(e => e.code === 'PARENT_CYCLE' && /A → C → B → A/.test(e.message)));
}

function testSectionDeterminismAndGeometry() {
  const objs = [
    { id: 'ROTATED', size: [2,2,2], position: [1,0,0], rotationEuler: [0,0,45] }
  ];
  const a = fresh(objs), b = fresh(objs);
  const sa = a.sections.get('ROTATED'), sb = b.sections.get('ROTATED');
  assert(sa && sb);
  assert.strictEqual(sa.polygon.length, 4);
  assert(Math.abs(sa.area - 4*(Math.SQRT2-1)) < 1e-8);
  assert.deepStrictEqual(sa.polygon, sb.polygon);
  const jsonA = JSON.stringify(a.snapshot().sections);
  const jsonB = JSON.stringify(b.snapshot().sections);
  assert.strictEqual(jsonA, jsonB);
}

function testMeasurementBlockedAndPlaneCrossing() {
  const wb = fresh([
    { id: 'A', size: [2,2,2], position: [0,0,0] },
    { id: 'WALL', size: [1,1,5], position: [5,0,0] },
    { id: 'B', size: [2,2,2], position: [8,0,0], rotationEuler: [0,0,30] }
  ]);
  const r = wb.addMeasurement({ id: 'M1', type: 'object-object', objectA: 'A', objectB: 'B' });
  assert.strictEqual(r.ok, true);
  assert(Math.abs(r.result.distance - (6.5 - Math.sqrt(3)/2)) < 1e-7);
  assert.strictEqual(r.result.blocked, true);
  assert.strictEqual(r.result.blockers[0].objectId, 'WALL');
  assert.strictEqual(r.result.crossesPlane, true);
  assert(/跨越当前剖切面/.test(r.result.conflict));
}

function testVisibleMeasurement() {
  const wb = fresh([
    { id: 'A', size: [1,1,1], position: [0,0,0] },
    { id: 'B', size: [1,1,1], position: [3,0,0] }
  ], { normal: [0,1,0], offset: 10 });
  const r = wb.addMeasurement({ id: 'M1', type: 'object-object', objectA: 'A', objectB: 'B' });
  assert.strictEqual(r.result.status, 'visible');
  assert.strictEqual(r.result.distance, 2);
  assert.strictEqual(r.result.blocked, false);
  assert.strictEqual(r.result.crossesPlane, false);
}

function testConflictsKeepBoth() {
  const wb = new Workbench();
  const r = wb.loadGroups([
    { name: 'CAD', objects: [{ id: 'PUMP', size: [1,1,1], position: [0,0,0] }] },
    { name: 'SCAN', objects: [{ id: 'PUMP', size: [2,1,1], position: [0.2,0,0] }] }
  ]);
  assert.strictEqual(r.ok, true);
  const c = wb.conflicts.get('PUMP');
  assert(c);
  assert.strictEqual(c.pairs.length, 1);
  assert.strictEqual(c.pairs[0].a.source, 'CAD');
  assert.strictEqual(c.pairs[0].b.source, 'SCAN');
  assert.deepStrictEqual(wb.activeRecord('PUMP').size, [1,1,1]);
  wb.setPlane({normal:[1,0,0],offset:0});
  assert.strictEqual(wb.sections.get('PUMP').conflicting, true);
  const switched = wb.setAccepted('PUMP', 'SCAN', 0);
  assert(switched.affectedObjects.includes('PUMP'));
  assert.deepStrictEqual(wb.activeRecord('PUMP').size, [2,1,1]);
}
function testParentCascadeAndInvalidRollback() {
  const wb = fresh([
    { id: 'A', size: [1,1,1], position: [0,0,0] },
    { id: 'B', parentId: 'A', size: [1,1,1], position: [1,0,0] }
  ]);
  const bad = wb.updateObject('B', { parentId: 'GHOST' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(wb.activeRecord('B').parentId, 'A');
  const ok = wb.updateObject('A', { position: [0,2,0] });
  assert.strictEqual(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepStrictEqual(wb.obbs.get('B').center, [1,2,0]);
  const copy = new Workbench();
  const imported = copy.importProject(wb.exportProject());
  assert.strictEqual(imported.ok, true);
  assert.deepStrictEqual(copy.obbs.get('B').center, [1,2,0]);
}


function testIncrementalMatchesFull() {
  const groups = [
    { name: 'S1', objects: [
      { id: 'ROOT', size: [4,4,0.2], position: [0,0,0] },
      { id: 'ARM', parentId: 'ROOT', size: [1,1,2], position: [1.5,0,1.1], rotationEuler: [0,30,0] },
      { id: 'TIP', parentId: 'ARM', size: [0.5,0.5,0.5], position: [0,0,1.25] }
    ]}
  ];
  const wb = new Workbench();
  wb.loadGroups(groups);
  wb.addMeasurement({ id: 'D1', label: 'D1', objectA: null, objectB: null, type: 'point-point', pointA: [-2,0,0.2], pointB: [3,0,2.5] });
  wb.addMeasurement({ id: 'D2', label: 'D2', objectA: null, objectB: null, type: 'point-point', pointA: [-2,3,0.2], pointB: [3,3,2.5] });
  const move = wb.setPlane({ normal: [0,0,1], offset: 1.4 });
  assert.strictEqual(move.ok, true);
  const edit = wb.updateObject('ARM', { rotationEuler: [0,45,0] });
  assert.strictEqual(edit.ok, true, JSON.stringify(edit.errors));
  const inc = compact(wb.snapshot());
  const full = compact(Workbench.deriveFull(wb.groups, wb.plane, {
    D1: { id: 'D1', label: 'D1', objectA: null, objectB: null, type: 'point-point', pointA: [-2,0,0.2], pointB: [3,0,2.5] },
    D2: { id: 'D2', label: 'D2', objectA: null, objectB: null, type: 'point-point', pointA: [-2,3,0.2], pointB: [3,3,2.5] }
  }, wb.accepted));
  assert.deepStrictEqual(inc.sections, full.sections);
  assert.deepStrictEqual(inc.measurements, full.measurements);
  assert.strictEqual(wb.stats.sectionsRecomputed < inc.sections.length || wb.stats.measurementsRecomputed < 2, true);
}
const tests = [testRejectsDuplicateAndBadSize,testMissingParentChain,testCycles,testSectionDeterminismAndGeometry,testMeasurementBlockedAndPlaneCrossing,testVisibleMeasurement,testConflictsKeepBoth,testParentCascadeAndInvalidRollback,testIncrementalMatchesFull];
let pass = 0;
for (const t of tests) { t(); console.log('PASS', t.name); pass++; }
console.log(`\n${pass}/${tests.length} tests passed`);
