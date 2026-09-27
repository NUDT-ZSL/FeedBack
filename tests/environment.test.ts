import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { fakeWindow } from './helpers';
import { EnvironmentManager } from '../src/environment';
import { DEFAULT_WATER_PARAMS } from '../src/hud';

describe('EnvironmentManager 水质参数联动', () => {
  let scene: THREE.Scene;
  let env: EnvironmentManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    env = new EnvironmentManager(scene);
  });

  it('默认参数与共享常量一致', () => {
    expect(env.params.temperature).toBe(DEFAULT_WATER_PARAMS.temperature);
    expect(env.params.lightIntensity).toBe(DEFAULT_WATER_PARAMS.lightIntensity);
    expect(env.params.turbidity).toBe(DEFAULT_WATER_PARAMS.turbidity);
  });

  it('光照强度实时驱动环境光与方向光', () => {
    env.setLightIntensity(50);
    expect(env.params.lightIntensity).toBe(50);
    expect(env.ambientLight.intensity).toBeCloseTo(0.25, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(0.5, 10);

    env.setLightIntensity(100);
    expect(env.ambientLight.intensity).toBeCloseTo(0.5, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(1.0, 10);
  });

  it('光照取最小值 0 时光强归零且不产生 NaN', () => {
    env.setLightIntensity(0);
    expect(env.ambientLight.intensity).toBe(0);
    expect(env.directionalLight.intensity).toBe(0);
    expect(Number.isFinite(env.ambientLight.intensity)).toBe(true);
    expect(Number.isFinite(env.directionalLight.intensity)).toBe(true);
  });

  it('浑浊度驱动雾密度与粒子透明度', () => {
    env.setTurbidity(50);
    const fog = scene.fog as THREE.FogExp2;
    expect(fog.density).toBeCloseTo(0.01 + 0.5 * 0.05, 10);
    const mat = env.waterParticles.material as THREE.PointsMaterial;
    expect(mat.opacity).toBeCloseTo(Math.max(0.2, 0.4 - 0.5 * 0.3), 10);
  });

  it('浑浊度边界 0/100 时雾密度与透明度不越界、不出现 NaN', () => {
    const fog = scene.fog as THREE.FogExp2;
    const mat = env.waterParticles.material as THREE.PointsMaterial;

    env.setTurbidity(0);
    expect(fog.density).toBeCloseTo(0.01, 10);
    expect(mat.opacity).toBeCloseTo(0.4, 10);

    env.setTurbidity(100);
    expect(fog.density).toBeCloseTo(0.06, 10);
    // 公式值 0.4 - 1.0*0.3 = 0.1，应被钳制到 0.2 下限
    expect(mat.opacity).toBeCloseTo(0.2, 10);
    expect(mat.opacity).toBeGreaterThanOrEqual(0.2);
    expect(mat.opacity).toBeLessThanOrEqual(1);
    expect(Number.isFinite(fog.density)).toBe(true);
  });

  it('温度边界 15/35 被如实记录', () => {
    env.setTemperature(15);
    expect(env.params.temperature).toBe(15);
    env.setTemperature(35);
    expect(env.params.temperature).toBe(35);
  });

  it('生成 20 只水母且光源基准强度为 0.5', () => {
    expect(env.jellyfish.length).toBe(20);
    expect(env.jellyfishLights.length).toBe(20);
    for (const light of env.jellyfishLights) {
      expect(light.intensity).toBeCloseTo(0.5, 10);
    }
  });
});

describe('水母悬停高亮进入与退出', () => {
  let scene: THREE.Scene;
  let env: EnvironmentManager;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    scene = new THREE.Scene();
    env = new EnvironmentManager(scene);
    camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  });

  function aimCameraAtJellyfish(index: number): void {
    scene.updateMatrixWorld(true);
    const bellPos = env.jellyfish[index].userData.bell.getWorldPosition(new THREE.Vector3());
    // 水母 bell 是上半球，赤道面(y=0)擦边可能不命中，瞄准球心略上方
    const aim = bellPos.clone().add(new THREE.Vector3(0, 0.25, 0));
    camera.position.copy(aim).add(new THREE.Vector3(0, 0, 2));
    camera.lookAt(aim);
    camera.updateMatrixWorld(true);
  }

  function pointCameraAtEmptySky(): void {
    camera.position.set(0, 200, 0);
    camera.lookAt(0, 300, 0);
    camera.updateMatrixWorld(true);
  }

  function hoverFrames(n: number): void {
    for (let i = 0; i < n; i++) env.checkJellyfishHover(camera);
  }

  it('悬停时水母膨胀趋向基准 1.5 倍且光强趋向翻倍', () => {
    const baseScale = env.jellyfish[0].scale.x;
    aimCameraAtJellyfish(0);
    // 鼠标移到屏幕中心 -> 射线正对目标水母
    fakeWindow.dispatch('mousemove', {
      clientX: fakeWindow.innerWidth / 2,
      clientY: fakeWindow.innerHeight / 2,
    });
    hoverFrames(200);

    expect(env.jellyfish[0].scale.x).toBeGreaterThan(baseScale * 1.45);
    expect(env.jellyfish[0].scale.x).toBeLessThanOrEqual(baseScale * 1.5 + 1e-6);
    expect(env.jellyfishLights[0].intensity).toBeGreaterThan(0.95);
    expect(env.jellyfishLights[0].intensity).toBeLessThanOrEqual(1.0 + 1e-6);
  });

  it('鼠标移出后缩放与光强收敛回基准值', () => {
    const baseScale = env.jellyfish[0].scale.x;
    aimCameraAtJellyfish(0);
    fakeWindow.dispatch('mousemove', {
      clientX: fakeWindow.innerWidth / 2,
      clientY: fakeWindow.innerHeight / 2,
    });
    hoverFrames(200);
    expect(env.jellyfish[0].scale.x).toBeGreaterThan(baseScale * 1.45);
    expect(env.jellyfishLights[0].intensity).toBeGreaterThan(0.95);

    // 相机转向空旷天空，射线不再命中任何水母
    pointCameraAtEmptySky();
    hoverFrames(400);

    // 完全回到基准值（恢复逻辑收敛后会精确吸附）
    expect(env.jellyfish[0].scale.x).toBeCloseTo(baseScale, 5);
    expect(env.jellyfishLights[0].intensity).toBeCloseTo(0.5, 5);
  });

  it('悬停目标从场景移除后恢复流程安全退出', () => {
    const baseScale = env.jellyfish[0].scale.x;
    aimCameraAtJellyfish(0);
    fakeWindow.dispatch('mousemove', {
      clientX: fakeWindow.innerWidth / 2,
      clientY: fakeWindow.innerHeight / 2,
    });
    hoverFrames(50);
    expect(env.jellyfish[0].scale.x).toBeGreaterThan(baseScale * 1.1);

    // 目标消失：从管理器与场景中移除
    const removed = env.jellyfish.shift()!;
    scene.remove(removed);
    pointCameraAtEmptySky();
    expect(() => hoverFrames(50)).not.toThrow();
    // 其余水母不受影响
    for (const light of env.jellyfishLights.slice(1)) {
      expect(Number.isFinite(light.intensity)).toBe(true);
    }
  });
});
