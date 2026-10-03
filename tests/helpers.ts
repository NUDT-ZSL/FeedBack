// 测试辅助：构造真实 Star/Orbit 对象、推进固定帧、读取内部轨道参数。
import * as THREE from 'three';
import { Star, StarConfig } from '../src/star';
import { Orbit, OrbitParams } from '../src/orbit';

export interface FakeStar {
  group: THREE.Group;
  planet: THREE.Mesh;
  planetGlow: THREE.Mesh;
  config: { mass: number };
}

// 仅含 Orbit 运行所需字段的轻量恒星桩，用于把双星距离作为可控输入。
export function makeFakeStar(x: number, y = 0, z = 0, mass = 3): FakeStar {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  return {
    group,
    planet: new THREE.Mesh(),
    planetGlow: new THREE.Mesh(),
    config: { mass }
  };
}

export function makeStarConfig(mass: number, x = 0): StarConfig {
  return {
    name: 'test-star',
    mass,
    baseRadius: 1.5,
    color: 0xffd700,
    temperature: 5778,
    planetColor: 0x00ced1,
    position: new THREE.Vector3(x, 0, 0)
  };
}

export function makeRealStar(mass: number, x = 0): Star {
  return new Star(makeStarConfig(mass, x));
}

export function makeOrbit(
  semiMajorAxis = 4,
  inclination = Math.PI / 6,
  starMass = 3,
  starX = -1000,
  otherX = 1000
): { orbit: Orbit; star: FakeStar; other: FakeStar } {
  const star = makeFakeStar(starX);
  const other = makeFakeStar(otherX);
  const orbit = new Orbit(
    star as unknown as Star,
    other as unknown as Star,
    semiMajorAxis,
    inclination
  );
  orbit.updateMass(starMass);
  return { orbit, star, other };
}

// 读取 Orbit 私有状态（测试专用，不改动生产 API）。
export function getParams(orbit: Orbit): OrbitParams {
  return (orbit as unknown as { params: OrbitParams }).params;
}

export function getTargetParams(orbit: Orbit): OrbitParams {
  return (orbit as unknown as { targetParams: OrbitParams }).targetParams;
}

export function getPerturbation(orbit: Orbit): number {
  return (orbit as unknown as { perturbationAmount: number }).perturbationAmount;
}

export function setTrueAnomaly(orbit: Orbit, value: number): void {
  (orbit as unknown as { params: OrbitParams }).params.trueAnomaly = value;
}

export function setEccentricity(orbit: Orbit, value: number): void {
  const o = orbit as unknown as { params: OrbitParams; targetParams: OrbitParams };
  o.params.eccentricity = value;
  o.targetParams.eccentricity = value;
}

export function step(orbit: Orbit, frames: number, dt: number, speed: number): void {
  for (let i = 0; i < frames; i++) {
    orbit.update(dt, speed);
  }
}

export function settle(orbit: Orbit, frames = 1200, dt = 1 / 60): void {
  step(orbit, frames, dt, 0);
}

export function planetPosition(orbit: Orbit): THREE.Vector3 {
  return orbit.star.planet.position;
}

export function vectorFinite(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function expectedSemiMajorAxis(base: number, mass: number): number {
  return base * (1 + (mass - 3) * 0.08);
}

export function expectedPeriod(mass: number, semiMajorAxis: number): number {
  return Math.sqrt((semiMajorAxis ** 3) / Math.max(mass, 0.1)) * 2;
}
