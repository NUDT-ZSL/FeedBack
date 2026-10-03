import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_WATER_PARAMS } from '../src/environment';
import { CameraController } from '../src/cameraController';
import { createSimulation, advance, FIXED_DT } from './harness';

describe('集成链路 - 整体重置一致性', () => {
  it('修改参数并推进模拟后，整体重置使各模块回到初始一致状态', () => {
    const sim = createSimulation();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const cameraController = new CameraController(camera);

    sim.environment.setTemperature(35);
    sim.environment.setLightIntensity(0);
    sim.environment.setTurbidity(100);
    for (const fish of sim.fishManager.fishes) {
      fish.startGathering(new THREE.Vector3(1, 2, 3));
    }
    sim.fishManager.toggleSchoolSize();
    cameraController.zoom(100000);
    cameraController.beginDrag(0, 0);
    cameraController.drag(500, 500);
    cameraController.endDrag();
    advance(sim, 10);

    sim.environment.reset();
    sim.coralManager.reset();
    sim.fishManager.reset(sim.coralManager.getClusterCenters());
    cameraController.reset();

    expect(sim.environment.params).toEqual(DEFAULT_WATER_PARAMS);
    expect(sim.coralManager.coralCount).toBe(54);
    expect(sim.coralManager.corals.every((c) => c.growthTime === 0)).toBe(true);
    expect(sim.fishManager.fishCount).toBe(30);
    expect(sim.fishManager.smallSchool).toBe(false);
    expect(sim.fishManager.fishes.every((f) => !f.isGathering && f.gatherTarget === null)).toBe(true);
    expect(cameraController.cameraAngle).toBe(0);
    expect(cameraController.cameraHeight).toBe(20);
    expect(cameraController.cameraDistance).toBe(40);

    advance(sim, 10, FIXED_DT, (s) => {
      for (const fish of s.fishManager.fishes) {
        expect(fish.position.y).toBeGreaterThanOrEqual(0.5);
        expect(fish.position.y).toBeLessThanOrEqual(20);
      }
      for (const coral of s.coralManager.corals) {
        expect(coral.currentHeight).toBeLessThanOrEqual(coral.baseHeight + 1e-9);
      }
    });
    expect(sim.coralManager.corals.every((c) => c.currentHeight > 0)).toBe(true);
  });
});
