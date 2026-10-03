import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, resetWorld, FIXED_DT, HeadlessWorld } from './harness';

function expectWorldConsistent(world: HeadlessWorld): void {
  const { environment, coralManager, fishManager } = world;
  expect(fishManager.fishes).toHaveLength(fishManager.fishCount);
  expect(coralManager.corals).toHaveLength(coralManager.coralCount);
  for (const fish of fishManager.fishes) {
    expect(Number.isFinite(fish.position.x)).toBe(true);
    expect(Number.isFinite(fish.position.y)).toBe(true);
    expect(Number.isFinite(fish.position.z)).toBe(true);
    expect(fish.position.x).toBeGreaterThanOrEqual(-30);
    expect(fish.position.x).toBeLessThanOrEqual(30);
    expect(fish.position.y).toBeGreaterThanOrEqual(0.5);
    expect(fish.position.y).toBeLessThanOrEqual(20);
    expect(fish.position.z).toBeGreaterThanOrEqual(-30);
    expect(fish.position.z).toBeLessThanOrEqual(30);
  }
  for (const coral of coralManager.corals) {
    expect(coral.currentHeight).toBeLessThanOrEqual(coral.baseHeight + 1e-9);
    expect(coral.currentHeight).toBeGreaterThanOrEqual(0);
  }
  for (const jf of environment.jellyfish) {
    expect(Math.abs(jf.position.y - jf.userData.baseY)).toBeLessThanOrEqual(1 + 1e-9);
  }
}

describe('模拟推进与状态收敛 (integration)', () => {
  it('初始世界状态一致：30 鱼 / 54 珊瑚 / 20 水母 / 默认水质参数', () => {
    const world = createWorld();
    expect(world.fishManager.fishCount).toBe(30);
    expect(world.coralManager.coralCount).toBe(54);
    expect(world.environment.jellyfish).toHaveLength(20);
    expect(world.environment.params).toEqual({ temperature: 25, lightIntensity: 80, turbidity: 10 });
  });

  it('固定时间步推进 30 秒：各模块状态始终保持一致且不发散', () => {
    const world = createWorld();
    for (let second = 0; second < 30; second++) {
      stepWorld(world, FIXED_DT, 60);
      expectWorldConsistent(world);
    }
  });

  it('参数推到极端值后推进 20 秒，状态仍收敛在合法范围', () => {
    const world = createWorld();
    world.environment.setTemperature(35);
    world.environment.setLightIntensity(0);
    world.environment.setTurbidity(100);
    stepWorld(world, FIXED_DT, 20 * 60);
    expectWorldConsistent(world);

    world.environment.setTemperature(15);
    world.environment.setLightIntensity(100);
    world.environment.setTurbidity(0);
    stepWorld(world, FIXED_DT, 20 * 60);
    expectWorldConsistent(world);
  });

  it('完整重置链路：参数扰动+数量切换+生长推进后，重置回到初始一致状态', () => {
    const world = createWorld();

    world.environment.setTemperature(33);
    world.environment.setLightIntensity(20);
    world.environment.setTurbidity(85);
    world.fishManager.toggleSchoolSize();
    world.cameraController.beginDrag(world.time);
    world.cameraController.applyDrag(400, 300, world.time);
    world.cameraController.applyZoom(500, world.time);
    world.cameraController.endDrag(world.time);
    stepWorld(world, FIXED_DT, 10 * 60);

    resetWorld(world);

    expect(world.environment.params.temperature).toBe(25);
    expect(world.environment.params.lightIntensity).toBe(80);
    expect(world.environment.params.turbidity).toBe(10);
    expect(world.environment.ambientLight.intensity).toBeCloseTo(0.4, 10);
    expect(world.environment.directionalLight.intensity).toBeCloseTo(0.8, 10);

    expect(world.coralManager.coralCount).toBe(54);
    for (const coral of world.coralManager.corals) {
      expect(coral.growthTime).toBe(0);
      expect(coral.currentHeight).toBe(0);
    }

    expect(world.fishManager.fishCount).toBe(30);
    expect(world.fishManager.smallSchool).toBe(false);
    for (const fish of world.fishManager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }

    const cam = world.cameraController;
    expect(cam.cameraAngle).toBe(0);
    expect(cam.cameraHeight).toBe(20);
    expect(cam.cameraDistance).toBe(40);
    expect(cam.autoRotatePhase).toBe(0);

    stepWorld(world, FIXED_DT, 5 * 60);
    expectWorldConsistent(world);
  });

  it('鱼群数量切换往返端到端：推进中切换再切回，数量与聚集状态收敛', () => {
    const world = createWorld();
    stepWorld(world, FIXED_DT, 3 * 60);

    world.fishManager.toggleSchoolSize();
    stepWorld(world, FIXED_DT, 3 * 60);
    expect(world.fishManager.fishCount).toBe(15);
    expect(world.fishManager.fishes).toHaveLength(15);

    world.fishManager.toggleSchoolSize();
    stepWorld(world, FIXED_DT, 3 * 60);
    expect(world.fishManager.fishCount).toBe(30);
    expect(world.fishManager.fishes).toHaveLength(30);

    for (const fish of world.fishManager.fishes) {
      expect(fish.isGathering).toBe(false);
      expect(fish.gatherTarget).toBeNull();
    }
    expectWorldConsistent(world);
  });

  it('重置后再次推进，珊瑚重新生长且相机恢复自动旋转', () => {
    const world = createWorld();
    stepWorld(world, FIXED_DT, 8 * 60);
    resetWorld(world);

    stepWorld(world, FIXED_DT, 10 * 60);
    for (const coral of world.coralManager.corals) {
      expect(coral.currentHeight).toBeGreaterThan(0);
    }
    expect(world.cameraController.autoRotatePhase).toBeGreaterThan(0);
    expectWorldConsistent(world);
  });
});
