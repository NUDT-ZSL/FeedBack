import * as THREE from 'three';
import { TrackManager, PlayerCollisionState, Obstacle } from '../src/track';
import { AudioController } from '../src/audio-controller';
import { Player } from '../src/player';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

function makeState(x: number, z: number, feetY: number, invincible = false): PlayerCollisionState {
  const box = new THREE.Box3(
    new THREE.Vector3(x - 0.25, feetY, z - 0.2),
    new THREE.Vector3(x + 0.25, feetY + 1.5, z + 0.2)
  );
  return { box, laneX: x, feetY, isInvincible: invincible };
}

// ---------- 1. 连续若干拍：每拍至多一个障碍，同拍/邻拍均不重叠 ----------
{
  const tm = new TrackManager(new THREE.Scene());
  (tm as any).obstacleChance = 1; // 强制每拍都生成
  for (let i = 0; i < 60; i++) tm.onBeat();

  const obs = tm.getObstacles();
  check('生成了障碍', obs.length >= 50);

  const beatCounts = new Map<number, number>();
  for (const o of obs) beatCounts.set(o.beatIndex, (beatCounts.get(o.beatIndex) ?? 0) + 1);
  const maxPerBeat = Math.max(...beatCounts.values());
  check('每拍至多生成一个障碍', maxPerBeat <= 1);
  check('障碍记录了所属节拍', obs.every(o => Number.isInteger(o.beatIndex) && o.beatIndex > 0));

  let overlap = false;
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      const a = obs[i].position, b = obs[j].position;
      if (Math.abs(a.x - b.x) < 0.65 && Math.abs(a.z - b.z) < 1.0) overlap = true;
    }
  }
  check('连续运行若干拍后不存在重叠障碍', !overlap);
}

// ---------- 2. 跳跃最高点越过矮障碍不命中；站立时命中 ----------
{
  const tm = new TrackManager(new THREE.Scene());
  (tm as any).createJumpObstacle(0, -5, 1);
  const obs = tm.getObstacles()[0] as Obstacle;

  // 模拟跳跃最高点：脚底与障碍顶部齐平（包围盒仍与障碍相交）
  const cleared = tm.checkCollisions(makeState(0, -5, obs.topY));
  check('跳跃越过障碍顶部时不判定命中', !cleared.damage && !obs.hit);

  const standing = tm.checkCollisions(makeState(0, -5, 0.15));
  check('站立撞上障碍时判定命中', standing.damage && obs.hit === true);
}

// ---------- 3. 闪避到位后不再触发该车道障碍伤害 ----------
{
  const tm = new TrackManager(new THREE.Scene());
  (tm as any).createSlideObstacle(0, -5, 1);
  const obs = tm.getObstacles()[0] as Obstacle;

  // 闪避完成，已在相邻车道
  const dodged = tm.checkCollisions(makeState(1.3, -5, 0.15));
  check('闪避到相邻车道后不命中', !dodged.damage && !obs.hit);

  // 闪避过程中已离开原车道判定范围（包围盒仍相交）
  const midDodge = tm.checkCollisions(makeState(0.7, -5, 0.15));
  check('离开车道判定范围后不命中（即使包围盒相交）', !midDodge.damage && !obs.hit);

  const inLane = tm.checkCollisions(makeState(0, -5, 0.15));
  check('未闪避时命中横杆', inLane.damage && obs.hit === true);
}

// ---------- 4. 无敌帧：不重复扣血；无敌结束后同一障碍仍正常判定 ----------
{
  const tm = new TrackManager(new THREE.Scene());
  (tm as any).createJumpObstacle(0, -5, 1);
  const obs = tm.getObstacles()[0] as Obstacle;

  const r1 = tm.checkCollisions(makeState(0, -5, 0.15, true));
  const r2 = tm.checkCollisions(makeState(0, -5, 0.15, true));
  check('无敌帧内多次接触不扣血', !r1.damage && !r2.damage);
  check('无敌帧内障碍不被消耗', !obs.hit);

  const r3 = tm.checkCollisions(makeState(0, -5, 0.15, false));
  check('无敌结束后再次接触同一障碍仍判定命中', r3.damage && obs.hit === true);

  const p = new Player();
  const h0 = p.getHealth();
  p.takeDamage();
  p.takeDamage(); // 无敌中
  check('玩家无敌帧内只扣一次血', p.getHealth() === h0 - 1);
  p.update(1.2); // 无敌结束
  p.takeDamage();
  check('无敌结束后可再次扣血', p.getHealth() === h0 - 2);
}

// ---------- 5. 音频分析不可用：回退节拍稳定，无长空白、无爆发补拍 ----------
{
  const ac = new AudioController();
  (ac as any).isPlaying = true;
  (ac as any).analysisAvailable = false; // 解码失败/合成音轨
  (ac as any).lastBeatTime = performance.now();

  check('回退节拍间隔为默认值(120bpm=0.5s)', Math.abs(ac.getBeatInterval() - 0.5) < 1e-6);

  ac.update();
  check('未到间隔时不产生节拍', !ac.isBeatDetected());

  (ac as any).lastBeatTime = performance.now() - 600;
  ac.update();
  check('到达间隔时产生节拍', ac.isBeatDetected());
  ac.update();
  check('同一拍不会连续触发', !ac.isBeatDetected());

  // 模拟长时间卡顿（5秒无节拍）：只补一拍，不爆发
  (ac as any).lastBeatTime = performance.now() - 5000;
  ac.update();
  const beatAfterGap = ac.isBeatDetected();
  ac.update();
  check('长时间空白后只恢复单拍（不一次性补生成）', beatAfterGap && !ac.isBeatDetected());

  // 合成音轨 bpm=128 时间隔跟随 bpm
  (ac as any).bpm = 128;
  check('合成音轨节拍间隔跟随其BPM', Math.abs(ac.getBeatInterval() - 60 / 128) < 1e-6);
}

// ---------- 6. 能量值不进入障碍生成路径 ----------
{
  const tm = new TrackManager(new THREE.Scene());
  tm.updateColors(0.0);
  tm.setBeatIntensity(1.0);
  const src = tm.onBeat.toString() + (tm as any).generateObstacle.toString();
  check('障碍生成不依赖能量值', !src.includes('energyLevel'));
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
