import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/cameraRig';

describe('CameraRig 相机交互、自动旋转与重置', () => {
  let rig: CameraRig;

  beforeEach(() => {
    rig = new CameraRig();
  });

  it('初始目标值与实际值一致', () => {
    expect(rig.angle).toBe(0);
    expect(rig.height).toBe(20);
    expect(rig.distance).toBe(40);
    expect(rig.targetAngle).toBe(0);
    expect(rig.targetHeight).toBe(20);
    expect(rig.targetDistance).toBe(40);
  });

  it('拖拽更新目标角度与高度，高度钳制在 [2, 30]', () => {
    rig.beginDrag(100, 100, 0);
    rig.dragTo(200, 150, 0.1);
    expect(rig.targetAngle).toBeCloseTo(-100 * 0.005, 10);
    expect(rig.targetHeight).toBeCloseTo(25, 10);

    rig.dragTo(200, 10000, 0.2);
    expect(rig.targetHeight).toBe(30);
    rig.dragTo(200, -10000, 0.3);
    expect(rig.targetHeight).toBe(2);
    rig.endDrag(0.4);
    expect(rig.isDragging).toBe(false);
  });

  it('滚轮缩放钳制在 [10, 80]', () => {
    rig.zoom(10000, 0);
    expect(rig.targetDistance).toBe(80);
    rig.zoom(-100000, 0.1);
    expect(rig.targetDistance).toBe(10);
  });

  it('阻尼收敛：用户交互期间实际值收敛到目标值', () => {
    rig.beginDrag(0, 0, 0);
    rig.dragTo(200, 0, 0.01); // targetAngle = -1.0
    rig.endDrag(0.02);
    const target = rig.targetAngle;

    // 交互标记仍在 5 秒有效期内，自动旋转不会接管
    let t = 0.02;
    for (let i = 0; i < 280; i++) {
      t += 1 / 60;
      rig.update(1 / 60, t);
    }
    expect(t).toBeLessThan(5);
    expect(rig.angle).toBeCloseTo(target, 3);
  });

  it('闲置 5 秒后自动旋转接管，目标角摆动幅度不超过 15 度', () => {
    const amplitude = (15 * Math.PI) / 180;
    let t = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 40; i++) {
      t += 1 / 60;
      rig.update(1 / 60, t);
      if (t > 6) {
        expect(Math.abs(rig.targetAngle)).toBeLessThanOrEqual(amplitude + 1e-9);
        seen.add(Math.round(rig.targetAngle * 1000));
      }
    }
    // 自动旋转确实在驱动目标角变化
    expect(seen.size).toBeGreaterThan(100);
    expect(rig.isUserInteracting).toBe(false);
  });

  it('用户交互会暂停自动旋转', () => {
    let t = 0;
    for (let i = 0; i < 60 * 6; i++) {
      t += 1 / 60;
      rig.update(1 / 60, t);
    }
    expect(rig.autoRotatePhase).toBeGreaterThan(0);

    rig.zoom(50, t); // 标记为用户交互
    const phaseAtInteraction = rig.autoRotatePhase;
    for (let i = 0; i < 60; i++) {
      t += 1 / 60;
      rig.update(1 / 60, t);
    }
    expect(rig.autoRotatePhase).toBe(phaseAtInteraction);
  });

  it('applyToCamera 按角度/高度/距离摆放相机', () => {
    rig.angle = Math.PI / 2;
    rig.height = 10;
    rig.distance = 20;
    const camera = new THREE.PerspectiveCamera();
    rig.applyToCamera(camera);
    expect(camera.position.x).toBeCloseTo(20, 5);
    expect(camera.position.y).toBeCloseTo(10, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);
  });

  it('重置后所有目标值与实际值回到初始', () => {
    rig.beginDrag(0, 0, 0);
    rig.dragTo(500, 500, 0.1);
    rig.zoom(300, 0.2);
    rig.endDrag(0.3);
    let t = 10;
    for (let i = 0; i < 120; i++) {
      t += 1 / 60;
      rig.update(1 / 60, t);
    }

    rig.reset();
    expect(rig.angle).toBe(0);
    expect(rig.targetAngle).toBe(0);
    expect(rig.height).toBe(20);
    expect(rig.targetHeight).toBe(20);
    expect(rig.distance).toBe(40);
    expect(rig.targetDistance).toBe(40);
    expect(rig.autoRotatePhase).toBe(0);
    expect(rig.isUserInteracting).toBe(false);
    expect(rig.isDragging).toBe(false);
  });
});
