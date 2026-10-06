import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LanternEngine } from '../../src/state/engine.ts';
import { deriveDisplay, inferStructure } from '../../src/state/derive.ts';

const SIDES = [
  'silk-panel-front',
  'silk-panel-right',
  'silk-panel-back',
  'silk-panel-left',
  'silk-panel-top',
  'silk-panel-bottom',
];

describe('骨架→裱糊→组装→展示→悬挂 全链路共享状态', () => {
  it('五个阶段连续改写同一份状态，前序阶段的改写在后续阶段始终可见', () => {
    const engine = new LanternEngine('silk');

    // 骨架阶段：拖节点 + 结构推演
    engine.dispatch({ type: 'node/dragStart', nodeId: 't0' });
    engine.dispatch({ type: 'node/dragMove', nodeId: 't0', dx: 8, dy: 4 });
    engine.dispatch({ type: 'node/dragEnd', nodeId: 't0' });
    assert.equal(engine.getState().nodes.find((n) => n.id === 't0')!.x, -100 + 8);
    assert.equal(inferStructure(engine.getState()).valid, true);
    engine.dispatch({ type: 'phase/set', phase: 'pasting' });

    // 裱糊阶段：换色 + 逐面裱糊
    engine.dispatch({ type: 'silk/selectColor', color: 'begoniaRed' });
    for (const id of SIDES) {
      engine.dispatch({ type: 'silk/paste', panelId: id, progressDelta: 60, tensionDelta: 30 });
      engine.dispatch({ type: 'silk/paste', panelId: id, progressDelta: 40, tensionDelta: 20 });
    }
    let display = deriveDisplay(engine.getState());
    assert.equal(display.readyForAssembly, true);
    assert.equal(display.panels['silk-panel-front'].color, 'begoniaRed');

    // 组装阶段：扣合框架，蜡烛自动点亮
    engine.dispatch({ type: 'phase/set', phase: 'assembly' });
    engine.dispatch({ type: 'frame/assemble' });
    assert.equal(engine.getState().isAssembled, true);
    assert.equal(engine.getState().candle.isLit, true);

    // 展示阶段：自转；拆卸一面再重裱换色
    engine.dispatch({ type: 'phase/set', phase: 'display' });
    engine.dispatch({ type: 'display/setRotationSpeed', speed: 72 });
    engine.dispatch({ type: 'display/rotate', dtMs: 1000 });
    assert.ok(Math.abs(engine.getState().rotationAngle - 72) < 1e-9);
    engine.dispatch({ type: 'silk/detach', panelId: 'silk-panel-top' });
    display = deriveDisplay(engine.getState());
    assert.equal(display.readyForAssembly, false);
    assert.equal(display.panels['silk-panel-top'].status, 'detached');
    engine.dispatch({ type: 'silk/selectColor', color: 'bambooGreen' });
    engine.dispatch({ type: 'silk/paste', panelId: 'silk-panel-top', progressDelta: 100, tensionDelta: 40 });
    display = deriveDisplay(engine.getState());
    assert.equal(display.readyForAssembly, true);
    assert.equal(display.panels['silk-panel-top'].color, 'bambooGreen');
    assert.equal(display.panels['silk-panel-front'].color, 'begoniaRed');

    // 悬挂阶段：挂起并推演摆动与烛光
    engine.dispatch({ type: 'lantern/hang', hookId: 'beam-hook-9' });
    for (let i = 0; i < 360; i += 1) {
      engine.dispatch({ type: 'swing/tick', dtMs: 1000 / 60 });
      engine.dispatch({ type: 'candle/tick', dtMs: 1000 / 60 });
    }

    // 终态：所有阶段的改写共存于同一份状态
    const state = engine.getState();
    assert.equal(state.currentPhase, 'hanging');
    assert.equal(state.nodes.find((n) => n.id === 't0')!.x, -100 + 8);
    assert.equal(state.silkPanels.find((p) => p.id === 'silk-panel-top')!.color, 'bambooGreen');
    assert.equal(state.isAssembled, true);
    assert.equal(state.candle.isLit, true);
    assert.ok(Math.abs(state.candle.brightness - 0.9) < 1e-3);
    assert.equal(state.hanging.isHanging, true);
    assert.equal(state.hanging.hookId, 'beam-hook-9');
    assert.ok(Math.abs(state.hanging.swingAngle) < 0.05);
    assert.equal(state.isNightMode, true);
    assert.equal(inferStructure(state).valid, true);
    assert.equal(deriveDisplay(state).readyForAssembly, true);
  });

  it('重置后状态回到模板初始值，可再次完整走流程', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'silk/paste', panelId: 'silk-panel-front', progressDelta: 80, tensionDelta: 40 });
    engine.dispatch({ type: 'lantern/hang', hookId: 'hook-x' });
    engine.dispatch({ type: 'state/reset', template: 'revolving' });
    const state = engine.getState();
    assert.equal(state.lanternType, 'revolving');
    assert.equal(state.currentPhase, 'skeleton');
    assert.equal(state.silkPanels.length, 16);
    assert.ok(state.silkPanels.every((p) => p.pastingProgress === 0 && !p.isDetached));
    assert.equal(state.hanging.isHanging, false);
    assert.equal(state.candle.isLit, false);
    assert.equal(inferStructure(state).valid, true);
  });
});
