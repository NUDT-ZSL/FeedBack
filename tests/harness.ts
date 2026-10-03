import * as THREE from 'three';
import { EnvironmentManager } from '../src/environment';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';
import { CameraController } from '../src/cameraController';

export const FIXED_DT = 1 / 60;

export interface HeadlessWorld {
  scene: THREE.Scene;
  environment: EnvironmentManager;
  coralManager: CoralManager;
  fishManager: FishManager;
  cameraController: CameraController;
  time: number;
}

export function createWorld(): HeadlessWorld {
  const scene = new THREE.Scene();
  const environment = new EnvironmentManager(scene);
  const coralManager = new CoralManager(scene);
  const clusterCenters = coralManager.getClusterCenters();
  const fishManager = new FishManager(scene, clusterCenters);
  const cameraController = new CameraController();
  return { scene, environment, coralManager, fishManager, cameraController, time: 0 };
}

export function stepWorld(world: HeadlessWorld, delta: number = FIXED_DT, steps: number = 1): void {
  for (let i = 0; i < steps; i++) {
    world.time += delta;
    const env = world.environment;
    world.cameraController.update(delta, world.time);
    env.update(delta, world.time);
    world.coralManager.update(delta, world.time, env.params.lightIntensity, env.params.temperature);
    world.fishManager.update(
      delta,
      world.time,
      env.params.temperature,
      env.params.turbidity,
      env.params.lightIntensity,
      60
    );
  }
}

export function resetWorld(world: HeadlessWorld): void {
  world.coralManager.reset();
  const clusterCenters = world.coralManager.getClusterCenters();
  world.fishManager.reset(clusterCenters);
  world.environment.setTemperature(25);
  world.environment.setLightIntensity(80);
  world.environment.setTurbidity(10);
  world.cameraController.reset();
}
