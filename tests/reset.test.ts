import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createFakeDocument } from './helpers';
import { EnvironmentManager } from '../src/environment';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';
import { CameraRig } from '../src/cameraRig';
import { resetReef } from '../src/reefReset';
import { updateHUD, DEFAULT_WATER_PARAMS } from '../src/hud';

/**
 * 跨模块重置链路：与 main.ts 的 resetEnvironment 走同一条 resetReef 路径，
 * 验证珊瑚 -> 鱼群(依赖新聚集中心) -> 水质参数 -> 相机 -> HUD 的完整闭环。
 */
describe('跨模块重置链路 (resetReef)', () => {
  let scene: THREE.Scene;
  let env: EnvironmentManager;
  let coralManager: CoralManager;
  let fishManager: FishManager;
  let rig: CameraRig;
  let doc: ReturnType<typeof createFakeDocument>;

  beforeEach(() => {
    scene = new THREE.Scene();
    env = new EnvironmentManager(scene);
    coralManager = new CoralManager(scene);
    fishManager = new FishManager(scene, coralManager.getClusterCenters());
    rig = new CameraRig();
    doc = createFakeDocument();
  });

  function dirtyEverything(): void {
    env.setTemperature(35);
    env.setLightIntensity(0);
    env.setTurbidity(100);
    coralManager.update(2, 2, 100, 35);
    fishManager.toggleSchoolSize();
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 0.1;
      fishManager.update(0.1, t, 35, 100, 0, 60);
    }
    rig.beginDrag(0, 0, 0);
    rig.dragTo(400, 300, 0.1);
    rig.zoom(500, 0.2);
    rig.endDrag(0.3);
    rig.update(1 / 60, 0.4);
  }

  function expectPristineState(): void {
    // 水质参数回到默认
    expect(env.params.temperature).toBe(DEFAULT_WATER_PARAMS.temperature);
    expect(env.params.lightIntensity).toBe(DEFAULT_WATER_PARAMS.lightIntensity);
    expect(env.params.turbidity).toBe(DEFAULT_WATER_PARAMS.turbidity);
    expect(env.ambientLight.intensity).toBeCloseTo(0.4, 10);
    expect(env.directionalLight.intensity).toBeCloseTo(0.8, 10);
    expect((scene.fog as THREE.FogExp2).density).toBeCloseTo(0.015, 10);

    // 珊瑚：数量不变、生长归零
    expect(coralManager.coralCount).toBe(54);
    for (const coral of coralManager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }

    // 鱼群：30 条、速度归零、不处于聚集态、围绕新的珊瑚聚集中心
    expect(fishManager.fishCount).toBe(30);
    expect(fishManager.fishes.length).toBe(30);
    expect(fishManager.smallSchool).toBe(false);
    const centers = coralManager.getClusterCenters();
    for (const fish of fishManager.fishes) {
      expect(fish.velocity.length()).toBe(0);
      expect(fish.isGathering).toBe(false);
      const matched = centers.some((c) => fish.clusterCenter.distanceTo(c) < 1e-6);
      expect(matched).toBe(true);
    }

    // 相机：目标值与实际值都回到初始
    expect(rig.angle).toBe(0);
    expect(rig.targetAngle).toBe(0);
    expect(rig.height).toBe(20);
    expect(rig.distance).toBe(40);
    expect(rig.autoRotatePhase).toBe(0);

    // HUD：水温回到默认显示
    expect(doc.text('water-temp')).toBe('25.0');
  }

  it('弄脏全部状态后一次重置恢复全链路基准', () => {
    dirtyEverything();
    expect(env.params.turbidity).toBe(100);
    expect(fishManager.fishCount).toBe(15);

    resetReef(env, coralManager, fishManager, rig, doc);
    expectPristineState();
  });

  it('连续 5 次重置后计数与场景图不累积', () => {
    resetReef(env, coralManager, fishManager, rig, doc);
    const sceneChildren = scene.children.length;
    const jellyfishCount = env.jellyfish.length;

    for (let i = 0; i < 5; i++) {
      dirtyEverything();
      resetReef(env, coralManager, fishManager, rig, doc);
      expectPristineState();
      expect(scene.children.length).toBe(sceneChildren);
      expect(env.jellyfish.length).toBe(jellyfishCount);
    }
  });

  it('重置后 HUD 统计与新管理器状态一致', () => {
    dirtyEverything();
    resetReef(env, coralManager, fishManager, rig, doc);
    updateHUD(doc, {
      fps: 60,
      fishCount: fishManager.fishCount,
      coralCount: coralManager.coralCount,
    });
    expect(doc.text('fish-count')).toBe('30');
    expect(doc.text('coral-count')).toBe('54');
    expect(doc.text('water-temp')).toBe('25.0');
  });
});
