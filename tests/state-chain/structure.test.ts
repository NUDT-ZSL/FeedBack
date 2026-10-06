import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LanternEngine } from '../../src/state/engine.ts';
import { inferStructure } from '../../src/state/derive.ts';

describe('竹条连接结构推演（可追溯结论，不静默跳过）', () => {
  it('三种模板自身结构推演均 valid，无异常结论', () => {
    for (const type of ['palace', 'revolving', 'silk'] as const) {
      const report = inferStructure(new LanternEngine(type).getState());
      assert.equal(report.valid, true, `${type}: ${JSON.stringify(report.findings)}`);
      assert.equal(report.findings.length, 0);
      assert.equal(report.okStripCount, report.totalStripCount);
    }
  });

  it('竹条指向缺失节点时给出 MISSING_NODE 结论，且其余竹条照常推演', () => {
    const engine = new LanternEngine('silk');
    const before = engine.getState().bambooStrips.length;
    engine.dispatch({ type: 'strip/connect', startNodeId: 't0', endNodeId: 'ghost-node' });
    assert.equal(engine.getState().bambooStrips.length, before + 1);

    const report = inferStructure(engine.getState());
    assert.equal(report.valid, false);
    const missing = report.findings.filter((f) => f.code === 'MISSING_NODE');
    assert.equal(missing.length, 1);
    assert.deepEqual(missing[0].nodeIds, ['ghost-node']);
    assert.deepEqual(missing[0].stripIds, [`user-strip-${before}`]);
    assert.match(missing[0].message, /ghost-node/);

    const dangling = report.strips.find((s) => s.id === `user-strip-${before}`)!;
    assert.equal(dangling.status, 'dangling');
    assert.deepEqual(dangling.missingNodeIds, ['ghost-node']);
    // 其余 12 根模板竹条不受影响，未被静默跳过
    assert.equal(report.okStripCount, before);
    assert.equal(report.totalStripCount, before + 1);
  });

  it('竹条两端均缺失时一次性列出全部缺失节点', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'strip/connect', startNodeId: 'ghost-a', endNodeId: 'ghost-b' });
    const report = inferStructure(engine.getState());
    const missing = report.findings.filter((f) => f.code === 'MISSING_NODE');
    assert.equal(missing.length, 1);
    assert.deepEqual(missing[0].nodeIds, ['ghost-a', 'ghost-b']);
  });

  it('竹条首尾同节点时给出 SELF_LOOP 结论', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'strip/connect', startNodeId: 'b0', endNodeId: 'b0' });
    const report = inferStructure(engine.getState());
    assert.equal(report.valid, false);
    const selfLoops = report.findings.filter((f) => f.code === 'SELF_LOOP');
    assert.equal(selfLoops.length, 1);
    assert.deepEqual(selfLoops[0].nodeIds, ['b0']);
    assert.match(selfLoops[0].message, /b0/);
  });

  it('连接关系成有向环时给出 CYCLE 结论并附完整路径', () => {
    const engine = new LanternEngine('silk');
    // 模板已有 b0 -> t0，反向补一根 t0 -> b0 即成环
    engine.dispatch({ type: 'strip/connect', startNodeId: 't0', endNodeId: 'b0' });
    const report = inferStructure(engine.getState());
    assert.equal(report.valid, false);

    const cycles = report.findings.filter((f) => f.code === 'CYCLE');
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].path, ['b0', 't0', 'b0']);
    assert.deepEqual(cycles[0].nodeIds, ['b0', 't0']);
    assert.ok(cycles[0].stripIds.includes('silk-post-0'));
    assert.match(cycles[0].message, /b0 -> t0 -> b0/);

    const inCycle = report.strips.filter((s) => s.status === 'in-cycle').map((s) => s.id);
    assert.deepEqual(inCycle.sort(), ['silk-post-0', `user-strip-${engine.getState().bambooStrips.length - 1}`].sort());
  });

  it('三节点长环同样被检出且路径闭合', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'strip/connect', startNodeId: 't1', endNodeId: 'b0' });
    engine.dispatch({ type: 'strip/connect', startNodeId: 'b0', endNodeId: 't1' });
    const report = inferStructure(engine.getState());
    const cycles = report.findings.filter((f) => f.code === 'CYCLE');
    assert.ok(cycles.length >= 1);
    const cycle = cycles.find((c) => c.nodeIds.includes('b0') && c.nodeIds.includes('t1'))!;
    assert.equal(cycle.path![0], cycle.path![cycle.path!.length - 1]);
  });

  it('缺失、自环、成环同时存在时三类结论全部保留，互不吞掉', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'strip/connect', startNodeId: 't0', endNodeId: 'ghost-node' });
    engine.dispatch({ type: 'strip/connect', startNodeId: 'b1', endNodeId: 'b1' });
    engine.dispatch({ type: 'strip/connect', startNodeId: 't0', endNodeId: 'b0' });
    const report = inferStructure(engine.getState());
    assert.equal(report.valid, false);
    const codes = report.findings.map((f) => f.code).sort();
    assert.deepEqual(codes, ['CYCLE', 'MISSING_NODE', 'SELF_LOOP']);
  });
});
