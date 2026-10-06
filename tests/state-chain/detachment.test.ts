import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LanternEngine } from '../../src/state/engine.ts';
import { deriveDisplay } from '../../src/state/derive.ts';

const SIDES = [
  'silk-panel-front',
  'silk-panel-right',
  'silk-panel-back',
  'silk-panel-left',
  'silk-panel-top',
  'silk-panel-bottom',
];

function pasteAll(engine: LanternEngine, progress = 100): void {
  for (const id of SIDES) {
    engine.dispatch({ type: 'silk/paste', panelId: id, progressDelta: progress, tensionDelta: 50 });
  }
}

describe('绸面脱离的展示结论传播', () => {
  it('全部裱糊后所有绸面 pasted、所有节点 covered、可组装', () => {
    const engine = new LanternEngine('silk');
    pasteAll(engine);
    const display = deriveDisplay(engine.getState());
    assert.equal(display.readyForAssembly, true);
    assert.ok(Math.abs(display.overallProgress - 100) < 1e-9);
    for (const id of SIDES) {
      assert.equal(display.panels[id].status, 'pasted');
      assert.deepEqual(display.panels[id].compromisedBy, []);
    }
    for (const node of Object.values(display.nodes)) {
      assert.equal(node.status, 'covered');
    }
  });

  it('一面绸面脱离后：自身 detached，相邻绸面被标记，非相邻绸面不受影响', () => {
    const engine = new LanternEngine('silk');
    pasteAll(engine);
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-front' });

    const display = deriveDisplay(engine.getState());
    assert.equal(display.panels['silk-panel-front'].status, 'detached');
    assert.equal(display.panels['silk-panel-front'].progress, 0);
    assert.equal(display.readyForAssembly, false);
    assert.ok(Math.abs(display.overallProgress - (5 / 6) * 100) < 1e-9);

    const adjacent = ['silk-panel-right', 'silk-panel-left', 'silk-panel-top', 'silk-panel-bottom'];
    for (const id of adjacent) {
      assert.deepEqual(display.panels[id].compromisedBy, ['silk-panel-front']);
      assert.equal(display.panels[id].status, 'pasted');
    }
    // back 与 front 不共享任何节点，结论不变
    assert.deepEqual(display.panels['silk-panel-back'].compromisedBy, []);
    assert.ok(display.panels['silk-panel-front'].adjacentPanelIds.includes('silk-panel-right'));
    assert.ok(!display.panels['silk-panel-front'].adjacentPanelIds.includes('silk-panel-back'));
  });

  it('仅脱离一面时相邻绸面仍覆盖节点，节点结论保持 covered', () => {
    const engine = new LanternEngine('silk');
    pasteAll(engine);
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-front' });
    const display = deriveDisplay(engine.getState());
    for (const id of ['b0', 'b1', 't0', 't1']) {
      assert.equal(display.nodes[id].status, 'covered', `${id} 应仍被相邻绸面覆盖`);
    }
  });

  it('覆盖某节点的绸面全部脱离后，节点结论变为 exposed 并追溯到脱离绸面', () => {
    const engine = new LanternEngine('silk');
    pasteAll(engine);
    // b0 仅属于 front / left / bottom 三面
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-front' });
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-left' });
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-bottom' });

    const display = deriveDisplay(engine.getState());
    assert.equal(display.nodes['b0'].status, 'exposed');
    assert.deepEqual(display.nodes['b0'].exposedBy.sort(), [
      'silk-panel-bottom',
      'silk-panel-front',
      'silk-panel-left',
    ]);
    assert.deepEqual(display.nodes['b0'].coveredBy, []);

    // 未受波及的节点（t2 属于 right/back/top，三面均未脱离）仍 covered
    assert.equal(display.nodes['t2'].status, 'covered');
    // 仍附着的 back 与 left（共享 b3）、bottom（共享 b2/b3）相邻，两面脱离都被追溯
    assert.deepEqual(display.panels['silk-panel-back'].compromisedBy, [
      'silk-panel-bottom',
      'silk-panel-left',
    ]);
  });

  it('重新裱糊脱离绸面后，相邻绸面与节点结论恢复', () => {
    const engine = new LanternEngine('silk');
    pasteAll(engine);
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-front' });
    engine.dispatch({ type: 'silk/paste', panelId: 'silk-panel-front', progressDelta: 100, tensionDelta: 50 });

    const display = deriveDisplay(engine.getState());
    assert.equal(display.panels['silk-panel-front'].status, 'pasted');
    assert.equal(display.readyForAssembly, true);
    assert.ok(Math.abs(display.overallProgress - 100) < 1e-9);
    for (const id of ['silk-panel-right', 'silk-panel-left', 'silk-panel-top', 'silk-panel-bottom']) {
      assert.deepEqual(display.panels[id].compromisedBy, []);
    }
    for (const id of ['b0', 'b1', 't0', 't1']) {
      assert.equal(display.nodes[id].status, 'covered');
      assert.deepEqual(display.nodes[id].exposedBy, []);
    }
  });
});
