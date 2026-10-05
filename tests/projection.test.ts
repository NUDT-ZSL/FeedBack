import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  screenToNdc,
  worldToScreen,
  labelAnchor,
  LABEL_OFFSET_Y,
  type Viewport
} from '../src/core/projection';
import { makeCamera, VIEWPORT } from './helpers';

describe('投影与屏幕坐标换算', () => {
  it('相机正对世界原点时，原点落在视口中心', () => {
    const camera = makeCamera([0, 0, 8]);
    const center = worldToScreen(new THREE.Vector3(0, 0, 0), camera, VIEWPORT);
    expect(center.x).toBeCloseTo(960, 5);
    expect(center.y).toBeCloseTo(540, 5);
  });

  it('世界坐标 +x 方向映射到屏幕右侧，+y 映射到上方', () => {
    const camera = makeCamera([0, 0, 8]);
    const right = worldToScreen(new THREE.Vector3(1, 0, 0), camera, VIEWPORT);
    const up = worldToScreen(new THREE.Vector3(0, 1, 0), camera, VIEWPORT);
    expect(right.x).toBeGreaterThan(960);
    expect(up.y).toBeLessThan(540);
  });

  it('screenToNdc 与 worldToScreen 的 NDC 部分互逆', () => {
    const camera = makeCamera([0, 0, 8]);
    const screen = worldToScreen(new THREE.Vector3(0.757, 0.586, 0), camera, VIEWPORT);
    const ndc = screenToNdc(screen.x, screen.y, VIEWPORT);
    const projected = new THREE.Vector3(0.757, 0.586, 0).project(camera);
    expect(ndc.x).toBeCloseTo(projected.x, 10);
    expect(ndc.y).toBeCloseTo(projected.y, 10);
  });

  it('窗口尺寸变化后落点按比例更新', () => {
    const camera = makeCamera([0, 0, 8], [0, 0, 0], { width: 960, height: 540 });
    const small: Viewport = { left: 0, top: 0, width: 960, height: 540 };
    const center = worldToScreen(new THREE.Vector3(0, 0, 0), camera, small);
    expect(center.x).toBeCloseTo(480, 5);
    expect(center.y).toBeCloseTo(270, 5);
  });

  it('视口带偏移（left/top）时换算包含偏移量', () => {
    const camera = makeCamera([0, 0, 8]);
    const offset: Viewport = { left: 100, top: 50, width: 800, height: 600 };
    const center = worldToScreen(new THREE.Vector3(0, 0, 0), camera, offset);
    expect(center.x).toBeCloseTo(500, 5);
    expect(center.y).toBeCloseTo(350, 5);
  });

  it('标注锚点在原子屏幕位置正上方 70px', () => {
    const anchor = labelAnchor({ x: 300, y: 200 });
    expect(LABEL_OFFSET_Y).toBe(70);
    expect(anchor).toEqual({ x: 300, y: 130 });
  });
});
