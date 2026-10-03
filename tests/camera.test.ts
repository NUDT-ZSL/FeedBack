import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/cameraController';

const DT = 1 / 60;

function createController(): { camera: THREE.PerspectiveCamera; controller: CameraController } {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  return { camera, controller: new CameraController(camera) };
}

function run(controller: CameraController, seconds: number, startTime: number, onStep?: () => void): number {
  let time = startTime;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    time += DT;
    controller.update(DT, time);
    if (onStep) onStep();
  }
  return time;
}

describe('相机链路 - 自动旋转', () => {
  it('默认状态为初始位姿', () => {
    const { controller } = createController();
    expect(controller.cameraAngle).toBe(0);
    expect(controller.cameraHeight).toBe(20);
    expect(controller.cameraDistance).toBe(40);
  });

  it('自动旋转角度不超出 ±15° 振幅范围', () => {
    const { controller } = createController();
    const limit = CameraController.AUTO_ROTATE_AMPLITUDE + 0.02;
    run(controller, 60, 0, () => {
      expect(Math.abs(controller.targetCameraAngle)).toBeLessThanOrEqual(
        CameraController.AUTO_ROTATE_AMPLITUDE + 1e-12
      );
      expect(Math.abs(controller.cameraAngle)).toBeLessThanOrEqual(limit);
    });
  });

  it('自动旋转角度随时间周期性变化', () => {
    const { controller } = createController();
    let min = Infinity;
    let max = -Infinity;
    run(controller, 60, 0, () => {
      min = Math.min(min, controller.cameraAngle);
      max = Math.max(max, controller.cameraAngle);
    });
    expect(max - min).toBeGreaterThan(0.2);
    expect(controller.autoRotatePhase).toBeGreaterThan(0);
  });

  it('相机位置与角度/距离状态一致且朝向观察点', () => {
    const { camera, controller } = createController();
    run(controller, 10, 0, () => {
      const expectedX = Math.sin(controller.cameraAngle) * controller.cameraDistance;
      const expectedZ = Math.cos(controller.cameraAngle) * controller.cameraDistance;
      expect(camera.position.x).toBeCloseTo(expectedX, 6);
      expect(camera.position.y).toBeCloseTo(controller.cameraHeight, 6);
      expect(camera.position.z).toBeCloseTo(expectedZ, 6);
    });
  });
});

describe('相机链路 - 用户交互边界', () => {
  it('拖拽目标高度被钳制在 [2, 30]', () => {
    const { controller } = createController();
    controller.beginDrag(0, 0);
    controller.drag(0, 10000);
    expect(controller.targetCameraHeight).toBe(CameraController.MAX_HEIGHT);
    controller.drag(0, -100000);
    expect(controller.targetCameraHeight).toBe(CameraController.MIN_HEIGHT);
    controller.endDrag();

    run(controller, 10, 0, () => {
      expect(controller.cameraHeight).toBeGreaterThanOrEqual(CameraController.MIN_HEIGHT - 1e-9);
      expect(controller.cameraHeight).toBeLessThanOrEqual(CameraController.MAX_HEIGHT + 1e-9);
    });
  });

  it('滚轮缩放目标距离被钳制在 [10, 80]', () => {
    const { controller } = createController();
    controller.zoom(100000);
    expect(controller.targetCameraDistance).toBe(CameraController.MAX_DISTANCE);
    controller.zoom(-1000000);
    expect(controller.targetCameraDistance).toBe(CameraController.MIN_DISTANCE);

    run(controller, 10, 0, () => {
      expect(controller.cameraDistance).toBeGreaterThanOrEqual(CameraController.MIN_DISTANCE - 1e-9);
      expect(controller.cameraDistance).toBeLessThanOrEqual(CameraController.MAX_DISTANCE + 1e-9);
    });
  });

  it('交互期间自动旋转不覆盖目标角度', () => {
    const { controller } = createController();
    controller.beginDrag(0, 0);
    controller.drag(200, 0);
    const targetAngle = controller.targetCameraAngle;
    expect(targetAngle).not.toBe(0);

    const phaseBefore = controller.autoRotatePhase;
    run(controller, 2, 0);
    expect(controller.isUserInteracting).toBe(true);
    expect(controller.autoRotatePhase).toBe(phaseBefore);
    expect(controller.targetCameraAngle).toBe(targetAngle);
    controller.endDrag();
  });

  it('交互停止 5s 后恢复自动旋转', () => {
    const { controller } = createController();
    let time = 0;
    time = run(controller, 1, time);

    controller.zoom(100);
    expect(controller.isUserInteracting).toBe(true);

    time = run(controller, 4, time);
    expect(controller.isUserInteracting).toBe(true);

    const phaseBefore = controller.autoRotatePhase;
    time = run(controller, 2, time);
    expect(controller.isUserInteracting).toBe(false);
    expect(controller.autoRotatePhase).toBeGreaterThan(phaseBefore);
  });
});

describe('相机链路 - 重置', () => {
  it('reset 后角度/高度/距离与交互标志回到初始状态', () => {
    const { controller } = createController();
    controller.beginDrag(100, 100);
    controller.drag(300, 200);
    controller.endDrag();
    controller.zoom(500);
    run(controller, 3, 0);

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
});
