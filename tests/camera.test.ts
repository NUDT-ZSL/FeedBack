import { describe, it, expect } from 'vitest';
import { CameraController, CAMERA_DEFAULTS } from '../src/cameraController';
import { step, makeCamera } from './helpers';

function makeController(): CameraController {
  return new CameraController(makeCamera());
}

describe('CameraController 交互 / 自动旋转 / 重置', () => {
  it('初始目标值与实际值均为默认值，相机位于 (0, 20, 40)', () => {
    const cc = makeController();
    expect(cc.cameraAngle).toBe(0);
    expect(cc.cameraHeight).toBe(20);
    expect(cc.cameraDistance).toBe(40);
    expect(cc.targetCameraAngle).toBe(0);
    expect(cc.targetCameraHeight).toBe(20);
    expect(cc.targetCameraDistance).toBe(40);
  });

  it('拖拽更新目标角度与高度，阻尼更新后实际值收敛到目标值', () => {
    const cc = makeController();
    cc.beginDrag(0);
    cc.dragBy(100, -50, 0.1);
    cc.endDrag(0.2);
    expect(cc.targetCameraAngle).toBeCloseTo(-0.5);
    expect(cc.targetCameraHeight).toBeCloseTo(15);

    // 交互后 5 秒内不做自动旋转，阻尼收敛（200 帧 ≈ 3.3s < 5s 空闲阈值）
    step(200, 1 / 60, (d, t) => cc.update(d, t));
    expect(cc.cameraAngle).toBeCloseTo(cc.targetCameraAngle, 3);
    expect(cc.cameraHeight).toBeCloseTo(cc.targetCameraHeight, 3);
  });

  it('拖拽高度与滚轮缩放被限制在边界内', () => {
    const cc = makeController();
    cc.beginDrag(0);
    cc.dragBy(0, 10000, 0);
    expect(cc.targetCameraHeight).toBe(CAMERA_DEFAULTS.maxHeight);
    cc.dragBy(0, -10000, 0);
    expect(cc.targetCameraHeight).toBe(CAMERA_DEFAULTS.minHeight);
    cc.zoomBy(100000, 0);
    expect(cc.targetCameraDistance).toBe(CAMERA_DEFAULTS.maxDistance);
    cc.zoomBy(-100000, 0);
    expect(cc.targetCameraDistance).toBe(CAMERA_DEFAULTS.minDistance);
  });

  it('空闲超过 5 秒后进入自动旋转，目标角度在 ±15° 内周期性变化', () => {
    const cc = makeController();
    const seen = new Set<number>();
    step(60 * 40, 1 / 60, (d, t) => {
      cc.update(d, t + 10); // 从 t=10s 开始，保证处于空闲
      seen.add(Math.round(cc.targetCameraAngle * 1000));
    });
    expect(cc.isUserInteracting).toBe(false);
    expect(Math.abs(cc.targetCameraAngle)).toBeLessThanOrEqual(
      CAMERA_DEFAULTS.autoRotateAmplitudeRad + 1e-9
    );
    // 目标角度确实随时间变化（自动旋转生效）
    expect(seen.size).toBeGreaterThan(10);
  });

  it('用户交互会暂停自动旋转', () => {
    const cc = makeController();
    cc.zoomBy(50, 100);
    const before = cc.targetCameraAngle;
    cc.update(1 / 60, 100 + 1 / 60);
    expect(cc.isUserInteracting).toBe(true);
    expect(cc.targetCameraAngle).toBe(before);
  });

  it('重置后所有目标值与实际值回到默认，相机位置复原', () => {
    const cc = makeController();
    cc.beginDrag(0);
    cc.dragBy(200, 100, 0);
    cc.zoomBy(500, 0);
    step(120, 1 / 60, (d, t) => cc.update(d, t));
    cc.reset();
    expect(cc.cameraAngle).toBe(0);
    expect(cc.targetCameraAngle).toBe(0);
    expect(cc.cameraHeight).toBe(20);
    expect(cc.targetCameraHeight).toBe(20);
    expect(cc.cameraDistance).toBe(40);
    expect(cc.targetCameraDistance).toBe(40);
    expect(cc.autoRotatePhase).toBe(0);
    const pos = (cc as any).camera.position as { x: number; y: number; z: number };
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(20);
    expect(pos.z).toBeCloseTo(40);
  });
});
