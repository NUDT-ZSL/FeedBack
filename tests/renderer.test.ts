import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NebulaRenderer } from '../src/nebula/renderer.ts';
import type { NebulaParams } from '../src/nebula/params.ts';
import { mulberry32 } from './mulberry32.ts';

const baseParams: NebulaParams = {
  particleCount: 2000,
  hueOffset: 0,
  radius: 12,
  rotationSpeed: 0.5
};

function createRenderer(params: NebulaParams, seed = 42): NebulaRenderer {
  return new NebulaRenderer(params, {
    maxParticles: 10000,
    random: mulberry32(seed),
    createTexture: () => new THREE.Texture()
  });
}

function positionArray(renderer: NebulaRenderer): Float32Array {
  return renderer.points.geometry.attributes.position.array as Float32Array;
}

function colorArray(renderer: NebulaRenderer): Float32Array {
  return renderer.points.geometry.attributes.color.array as Float32Array;
}

function bufferSignature(array: Float32Array, floats: number): string {
  return Array.from(array.subarray(0, floats)).join(',');
}

test('初始化只写入激活区间并设置 drawRange', () => {
  const renderer = createRenderer(baseParams);
  const positions = positionArray(renderer);

  assert.equal(renderer.points.geometry.drawRange.count, 2000);
  assert.notEqual(positions[0], 0);
  assert.equal(positions[2000 * 3], 0);
});

test('色相变化只重写颜色缓冲区，位置逐字节不变', () => {
  const renderer = createRenderer(baseParams);
  const positions = positionArray(renderer);
  const colors = colorArray(renderer);
  const positionBefore = bufferSignature(positions, 2000 * 3);
  const colorBefore = bufferSignature(colors, 2000 * 3);
  const colorVersionBefore = renderer.points.geometry.attributes.color.version;
  const positionVersionBefore = renderer.points.geometry.attributes.position.version;

  renderer.applyParams({ ...baseParams, hueOffset: 120 });

  assert.equal(bufferSignature(positions, 2000 * 3), positionBefore);
  assert.equal(
    renderer.points.geometry.attributes.position.version,
    positionVersionBefore
  );
  assert.notEqual(bufferSignature(colors, 2000 * 3), colorBefore);
  assert.ok(renderer.points.geometry.attributes.color.version > colorVersionBefore);
});

test('半径往返后活动区间位置与初始值完全一致', () => {
  const renderer = createRenderer(baseParams);
  const positions = positionArray(renderer);
  const before = bufferSignature(positions, 2000 * 3);

  renderer.applyParams({ ...baseParams, radius: 20 });
  renderer.applyParams({ ...baseParams, radius: 20, hueOffset: 60 });
  renderer.applyParams({ ...baseParams, radius: 5, hueOffset: 60 });
  renderer.applyParams(baseParams);

  assert.equal(bufferSignature(positions, 2000 * 3), before);
});

test('粒子数量增加只写新增区间，旧区间与 drawRange 之外不变', () => {
  const renderer = createRenderer({ ...baseParams, particleCount: 500 });
  const positions = positionArray(renderer);
  const oldRange = bufferSignature(positions, 500 * 3);

  renderer.applyParams({ ...baseParams, particleCount: 800 });

  assert.equal(renderer.points.geometry.drawRange.count, 800);
  assert.equal(bufferSignature(positions, 500 * 3), oldRange);
  assert.notEqual(positions[500 * 3], 0);
  assert.equal(positions[800 * 3], 0);
});

test('粒子数量减少只调整 drawRange，不重写缓冲区', () => {
  const renderer = createRenderer(baseParams);
  const positions = positionArray(renderer);
  const colors = colorArray(renderer);
  const positionBefore = bufferSignature(positions, 1000 * 3);
  const colorBefore = bufferSignature(colors, 1000 * 3);
  const positionVersionBefore = renderer.points.geometry.attributes.position.version;
  const colorVersionBefore = renderer.points.geometry.attributes.color.version;

  renderer.applyParams({ ...baseParams, particleCount: 1000 });

  assert.equal(renderer.points.geometry.drawRange.count, 1000);
  assert.equal(bufferSignature(positions, 1000 * 3), positionBefore);
  assert.equal(bufferSignature(colors, 1000 * 3), colorBefore);
  assert.equal(renderer.points.geometry.attributes.position.version, positionVersionBefore);
  assert.equal(renderer.points.geometry.attributes.color.version, colorVersionBefore);
});

