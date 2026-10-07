import { describe, it, expect } from 'vitest';
import {
  step,
  createRng,
  nextRandom,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  BALL_OUT_MARGIN,
  NET_HEIGHT,
  FIXED_DT,
} from '../src/sim';
import { makeState, withBall, advance } from './helpers';

const GRAVITY = 500;

const NET_X = FIELD_WIDTH / 2;

describe('球体边界与反弹', () => {
  it('侧边边界反弹且不越界', () => {
    const state = withBall(makeState(), { y: 15, vy: -300, isMoving: true });
    const trace = advance(state, 10);
    for (const s of trace) {
      expect(s.ball.y).toBeGreaterThanOrEqual(BALL_OUT_MARGIN);
      expect(s.ball.y).toBeLessThanOrEqual(FIELD_HEIGHT - BALL_OUT_MARGIN);
    }
    expect(trace[trace.length - 1].ball.vy).toBeGreaterThan(0);
  });

  it('球越过右侧端线判为用户进球并重置中点', () => {
    const state = withBall(makeState(), { x: FIELD_WIDTH - 15, vx: 300, isMoving: true });
    const next = step(state, FIXED_DT);
    expect(next.score.user).toBe(1);
    expect(next.score.opponent).toBe(0);
    expect(next.goals).toHaveLength(1);
    expect(next.goals[0].side).toBe('user');
    expect(next.ball.x).toBe(NET_X);
    expect(next.ball.isMoving).toBe(false);
    expect(next.isTransitioning).toBe(true);

    const resumed = advance(next, Math.ceil(2100 / (FIXED_DT * 1000)));
    expect(resumed[resumed.length - 1].isTransitioning).toBe(false);
    expect(resumed[resumed.length - 1].phase).toBe('playing');
  });

  it('球越过左侧端线判为对手进球', () => {
    const state = withBall(makeState(), { x: 15, vx: -300, isMoving: true });
    const next = step(state, FIXED_DT);
    expect(next.score.opponent).toBe(1);
    expect(next.goals[0].side).toBe('opponent');
    expect(next.ball.x).toBe(NET_X);
  });

  it('低于网高的球被球网反射且不过网', () => {
    const state = withBall(makeState(), { x: NET_X - 30, z: 40, vx: 400, isMoving: true });
    const trace = advance(state, 12);
    const hit = trace.find((s) => s.netBulge !== 0);
    expect(hit).toBeDefined();
    expect(hit!.netBulge).toBe(-10);
    expect(hit!.ball.vx).toBeLessThan(0);
    for (const s of trace) {
      expect(s.ball.x).toBeLessThan(NET_X + 10);
    }
    expect(trace[trace.length - 1].score.user).toBe(0);
  });

  it('高于网顶的球可过网并最终计入进球', () => {
    const state = withBall(makeState(), { x: NET_X - 30, z: NET_HEIGHT + 20, vx: 400, isMoving: true });
    const trace = advance(state, 150);
    const crossed = trace.find((s) => s.ball.x > NET_X + 10);
    expect(crossed).toBeDefined();
    expect(crossed!.ball.vx).toBeGreaterThan(0);
    const final = trace[trace.length - 1];
    expect(final.score.user).toBe(1);
    expect(final.goals[0].side).toBe('user');
  });

  it('落地反弹速度衰减并最终停稳', () => {
    const state = withBall(makeState(), { z: 50, vz: -100, isMoving: true });
    const trace = advance(state, 600);
    const bounced = trace.find((s) => s.ball.isBouncing);
    expect(bounced).toBeDefined();
    expect(bounced!.ball.z).toBe(0);
    expect(bounced!.ball.vz).toBeGreaterThanOrEqual(0);
    const final = trace[trace.length - 1];
    expect(final.ball.isMoving).toBe(false);
    expect(final.ball.z).toBe(0);
    expect(final.ball.vz).toBe(0);
  });

  it('特征记录：当前口径下满力射门顶点低于网高，无法过网得分', () => {
    const maxShotVz = 150 + 100;
    const apex = (maxShotVz * maxShotVz) / (2 * GRAVITY);
    expect(apex).toBeLessThan(NET_HEIGHT);

    const state = withBall(makeState(), { x: NET_X - 60, z: 0, vx: 500, vz: maxShotVz, isMoving: true });
    const trace = advance(state, 60);
    expect(trace.some((s) => s.ball.x > NET_X + 10)).toBe(false);
    expect(trace[trace.length - 1].score.user).toBe(0);
  });

  it('随机连续射门的全程轨迹不越界、不陷入负高度', () => {
    const rng = createRng(20261008);
    let state = makeState(99);
    for (let shot = 0; shot < 10; shot++) {
      const angle = nextRandom(rng) * Math.PI * 2;
      const speed = 200 + nextRandom(rng) * 300;
      state = withBall(state, {
        x: 400,
        y: 250,
        z: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 150 + nextRandom(rng) * 100,
        isMoving: true,
      });
      for (let i = 0; i < 300; i++) {
        state = step(state, FIXED_DT);
        expect(state.ball.x).toBeGreaterThanOrEqual(BALL_OUT_MARGIN - 1e-9);
        expect(state.ball.x).toBeLessThanOrEqual(FIELD_WIDTH - BALL_OUT_MARGIN + 1e-9);
        expect(state.ball.y).toBeGreaterThanOrEqual(BALL_OUT_MARGIN - 1e-9);
        expect(state.ball.y).toBeLessThanOrEqual(FIELD_HEIGHT - BALL_OUT_MARGIN + 1e-9);
        expect(state.ball.z).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
