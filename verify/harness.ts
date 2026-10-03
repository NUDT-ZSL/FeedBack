/**
 * 离线确定性 harness。
 *
 * 用 DOM 桩构造真实的 SolarSystem，并以固定 delta 逐帧驱动
 * updateSolarSystem + FocusController —— 调用顺序与 main.ts 的
 * 帧循环完全一致，但不经过 requestAnimationFrame / WebGL，
 * 因此每次运行的结果完全可复现。
 */

import * as THREE from 'three';
import { installDomStubs } from './domStubs';
import {
  createSolarSystem,
  updateSolarSystem,
  getPlanetFocusPosition,
  type SolarSystem,
  type PlanetObject
} from '../src/solarSystem';
import { FocusController, orbitPosition } from '../src/motionCore';

export interface Harness {
  system: SolarSystem;
  camera: THREE.PerspectiveCamera;
  controlsTarget: THREE.Vector3;
  focus: FocusController;
  /** 推进一帧；参数对应 UI 状态（速度倍率、轨道环显隐）。 */
  step: (delta: number, speedMultiplier: number, showOrbits: boolean) => void;
  /** 推进 n 帧。 */
  stepFrames: (n: number, delta: number, speedMultiplier: number, showOrbits: boolean) => void;
  /** 模拟 UI 的“聚焦行星”动作（与 main.ts 的 onFocus 回调一致）。 */
  triggerFocus: (planetName: string) => boolean;
  planetByName: (name: string) => PlanetObject;
}

export function createHarness(): Harness {
  installDomStubs();

  const scene = new THREE.Scene();
  const uiContainer = document.createElement('div') as unknown as HTMLElement;
  const system = createSolarSystem(scene, uiContainer);

  // 初始角度在 createSolarSystem 中是随机的；为了可复现，统一归零并同步位置。
  system.planets.forEach((planet) => {
    planet.angle = 0;
    const pos = orbitPosition(planet.data.distance, 0);
    planet.mesh.position.set(pos.x, pos.y, pos.z);
  });

  const camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 0.1, 1000);
  camera.position.set(0, 30, 80);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const controlsTarget = new THREE.Vector3(0, 0, 0);
  const focus = new FocusController();

  function step(delta: number, speedMultiplier: number, showOrbits: boolean): void {
    updateSolarSystem(system, delta, speedMultiplier, camera, showOrbits);

    const focusedPlanet = system.planets.find(p => p.data.name === focus.planetName);
    focus.update(
      delta,
      camera.position,
      controlsTarget,
      focusedPlanet ? focusedPlanet.mesh.position : null
    );

    camera.updateMatrixWorld();
  }

  function stepFrames(n: number, delta: number, speedMultiplier: number, showOrbits: boolean): void {
    for (let i = 0; i < n; i++) {
      step(delta, speedMultiplier, showOrbits);
    }
  }

  function triggerFocus(planetName: string): boolean {
    const target = getPlanetFocusPosition(system, planetName, camera);
    if (!target) return false;
    focus.startFocus(target, planetName);
    const planet = system.planets.find(p => p.data.name === planetName);
    if (planet) {
      controlsTarget.copy(planet.mesh.position);
    }
    return true;
  }

  function planetByName(name: string): PlanetObject {
    const planet = system.planets.find(p => p.data.name === name);
    if (!planet) throw new Error(`未知行星: ${name}`);
    return planet;
  }

  return {
    system,
    camera,
    controlsTarget,
    focus,
    step,
    stepFrames,
    triggerFocus,
    planetByName
  };
}
