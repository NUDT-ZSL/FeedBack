import * as THREE from 'three';
import { EnvironmentManager } from '../src/environment';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';

export const FIXED_DT = 1 / 60;

export interface Simulation {
  scene: THREE.Scene;
  environment: EnvironmentManager;
  coralManager: CoralManager;
  fishManager: FishManager;
  time: number;
}

export function createSimulation(): Simulation {
  const scene = new THREE.Scene();
  const environment = new EnvironmentManager(scene);
  const coralManager = new CoralManager(scene);
  const fishManager = new FishManager(scene, coralManager.getClusterCenters());
  return { scene, environment, coralManager, fishManager, time: 0 };
}

export function stepOnce(sim: Simulation, delta: number = FIXED_DT, fps: number = 60): void {
  sim.time += delta;
  const { temperature, turbidity, lightIntensity } = sim.environment.params;
  sim.environment.update(delta, sim.time);
  sim.coralManager.update(delta, sim.time, lightIntensity, temperature);
  sim.fishManager.update(delta, sim.time, temperature, turbidity, lightIntensity, fps);
}

export function advance(
  sim: Simulation,
  seconds: number,
  delta: number = FIXED_DT,
  onStep?: (sim: Simulation) => void
): void {
  const steps = Math.round(seconds / delta);
  for (let i = 0; i < steps; i++) {
    stepOnce(sim, delta);
    if (onStep) onStep(sim);
  }
}
