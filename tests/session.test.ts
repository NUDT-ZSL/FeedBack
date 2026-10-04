import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/session.ts';

function makeSession(seed = 1234, maxStrokes = 10): GameSession {
  return new GameSession({ width: 1280, height: 720, seed, maxStrokes });
}

function settle(session: GameSession, maxFrames = 20000): void {
  let frames = 0;
  while (session.state === 'rolling' && frames < maxFrames) {
    session.update(1 / 60);
    frames++;
  }
}

function strikeAwayFromHole(session: GameSession, power = 3): boolean {
  const hole = session.course.holePosition;
  const ball = session.ball.position;
  const away = { x: ball.x - hole.x, y: ball.y - hole.y };
  return session.strike(away, power);
}

test('状态机：球停止后回到可击球状态，且不残留滚动状态', () => {
  const s = makeSession();
  assert.equal(s.state, 'aiming');
  assert.ok(strikeAwayFromHole(s));
  assert.equal(s.state, 'rolling');
  settle(s);
  assert.equal(s.state, 'aiming');
  assert.equal(s.ball.isMoving, false);
  assert.deepEqual(s.ball.velocity, { x: 0, y: 0 });
  assert.ok(strikeAwayFromHole(s), '球停止后应能继续击球');
  assert.equal(s.strokeCount, 2);
});

test('状态机：击球次数达到上限后进入失败态，静止的球不能再击', () => {
  const s = makeSession(1234, 2);
  assert.ok(strikeAwayFromHole(s));
  settle(s);
  assert.equal(s.state, 'aiming');
  assert.ok(strikeAwayFromHole(s));
  settle(s);

  assert.equal(s.state, 'fail', '第 2 杆（达到上限）停止后应进入失败态');
  assert.equal(s.ball.isMoving, false);
  assert.equal(s.beginCharge(), false, '失败态不得进入蓄力');
  assert.equal(strikeAwayFromHole(s), false, '失败态击球应被拒绝');
  assert.equal(s.state, 'fail');
  assert.equal(s.ball.isMoving, false, '被拒绝的击球不得让球动起来');
  assert.deepEqual(s.ball.velocity, { x: 0, y: 0 });
});

test('状态机：重置关卡后无状态残留，且地形与洞口位置保持本关布局', () => {
  const s = makeSession(555);
  const layoutBefore = JSON.stringify({
    zones: s.course.terrainZones,
    hole: s.course.holePosition,
    tee: s.course.teePosition,
    fences: s.course.fences,
  });

  strikeAwayFromHole(s);
  settle(s);
  s.resetLevel();

  assert.equal(s.state, 'aiming');
  assert.equal(s.strokeCount, 0);
  assert.equal(s.ball.isMoving, false);
  assert.equal(s.ball.isInHole, false);
  assert.deepEqual(s.ball.position, s.course.teePosition, '重置后球应回到发球点');

  const layoutAfter = JSON.stringify({
    zones: s.course.terrainZones,
    hole: s.course.holePosition,
    tee: s.course.teePosition,
    fences: s.course.fences,
  });
  assert.equal(layoutAfter, layoutBefore, '重置本关不得改变地形与洞口位置');

  assert.ok(strikeAwayFromHole(s), '重置后应能正常击球');
});

test('状态机：失败后重置可恢复击球', () => {
  const s = makeSession(77, 1);
  strikeAwayFromHole(s);
  settle(s);
  assert.equal(s.state, 'fail');
  s.resetLevel();
  assert.equal(s.state, 'aiming');
  assert.ok(strikeAwayFromHole(s));
});

test('状态机：进入下一关生成新布局并清空击球计数', () => {
  const s = makeSession(888);
  const layoutBefore = JSON.stringify({
    hole: s.course.holePosition,
    tee: s.course.teePosition,
    zones: s.course.terrainZones,
  });

  strikeAwayFromHole(s);
  settle(s);
  s.nextLevel();

  assert.equal(s.level, 2);
  assert.equal(s.state, 'aiming');
  assert.equal(s.strokeCount, 0);
  assert.equal(s.ball.isMoving, false);
  assert.deepEqual(s.ball.position, s.course.teePosition);

  const layoutAfter = JSON.stringify({
    hole: s.course.holePosition,
    tee: s.course.teePosition,
    zones: s.course.terrainZones,
  });
  assert.notEqual(layoutAfter, layoutBefore, '下一关应生成新的地形与洞口位置');
});

test('状态机：进洞后进入胜利态，胜利态不可击球，可进入下一关', () => {
  const s = makeSession(99);
  const hole = s.course.holePosition;
  s.ball.reset(hole.x - 40, hole.y);
  assert.ok(s.strike({ x: 1, y: 0 }, 4));
  settle(s);
  assert.equal(s.state, 'win');
  assert.equal(s.strike({ x: 1, y: 0 }, 4), false, '胜利态击球应被拒绝');
  s.nextLevel();
  assert.equal(s.state, 'aiming');
  assert.equal(s.strokeCount, 0);
});

test('状态机：相同种子的会话整局逐帧可复现', () => {
  const play = () => {
    const s = makeSession(2024, 10);
    const trace: { x: number; y: number; state: string }[] = [];
    const hole = s.course.holePosition;
    const dir = { x: hole.x - s.ball.position.x, y: hole.y - s.ball.position.y };
    s.strike(dir, 9);
    while (s.state === 'rolling') {
      s.update(1 / 60);
      trace.push({ x: s.ball.position.x, y: s.ball.position.y, state: s.state });
    }
    return trace;
  };
  const a = play();
  const b = play();
  assert.ok(a.length > 0);
  assert.deepEqual(a, b, '相同种子整局轨迹必须逐帧一致');
});

test('状态机：非法状态转换被拒绝（滚动中不能蓄力/击球）', () => {
  const s = makeSession(31);
  assert.ok(strikeAwayFromHole(s, 8));
  assert.equal(s.state, 'rolling');
  assert.equal(s.beginCharge(), false, '滚动中不得蓄力');
  assert.equal(s.strike({ x: 1, y: 0 }, 5), false, '滚动中不得再次击球');
  assert.equal(s.strokeCount, 1, '被拒绝的击球不得计入杆数');
});
