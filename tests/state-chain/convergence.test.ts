import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CANDLE_MAX_BRIGHTNESS,
  CANDLE_MIN_BRIGHTNESS,
  CANDLE_TARGET_BRIGHTNESS,
  LanternEngine,
  SWING_INITIAL_ANGLE,
} from '../../src/state/engine.ts';

const FRAME_MS = 1000 / 60;

/** 确定性伪随机源（LCG），让带噪声的烛火推演可离线复现。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function tickSwing(engine: LanternEngine, totalMs: number): void {
  for (let t = 0; t < totalMs; t += FRAME_MS) {
    engine.dispatch({ type: 'swing/tick', dtMs: FRAME_MS });
  }
}

describe('烛火亮度收敛', () => {
  it('点亮后无噪声推演，亮度单调收敛到目标值 0.9', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'candle/light' });
    assert.equal(engine.getState().candle.brightness, CANDLE_MIN_BRIGHTNESS);

    let previous = engine.getState().candle.brightness;
    for (let i = 0; i < 60; i += 1) {
      engine.dispatch({ type: 'candle/tick', dtMs: 500 });
      const { brightness } = engine.getState().candle;
      assert.ok(brightness >= CANDLE_MIN_BRIGHTNESS && brightness <= CANDLE_MAX_BRIGHTNESS);
      assert.ok(brightness >= previous, '无噪声时亮度应单调上升');
      previous = brightness;
    }
    assert.ok(Math.abs(previous - CANDLE_TARGET_BRIGHTNESS) < 1e-9);
  });

  it('连续 300 次带噪声推演，亮度始终落在 [0.8, 1.0] 且末段围绕目标值小幅波动', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'candle/light' });
    const random = lcg(20261007);
    const tail: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const noise = (random() - 0.5) * 0.06;
      engine.dispatch({ type: 'candle/tick', dtMs: 500, noise });
      const { brightness, flickerOffset } = engine.getState().candle;
      assert.ok(
        brightness >= CANDLE_MIN_BRIGHTNESS && brightness <= CANDLE_MAX_BRIGHTNESS,
        `第 ${i} 次推演亮度越界: ${brightness}`,
      );
      assert.equal(flickerOffset, i + 1);
      if (i >= 250) tail.push(brightness);
    }
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    assert.ok(Math.abs(mean - CANDLE_TARGET_BRIGHTNESS) < 0.05, `末段均值 ${mean} 偏离目标`);
  });

  it('未点亮的蜡烛对 tick 无响应，亮度保持 0', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'candle/tick', dtMs: 500, noise: 0.5 });
    assert.equal(engine.getState().candle.isLit, false);
    assert.equal(engine.getState().candle.brightness, 0);
  });
});

describe('悬挂摆动收敛', () => {
  it('挂上后摆角从 ±15° 阻尼衰减，5 秒内收敛到稳定值', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'lantern/hang', hookId: 'beam-hook-1' });
    const hanging = engine.getState().hanging;
    assert.equal(hanging.isHanging, true);
    assert.equal(hanging.swingAngle, SWING_INITIAL_ANGLE);
    assert.equal(engine.getState().isNightMode, true);

    for (let i = 0; i < 360; i += 1) {
      engine.dispatch({ type: 'swing/tick', dtMs: FRAME_MS });
    }
    const settled = engine.getState().hanging;
    assert.ok(Math.abs(settled.swingAngle) < 0.05, `摆角未收敛: ${settled.swingAngle}`);
    assert.ok(Math.abs(settled.swingVelocity) < 0.05, `摆速未收敛: ${settled.swingVelocity}`);
  });

  it('摆动推演期间穿插拖拽/裱糊/换色等状态改写，收敛结果不受影响', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'lantern/hang', hookId: 'beam-hook-2' });
    for (let i = 0; i < 360; i += 1) {
      engine.dispatch({ type: 'swing/tick', dtMs: FRAME_MS });
      if (i === 60) {
        engine.dispatch({ type: 'node/dragStart', nodeId: 'b0' });
        engine.dispatch({ type: 'node/dragMove', nodeId: 'b0', dx: 12, dy: -6 });
        engine.dispatch({ type: 'node/dragEnd', nodeId: 'b0' });
      }
      if (i === 120) {
        engine.dispatch({ type: 'silk/selectColor', color: 'begoniaRed' });
        engine.dispatch({ type: 'silk/paste', panelId: 'silk-panel-front', progressDelta: 60, tensionDelta: 30 });
      }
      if (i === 180) {
        engine.dispatch({ type: 'silk/paste', panelId: 'silk-panel-front', progressDelta: 40, tensionDelta: 20 });
      }
    }
    const state = engine.getState();
    assert.ok(Math.abs(state.hanging.swingAngle) < 0.05);
    assert.ok(Math.abs(state.hanging.swingVelocity) < 0.05);
    // 穿插的改写同样生效且未被摆动推演覆盖
    assert.equal(state.nodes.find((n) => n.id === 'b0')!.x, -100 + 12);
    assert.equal(state.silkPanels.find((p) => p.id === 'silk-panel-front')!.pastingProgress, 100);
    assert.equal(state.silkPanels.find((p) => p.id === 'silk-panel-front')!.color, 'begoniaRed');
  });

  it('反复悬挂/取下后每次摆动都重新从 ±15° 收敛', () => {
    const engine = new LanternEngine('palace');
    for (let round = 0; round < 3; round += 1) {
      engine.dispatch({ type: 'lantern/hang', hookId: `hook-${round}` });
      assert.equal(engine.getState().hanging.swingAngle, SWING_INITIAL_ANGLE);
      tickSwing(engine, 1000);
      engine.dispatch({ type: 'lantern/unhang' });
      const unhung = engine.getState();
      assert.equal(unhung.hanging.isHanging, false);
      assert.equal(unhung.hanging.swingAngle, 0);
      assert.equal(unhung.isNightMode, false);
    }
    engine.dispatch({ type: 'lantern/hang', hookId: 'hook-final' });
    tickSwing(engine, 5000);
    const settled = engine.getState().hanging;
    assert.ok(Math.abs(settled.swingAngle) < 0.05);
    assert.ok(Math.abs(settled.swingVelocity) < 0.05);
  });

  it('未悬挂时 swing/tick 为空操作', () => {
    const engine = new LanternEngine('palace');
    engine.dispatch({ type: 'swing/tick', dtMs: 500 });
    assert.equal(engine.getState().hanging.swingAngle, 0);
    assert.equal(engine.getState().hanging.swingVelocity, 0);
  });
});

describe('烛火与悬挂并行的长链收敛', () => {
  it('点燃蜡烛并悬挂后连续推演 400 帧，亮度与摆角同时收敛且互不干扰', () => {
    const engine = new LanternEngine('silk');
    engine.dispatch({ type: 'frame/assemble' });
    engine.dispatch({ type: 'lantern/hang', hookId: 'beam-hook-3' });
    for (let i = 0; i < 400; i += 1) {
      engine.dispatch({ type: 'candle/tick', dtMs: FRAME_MS });
      engine.dispatch({ type: 'swing/tick', dtMs: FRAME_MS });
    }
    const state = engine.getState();
    const { brightness } = state.candle;
    assert.ok(brightness >= CANDLE_MIN_BRIGHTNESS && brightness <= CANDLE_MAX_BRIGHTNESS);
    assert.ok(Math.abs(brightness - CANDLE_TARGET_BRIGHTNESS) < 1e-3);
    assert.ok(Math.abs(state.hanging.swingAngle) < 0.05);
    assert.ok(Math.abs(state.hanging.swingVelocity) < 0.05);
    assert.equal(state.candle.isLit, true);
    assert.equal(state.hanging.isHanging, true);
  });
});
