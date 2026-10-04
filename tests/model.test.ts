import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NebulaModel } from '../src/nebula/model.ts';
import type { NebulaParams } from '../src/nebula/params.ts';
import { mulberry32 } from './mulberry32.ts';

const baseParams: NebulaParams = {
  particleCount: 5000,
  hueOffset: 0,
  radius: 12,
  rotationSpeed: 0.5
};

function snapshot(model: NebulaModel, count: number): string {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(...model.positionAt(i), ...model.colorAt(i), model.sizeAt(i));
  }
  return values.join(',');
}

test('同一组参数按不同调整顺序应用，最终派生数据一致', () => {
  const finalParams: NebulaParams = {
    particleCount: 7500,
    hueOffset: 200,
    radius: 15,
    rotationSpeed: 1.2
  };

  const modelA = new NebulaModel(baseParams, 10000, mulberry32(1234));
  const modelB = new NebulaModel(baseParams, 10000, mulberry32(1234));

  modelA.setParams({ ...baseParams, radius: 15 });
  modelA.setParams({ ...baseParams, radius: 15, hueOffset: 200 });
  modelA.setParams({ ...baseParams, radius: 15, hueOffset: 200, rotationSpeed: 1.2 });
  modelA.setParams(finalParams);

  modelB.setParams({ ...baseParams, particleCount: 7500 });
  modelB.setParams({ ...baseParams, particleCount: 7500, rotationSpeed: 1.2 });
  modelB.setParams({ ...baseParams, particleCount: 7500, rotationSpeed: 1.2, hueOffset: 200 });
  modelB.setParams(finalParams);

  assert.deepEqual(modelA.getParams(), modelB.getParams());
  assert.equal(snapshot(modelA, finalParams.particleCount), snapshot(modelB, finalParams.particleCount));
});

test('参数调整不改变随机种子，同种子实例派生结果完全一致', () => {
  const modelA = new NebulaModel(baseParams, 10000, mulberry32(7));
  const modelB = new NebulaModel(baseParams, 10000, mulberry32(7));

  modelA.setParams({ ...baseParams, radius: 20, hueOffset: 350 });
  const finalParams = { ...baseParams, radius: 5, hueOffset: 10, particleCount: 1000 };
  modelA.setParams(finalParams);
  modelB.setParams(finalParams);

  assert.equal(snapshot(modelA, 5000), snapshot(modelB, 5000));
});

test('半径改回原值后位置逐字节还原，不产生累积漂移', () => {
  const model = new NebulaModel(baseParams, 10000, mulberry32(99));
  const before = snapshot(model, 10000);

  model.setParams({ ...baseParams, radius: 20 });
  model.setParams({ ...baseParams, radius: 5 });
  model.setParams({ ...baseParams, radius: 12.5 });
  model.setParams(baseParams);

  assert.equal(snapshot(model, 10000), before);
});

test('setParams 只返回真正变化的键', () => {
  const model = new NebulaModel(baseParams, 10000, mulberry32(1));
  assert.deepEqual(model.setParams({ ...baseParams }), []);
  assert.deepEqual(model.setParams({ ...baseParams, rotationSpeed: 1.5 }), ['rotationSpeed']);
  assert.deepEqual(model.setParams({ ...baseParams, rotationSpeed: 1.5, hueOffset: 30 }), ['hueOffset']);
});
