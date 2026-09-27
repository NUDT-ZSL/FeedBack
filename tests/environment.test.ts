import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EnvironmentManager } from '../src/environment';
import { step, dispatchMouseMove, makeCamera } from './helpers';

function makeEnv(): EnvironmentManager {
  return new EnvironmentManager(new THREE.Scene());
}

describe('EnvironmentManager 水质参数联动', () => {
  it('光照强度联动环境光与方向光', () => {
    const env = makeEnv();
    env.setLightIntensity(100);
    expect(env.ambientLight.intensity).toBeCloseTo(0.5);
    expect(env.directionalLight.intensity).toBeCloseTo(1.0);
    env.setLightIntensity(0);
    expect(env.ambientLight.intensity).toBeCloseTo(0);
    expect(env.directionalLight.intensity).toBeCloseTo(0);
    expect(env.params.lightIntensity).toBe(0);
  });

  it('浑浊度联动雾密度与粒子透明度', () => {
    const env = makeEnv();
    env.setTurbidity(0);
    const fog = env.scene.fog as THREE.FogExp2;
    expect(fog.density).toBeCloseTo(0.01);
    expect((env.waterParticles.material as THREE.PointsMaterial).opacity).toBeCloseTo(0.4);

    env.setTurbidity(100);
    expect(fog.density).toBeCloseTo(0.06);
    // 0.4 - 0.3 = 0.1，被下限 0.2 截断
    expect((env.waterParticles.material as THREE.PointsMaterial).opacity).toBeCloseTo(0.2);
  });

  it('参数取最小/最大值时下游计算不出现 NaN 或越界', () => {
    const env = makeEnv();
    for (const v of [0, 100]) {
      env.setLightIntensity(v);
      env.setTurbidity(v);
      env.setTemperature(v === 0 ? 15 : 35);
      step(30, 1 / 60, (d, t) => env.update(d, t));
      const fog = env.scene.fog as THREE.FogExp2;
      expect(Number.isFinite(fog.density)).toBe(true);
      const opacity = (env.waterParticles.material as THREE.PointsMaterial).opacity;
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
      expect(Number.isFinite(env.ambientLight.intensity)).toBe(true);
      expect(Number.isFinite(env.directionalLight.intensity)).toBe(true);
    }
  });
});

describe('水母悬停高亮', () => {
  function aimCameraAtJellyfish(env: EnvironmentManager, index: number) {
    const jf = env.jellyfish[index];
    jf.position.set(0, 10, 0);
    jf.userData.baseY = 10;
    // 其余水母移到远处，避免随机位置遮挡目标水母
    env.jellyfish.forEach((other, i) => {
      if (i !== index) {
        other.position.set(200 + i * 10, 100, 200);
        other.userData.baseY = 100;
      }
    });
    // 注意：水母钟体是上半球，赤道面恰好位于 group 原点高度，
    // 若射线恰好过中心高度会与赤道三角形共面而漏检（浮点退化），
    // 因此瞄准中心略上方，保证射线穿过半球内部。
    const camera = makeCamera();
    camera.position.set(0, 10.3, 5);
    camera.lookAt(0, 10.3, 0);
    camera.updateMatrixWorld(true);
    // 无渲染循环时需手动刷新场景图矩阵，射线检测依赖 matrixWorld
    env.scene.updateMatrixWorld(true);
    return camera;
  }

  it('悬停进入时缩放与光强趋向 1.5 倍 / 2 倍，移出后回到基准', () => {
    const env = makeEnv();
    const camera = aimCameraAtJellyfish(env, 0);
    const baseScale = env.jellyfish[0].scale.x;
    const baseIntensity = env.jellyfishLights[0].intensity;

    // 鼠标移到屏幕中心 -> 悬停，应收敛到 1.5 倍缩放 / 2 倍光强
    dispatchMouseMove(window.innerWidth / 2, window.innerHeight / 2);
    step(120, 1 / 60, () => env.checkJellyfishHover(camera));
    expect(env.jellyfish[0].scale.x).toBeGreaterThan(baseScale * 1.4);
    expect(env.jellyfishLights[0].intensity).toBeGreaterThan(baseIntensity * 1.8);

    // 鼠标移到角落 -> 无命中，应退出高亮
    dispatchMouseMove(1, 1);
    step(300, 1 / 60, () => env.checkJellyfishHover(camera));
    expect(env.jellyfish[0].scale.x).toBeCloseTo(baseScale, 2);
    expect(env.jellyfishLights[0].intensity).toBeCloseTo(baseIntensity, 2);
  });

  it('未悬停时缩放与光强保持基准', () => {
    const env = makeEnv();
    const camera = aimCameraAtJellyfish(env, 0);
    const baseScale = env.jellyfish[1].scale.x;
    dispatchMouseMove(1, 1);
    step(60, 1 / 60, () => env.checkJellyfishHover(camera));
    expect(env.jellyfish[1].scale.x).toBeCloseTo(baseScale, 5);
  });
});
