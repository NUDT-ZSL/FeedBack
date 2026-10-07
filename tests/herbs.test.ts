import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHerbData } from '../src/core/herbs';
import { createSeededRandom } from '../src/core/random';
import { HERB_TYPES } from '../src/types';
import { Herb } from '../src/game/Herb';

const POSITION = { x: 1.5, y: 2.05, z: -3.25 };

test('相同种子与位置生成完全一致的草药数据', () => {
  const a = createHerbData(POSITION, createSeededRandom(99), 'herb_0');
  const b = createHerbData(POSITION, createSeededRandom(99), 'herb_0');
  assert.deepEqual(a, b);
});

test('草药数据字段合法：类型取自配置、药性在[0.5,1)、位置透传', () => {
  for (let seed = 0; seed < 100; seed++) {
    const herb = createHerbData(POSITION, createSeededRandom(seed), `herb_${seed}`);
    const type = HERB_TYPES.find(t => t.name === herb.name);
    assert.ok(type, `草药名称 ${herb.name} 必须来自 HERB_TYPES`);
    assert.equal(herb.element, type!.element);
    assert.equal(herb.color, type!.color);
    assert.ok(herb.potency >= 0.5 && herb.potency < 1, `药性 ${herb.potency} 应在 [0.5, 1)`);
    assert.deepEqual(herb.position, POSITION);
    assert.equal(herb.id, `herb_${seed}`);
  }
});

test('Herb 类注入相同随机源与 id 时数据完全一致（含网格位置）', () => {
  const position = new THREE.Vector3(1.5, 2.05, -3.25);
  const a = new Herb(position, createSeededRandom(7), 'herb_x');
  const b = new Herb(position, createSeededRandom(7), 'herb_x');

  assert.deepEqual(a.getData(), b.getData());
  assert.equal(a.getElement(), a.getData().element);
  assert.deepEqual(a.getPosition(), b.getPosition());
  assert.equal(a.getPosition().x, 1.5);
});

test('Herb 类不同种子产生不同数据', () => {
  const position = new THREE.Vector3(0, 0, 0);
  const a = new Herb(position, createSeededRandom(1), 'herb_a');
  const b = new Herb(position, createSeededRandom(2), 'herb_b');
  assert.notDeepEqual(a.getData(), b.getData());
});

test('采集动画由注入的时间源驱动，可离线确定性完成', () => {
  const herb = new Herb(new THREE.Vector3(0, 0, 0), createSeededRandom(3), 'herb_t');
  const target = new THREE.Vector3(10, 5, 10);

  let fakeNow = 0;
  const pending: Array<() => void> = [];
  const timing = {
    now: () => fakeNow,
    raf: (callback: () => void) => {
      pending.push(callback);
    }
  };

  let completed = false;
  herb.collectAnimation(target, () => {
    completed = true;
  }, timing);

  // 逐帧推进 1 秒动画（每帧 100ms）
  for (let frame = 0; frame < 10; frame++) {
    fakeNow += 100;
    const callbacks = pending.splice(0);
    callbacks.forEach(cb => cb());
  }

  assert.ok(completed, '注入时间推进满 1 秒后采集动画必须完成');
  assert.equal(herb.getMesh().position.x, 10);
  assert.equal(herb.getMesh().position.y, 5);
});
