import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LanternEngine, createInitialState } from '../../src/state/engine.ts';
import { createTemplate } from '../../src/state/templates.ts';

describe('反复操作的累积语义（不被覆盖）', () => {
  it('同一节点在一次拖拽手势内多次 dragMove，位移按增量累加', () => {
    const engine = new LanternEngine('palace');
    const before = engine.getState().nodes.find((n) => n.id === 'ring-0')!;

    engine.dispatch({ type: 'node/dragStart', nodeId: 'ring-0' });
    engine.dispatch({ type: 'node/dragMove', nodeId: 'ring-0', dx: 10, dy: 5 });
    engine.dispatch({ type: 'node/dragMove', nodeId: 'ring-0', dx: 3, dy: 2 });

    const dragging = engine.getState().nodes.find((n) => n.id === 'ring-0')!;
    assert.equal(dragging.x, before.x + 13);
    assert.equal(dragging.y, before.y + 7);
    assert.equal(dragging.isDragging, true);

    engine.dispatch({ type: 'node/dragEnd', nodeId: 'ring-0' });
    assert.equal(engine.getState().nodes.find((n) => n.id === 'ring-0')!.isDragging, false);
  });

  it('同一节点跨多次拖拽手势，新位移在既有位置上继续累加', () => {
    const engine = new LanternEngine('palace');
    const before = engine.getState().nodes.find((n) => n.id === 'ring-0')!;

    engine.dispatch({ type: 'node/dragStart', nodeId: 'ring-0' });
    engine.dispatch({ type: 'node/dragMove', nodeId: 'ring-0', dx: 10, dy: 5 });
    engine.dispatch({ type: 'node/dragEnd', nodeId: 'ring-0' });

    engine.dispatch({ type: 'node/dragStart', nodeId: 'ring-0' });
    engine.dispatch({ type: 'node/dragMove', nodeId: 'ring-0', dx: -4, dy: 1 });
    engine.dispatch({ type: 'node/dragEnd', nodeId: 'ring-0' });

    const after = engine.getState().nodes.find((n) => n.id === 'ring-0')!;
    assert.equal(after.x, before.x + 6);
    assert.equal(after.y, before.y + 6);
  });

  it('未进入拖拽态的节点收到 dragMove 不改写坐标', () => {
    const engine = new LanternEngine('palace');
    const before = JSON.stringify(engine.getState().nodes);
    engine.dispatch({ type: 'node/dragMove', nodeId: 'ring-1', dx: 999, dy: 999 });
    assert.equal(JSON.stringify(engine.getState().nodes), before);
  });

  it('拖动一个节点不覆盖其他节点的坐标与拖拽标记', () => {
    const engine = new LanternEngine('palace');
    const untouched = createInitialState('palace').nodes.filter((n) => n.id !== 'ring-0');
    engine.dispatch({ type: 'node/dragStart', nodeId: 'ring-0' });
    engine.dispatch({ type: 'node/dragMove', nodeId: 'ring-0', dx: 20, dy: -8 });
    engine.dispatch({ type: 'node/dragEnd', nodeId: 'ring-0' });
    const after = engine.getState().nodes.filter((n) => n.id !== 'ring-0');
    assert.deepEqual(after, untouched);
  });

  it('同一绸面反复裱糊，进度与张力在原值上累加，超过 100 被钳制而不是变成负数/溢出', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'silk/selectColor', color: 'gooseYellow' });
    const panelId = 'palace-panel-0';

    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 30, tensionDelta: 20 });
    let panel = engine.getState().silkPanels.find((p) => p.id === panelId)!;
    assert.equal(panel.pastingProgress, 30);
    assert.equal(panel.tension, 20);
    assert.equal(panel.color, 'gooseYellow');

    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 50, tensionDelta: 45 });
    panel = engine.getState().silkPanels.find((p) => p.id === panelId)!;
    assert.equal(panel.pastingProgress, 80);
    assert.equal(panel.tension, 65);

    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 40, tensionDelta: 50 });
    panel = engine.getState().silkPanels.find((p) => p.id === panelId)!;
    assert.equal(panel.pastingProgress, 100);
    assert.equal(panel.tension, 100);
  });

  it('裱糊时使用当前选中绸色，后续换色裱糊即时改写绸面颜色', () => {
    const engine = new LanternEngine('palace');
    const panelId = 'palace-panel-0';
    engine.dispatch({ type: 'silk/selectColor', color: 'gooseYellow' });
    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 100, tensionDelta: 50 });
    assert.equal(engine.getState().selectedColor, 'gooseYellow');

    engine.dispatch({ type: 'silk/selectColor', color: 'begoniaRed' });
    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 0, tensionDelta: 0 });
    const panel = engine.getState().silkPanels.find((p) => p.id === panelId)!;
    assert.equal(panel.color, 'begoniaRed');
    assert.equal(panel.pastingProgress, 100);
  });

  it('对一面绸子的裱糊不会覆盖其他绸面的进度/张力', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'silk/paste', panelId: 'palace-panel-0', progressDelta: 40, tensionDelta: 30 });
    const other = engine.getState().silkPanels.find((p) => p.id === 'palace-panel-1')!;
    assert.equal(other.pastingProgress, 0);
    assert.equal(other.tension, 0);
    assert.equal(other.isDetached, false);
  });

  it('脱离后的绸面重新裱糊从新绸布起算（0 基累加），且脱离标记复位', () => {
    const engine = new LanternEngine('palace');
    const panelId = 'palace-panel-0';
    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 100, tensionDelta: 95 });
    engine.dispatch({ type: 'silk/detach', panelId });
    let panel = engine.getState().silkPanels.find((p) => p.id === panelId)!;
    assert.equal(panel.isDetached, true);
    assert.equal(panel.pastingProgress, 0);
    assert.equal(panel.tension, 0);

    engine.dispatch({ type: 'silk/paste', panelId, progressDelta: 25, tensionDelta: 10 });
    panel = engine.getState().silkPanels.find((p) => p.id === panelId)!;
    assert.equal(panel.isDetached, false);
    assert.equal(panel.pastingProgress, 25);
    assert.equal(panel.tension, 10);
  });

  it('模板本身节点/竹条/绸面齐备且竹条全部指向真实节点', () => {
    for (const type of ['palace', 'revolving', 'silk'] as const) {
      const template = createTemplate(type);
      const ids = new Set(template.nodes.map((n) => n.id));
      assert.ok(template.silkPanels.length > 0);
      for (const strip of template.connections) {
        assert.ok(ids.has(strip.startNodeId), `${type}: ${strip.id} start missing`);
        assert.ok(ids.has(strip.endNodeId), `${type}: ${strip.id} end missing`);
      }
    }
  });
});
