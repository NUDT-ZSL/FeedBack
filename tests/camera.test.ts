import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { CameraController, CAMERA_DEFAULTS } from '../src/cameraController';

const DT = 1 / 60;

function simulate(controller: CameraController, seconds: number, startTime = 0): number {
  let time = startTime;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    time += DT;
    controller.update(DT, time);
  }
  return time;
}

describe('相机自动旋转链路 (camera)', () => {
  let controller: CameraController;

  beforeEach(() => {
    controller = new CameraController();
  });

  it('初始状态与默认参数一致', () => {
    expect(controller.cameraAngle).toBe(0);
    expect(controller.cameraHeight).toBe(20);
    expect(controller.cameraDistance).toBe(40);
    expect(controller.autoRotatePhase).toBe(0);
    expect(controller.isUserInteracting).toBe(false);
    expect(controller.isDragging).toBe(false);
  });

  it('空闲时自动旋转目标角度始终保持在 ±15° 内', () => {
    let time = 0;
    for (let i = 0; i < 90 * 60; i++) {
      time += DT;
      controller.update(DT, time);
      expect(Math.abs(controller.targetCameraAngle)).toBeLessThanOrEqual(CAMERA_DEFAULTS.autoRotateAmplitude + 1e-9);
    }
  });

  it('自动旋转收敛后实际角度不越过 ±15° 边界', () => {
    let time = simulate(controller, 60);
    for (let i = 0; i < 60 * 60; i++) {
      time += DT;
      controller.update(DT, time);
      expect(Math.abs(controller.cameraAngle)).toBeLessThanOrEqual(CAMERA_DEFAULTS.autoRotateAmplitude + 0.02);
    }
  });

  it('自动旋转确实在动：60 秒内目标角度出现明显摆动', () => {
    const angles: number[] = [];
    let time = 0;
    for (let i = 0; i < 60 * 60; i++) {
      time += DT;
      controller.update(DT, time);
      angles.push(controller.targetCameraAngle);
    }
    const min = Math.min(...angles);
    const max = Math.max(...angles);
    expect(max - min).toBeGreaterThan(CAMERA_DEFAULTS.autoRotateAmplitude);
  });

  it('拖拽交互：高度被钳制在 [2, 30]，交互期间自动旋转不接管', () => {
    controller.beginDrag(0);
    controller.applyDrag(0, 10000, 0.5);
    expect(controller.targetCameraHeight).toBe(30);
    controller.applyDrag(0, -100000, 1.0);
    expect(controller.targetCameraHeight).toBe(2);

    controller.applyDrag(200, 0, 1.5);
    const angleAfterDrag = controller.targetCameraAngle;
    expect(angleAfterDrag).toBeCloseTo(-200 * 0.005, 10);

    simulate(controller, 2, 1.5);
    expect(controller.targetCameraAngle).toBe(angleAfterDrag);
  });

  it('滚轮缩放：距离被钳制在 [10, 80]，极端输入不越界', () => {
    controller.applyZoom(100000, 0);
    expect(controller.targetCameraDistance).toBe(80);
    controller.applyZoom(-1000000, 0.5);
    expect(controller.targetCameraDistance).toBe(10);

    simulate(controller, 3, 0.5);
    expect(controller.cameraDistance).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(controller.cameraDistance).toBeLessThanOrEqual(80 + 1e-9);
  });

  it('交互结束后 5 秒自动旋转恢复，角度收敛回 ±15° 内', () => {
    controller.beginDrag(0);
    controller.applyDrag(5000, 0, 0);
    controller.endDrag(0);
    expect(controller.targetCameraAngle).toBeCloseTo(-25, 5);

    const time = simulate(controller, 12, 0);
    expect(controller.isUserInteracting).toBe(false);
    expect(Math.abs(controller.targetCameraAngle)).toBeLessThanOrEqual(CAMERA_DEFAULTS.autoRotateAmplitude + 1e-9);

    simulate(controller, 30, time);
    expect(Math.abs(controller.cameraAngle)).toBeLessThanOrEqual(CAMERA_DEFAULTS.autoRotateAmplitude + 0.02);
  });

  it('高度与距离在任意交互序列后都收敛到合法范围', () => {
    controller.beginDrag(0);
    controller.applyDrag(0, 99999, 0);
    controller.applyZoom(99999, 0);
    controller.endDrag(0);
    simulate(controller, 10, 0);
    expect(controller.cameraHeight).toBeLessThanOrEqual(30);
    expect(controller.cameraHeight).toBeGreaterThanOrEqual(2);
    expect(controller.cameraDistance).toBeLessThanOrEqual(80);
    expect(controller.cameraDistance).toBeGreaterThanOrEqual(10);
  });

  it('reset 后所有相机状态回到初始值', () => {
    controller.beginDrag(0);
    controller.applyDrag(300, 500, 0);
    controller.applyZoom(500, 0);
    controller.endDrag(0);
    simulate(controller, 8, 0);

    controller.reset();

    expect(controller.cameraAngle).toBe(0);
    expect(controller.targetCameraAngle).toBe(0);
    expect(controller.cameraHeight).toBe(20);
    expect(controller.targetCameraHeight).toBe(20);
    expect(controller.cameraDistance).toBe(40);
    expect(controller.targetCameraDistance).toBe(40);
    expect(controller.autoRotatePhase).toBe(0);
    expect(controller.isUserInteracting).toBe(false);
    expect(controller.isDragging).toBe(false);
  });

  it('applyTo 输出的相机位置有限且到目标点的水平半径等于距离', () => {
    simulate(controller, 10);
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    controller.applyTo(camera);
    expect(Number.isFinite(camera.position.x)).toBe(true);
    expect(Number.isFinite(camera.position.y)).toBe(true);
    expect(Number.isFinite(camera.position.z)).toBe(true);
    const radius = Math.hypot(camera.position.x, camera.position.z);
    expect(radius).toBeCloseTo(controller.cameraDistance, 6);
    expect(camera.position.y).toBeCloseTo(controller.cameraHeight, 6);
  });
});