test('同样的最终参数、不同的调整顺序，缓冲区结果一致', () => {
  const rendererA = createRenderer(baseParams, 7);
  const rendererB = createRenderer(baseParams, 7);
  const finalParams: NebulaParams = {
    particleCount: 3000,
    hueOffset: 180,
    radius: 16,
    rotationSpeed: 1.1
  };

  rendererA.applyParams({ ...baseParams, radius: 16 });
  rendererA.applyParams({ ...baseParams, radius: 16, hueOffset: 180 });
  rendererA.applyParams(finalParams);

  rendererB.applyParams({ ...baseParams, particleCount: 3000 });
  rendererB.applyParams({ ...baseParams, particleCount: 3000, hueOffset: 180 });
  rendererB.applyParams({ ...baseParams, particleCount: 3000, hueOffset: 180, radius: 16 });
  rendererB.applyParams(finalParams);

  assert.equal(
    bufferSignature(positionArray(rendererA), 3000 * 3),
    bufferSignature(positionArray(rendererB), 3000 * 3)
  );
  assert.equal(
    bufferSignature(colorArray(rendererA), 3000 * 3),
    bufferSignature(colorArray(rendererB), 3000 * 3)
  );
});

test('参数更新不干扰动画状态：旋转角与时间跨参数快照保持', () => {
  const renderer = createRenderer(baseParams);
  const positions = positionArray(renderer);
  const colors = colorArray(renderer);
  const positionBefore = bufferSignature(positions, 2000 * 3);
  const colorBefore = bufferSignature(colors, 2000 * 3);

  renderer.tick(1);
  const rotationAfterTick = renderer.points.rotation.y;
  assert.ok(Math.abs(rotationAfterTick - 0.5) < 1e-12);

  renderer.applyParams({ ...baseParams, hueOffset: 90 });
  assert.equal(renderer.points.rotation.y, rotationAfterTick);

  renderer.applyParams({ ...baseParams, hueOffset: 90, rotationSpeed: 1.5 });
  renderer.tick(1);
  assert.ok(Math.abs(renderer.points.rotation.y - 2.0) < 1e-12);

  assert.equal(bufferSignature(positions, 2000 * 3), positionBefore);
  assert.notEqual(bufferSignature(colors, 2000 * 3), colorBefore);
});

test('动画 tick 不回写任何粒子属性缓冲区', () => {
  const renderer = createRenderer(baseParams);
  const positions = positionArray(renderer);
  const colors = colorArray(renderer);
  const positionBefore = bufferSignature(positions, 2000 * 3);
  const colorBefore = bufferSignature(colors, 2000 * 3);
  const positionVersionBefore = renderer.points.geometry.attributes.position.version;
  const colorVersionBefore = renderer.points.geometry.attributes.color.version;

  renderer.tick(0.016);
  renderer.tick(0.016);

  assert.equal(bufferSignature(positions, 2000 * 3), positionBefore);
  assert.equal(bufferSignature(colors, 2000 * 3), colorBefore);
  assert.equal(renderer.points.geometry.attributes.position.version, positionVersionBefore);
  assert.equal(renderer.points.geometry.attributes.color.version, colorVersionBefore);
});

test('无变化的 applyParams 不触碰任何缓冲区', () => {
  const renderer = createRenderer(baseParams);
  const positionVersionBefore = renderer.points.geometry.attributes.position.version;
  const colorVersionBefore = renderer.points.geometry.attributes.color.version;

  renderer.applyParams({ ...baseParams });

  assert.equal(renderer.points.geometry.attributes.position.version, positionVersionBefore);
  assert.equal(renderer.points.geometry.attributes.color.version, colorVersionBefore);
  assert.equal(renderer.points.geometry.drawRange.count, 2000);
});
