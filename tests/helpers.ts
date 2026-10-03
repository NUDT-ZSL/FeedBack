// 离线测试基础设施：DOM 桩、确定性随机源、双星系统工厂。
// 所有测试在无浏览器、无网络环境下通过 `node --test` 运行。

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let domInstalled = false;

export function installDomStub(): void {
  if (domInstalled) return;
  domInstalled = true;

  const makeContext2d = () => ({
    fillStyle: '',
    font: '',
    textAlign: '',
    fillText: () => {},
    fillRect: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} })
  });

  const g = globalThis as Record<string, unknown>;
  g.document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext: () => makeContext2d() };
      }
      return {};
    }
  };
}

installDomStub();

import * as THREE from 'three';
import { Star } from '../src/star.ts';
import type { StarConfig } from '../src/star.ts';
import { Orbit } from '../src/orbit.ts';

export interface BinarySystem {
  primary: Star;
  secondary: Star;
  primaryOrbit: Orbit;
  secondaryOrbit: Orbit;
  setStarDistance: (distance: number) => void;
}

export interface SystemOptions {
  seed?: number;
  starDistance?: number;
  primaryMass?: number;
  secondaryMass?: number;
  primarySMA?: number;
  secondarySMA?: number;
  inclination?: number;
}

export function createBinarySystem(options: SystemOptions = {}): BinarySystem {
  const {
    seed = 1,
    starDistance = 30,
    primaryMass = 3,
    secondaryMass = 1.5,
    primarySMA = 4,
    secondarySMA = 3,
    inclination = (30 * Math.PI) / 180
  } = options;

  const random = mulberry32(seed);

  const makeStar = (name: string, mass: number, x: number): Star => {
    const config: StarConfig = {
      name,
      mass,
      baseRadius: 1,
      color: 0xffd700,
      temperature: 5778,
      planetColor: 0x00ced1,
      position: new THREE.Vector3(x, 0, 0)
    };
    return new Star(config);
  };

  const primary = makeStar('primary', primaryMass, -starDistance / 2);
  const secondary = makeStar('secondary', secondaryMass, starDistance / 2);

  const primaryOrbit = new Orbit(primary, secondary, primarySMA, inclination, random);
  const secondaryOrbit = new Orbit(secondary, primary, secondarySMA, -inclination, random);

  return {
    primary,
    secondary,
    primaryOrbit,
    secondaryOrbit,
    setStarDistance: (distance: number) => {
      primary.group.position.set(-distance / 2, 0, 0);
      secondary.group.position.set(distance / 2, 0, 0);
    }
  };
}

export function runFrames(orbit: Orbit, frames: number, deltaTime: number, speedMultiplier: number): void {
  for (let i = 0; i < frames; i++) {
    orbit.update(deltaTime, speedMultiplier);
  }
}

export function settle(orbit: Orbit, deltaTime = 0.1, frames = 400): void {
  runFrames(orbit, frames, deltaTime, 0);
}

export function expectedPeriod(mass: number, semiMajorAxis: number): number {
  return Math.sqrt((semiMajorAxis ** 3) / Math.max(mass, 0.1)) * 2;
}

export function expectedSemiMajorAxis(baseSMA: number, mass: number): number {
  return baseSMA * (1 + (mass - 3) * 0.08);
}

export function ellipseRadius(semiMajorAxis: number, eccentricity: number, angle: number): number {
  return (semiMajorAxis * (1 - eccentricity * eccentricity)) / (1 + eccentricity * Math.cos(angle));
}

export function isFiniteVector(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
