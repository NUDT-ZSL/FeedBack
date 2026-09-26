import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';

export type OceanRegion = 'northAtlantic' | 'equatorialPacific' | 'antarcticCircumpolar';

export interface ParticleData {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  depth: number;
}

export interface PlanktonData {
  id: string;
  type: 'algae' | 'krill';
  position: THREE.Vector3;
  density: number;
  depth: number;
}

export interface OceanStats {
  averageSpeed: number;
  surfaceTemperature: number;
  planktonDensity: number;
  salinity: number;
}

export interface OceanRegionData {
  particles: ParticleData[];
  plankton: PlanktonData[];
  stats: OceanStats;
  bounds: {
    width: number;
    height: number;
    depth: number;
  };
}

const REGION_CONFIGS: Record<OceanRegion, {
  width: number;
  height: number;
  depth: number;
  baseSpeed: number;
  temperature: number;
  salinity: number;
  planktonDensity: number;
  currentPattern: 'gyre' | 'equatorial' | 'circumpolar';
}> = {
  northAtlantic: {
    width: 40,
    height: 30,
    depth: 30,
    baseSpeed: 0.6,
    temperature: 12,
    salinity: 35.5,
    planktonDensity: 850,
    currentPattern: 'gyre',
  },
  equatorialPacific: {
    width: 50,
    height: 25,
    depth: 30,
    baseSpeed: 0.8,
    temperature: 27,
    salinity: 34.8,
    planktonDensity: 450,
    currentPattern: 'equatorial',
  },
  antarcticCircumpolar: {
    width: 45,
    height: 40,
    depth: 35,
    baseSpeed: 1.2,
    temperature: 2,
    salinity: 34.2,
    planktonDensity: 1200,
    currentPattern: 'circumpolar',
  },
};

const PARTICLE_COUNT = 3500;
const PLANKTON_COUNT = 1800;

export class OceanDataService {
  private cachedData: Partial<Record<OceanRegion, OceanRegionData>> = {};

  getRegionData(region: OceanRegion): OceanRegionData {
    if (this.cachedData[region]) {
      return this.cachedData[region]!;
    }

    const config = REGION_CONFIGS[region];
    const particles = this.generateParticles(config);
    const plankton = this.generatePlankton(config);
    const stats = this.calculateStats(particles, plankton, config);

    const data: OceanRegionData = {
      particles,
      plankton,
      stats,
      bounds: {
        width: config.width,
        height: config.height,
        depth: config.depth,
      },
    };

    this.cachedData[region] = data;
    return data;
  }

  private generateParticles(config: typeof REGION_CONFIGS[OceanRegion]): ParticleData[] {
    const particles: ParticleData[] = [];
    const { width, height, depth, baseSpeed, currentPattern } = config;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const x = (Math.random() - 0.5) * width;
      const y = (Math.random() - 0.5) * depth;
      const z = (Math.random() - 0.5) * height;

      const velocity = this.calculateVelocity(x, y, z, baseSpeed, currentPattern, depth);
      const speed = velocity.length();

      particles.push({
        id: uuidv4(),
        position: new THREE.Vector3(x, y, z),
        velocity,
        speed,
        depth: Math.abs(y) + Math.random() * 10,
      });
    }

    return particles;
  }

  private calculateVelocity(
    x: number,
    y: number,
    z: number,
    baseSpeed: number,
    pattern: string,
    maxDepth: number
  ): THREE.Vector3 {
    const depthFactor = 1 - Math.abs(y) / maxDepth * 0.7;
    const speed = baseSpeed * depthFactor * (0.7 + Math.random() * 0.6);

    let vx = 0;
    let vz = 0;

    switch (pattern) {
      case 'gyre': {
        const angle = Math.atan2(z, x);
        const radius = Math.sqrt(x * x + z * z);
        const spiralFactor = radius * 0.1;
        vx = -Math.sin(angle + spiralFactor) * speed;
        vz = Math.cos(angle + spiralFactor) * speed;
        break;
      }
      case 'equatorial': {
        const wave = Math.sin(x * 0.3 + z * 0.2) * 0.3;
        vx = speed * (0.8 + wave);
        vz = Math.sin(x * 0.2) * speed * 0.3;
        break;
      }
      case 'circumpolar': {
        const angle = Math.atan2(z, x);
        const radius = Math.sqrt(x * x + z * z);
        const speedVariation = Math.sin(radius * 0.2) * 0.3 + 0.7;
        vx = -Math.sin(angle) * speed * speedVariation;
        vz = Math.cos(angle) * speed * speedVariation;
        break;
      }
    }

    const vy = Math.sin(x * 0.2 + z * 0.3) * speed * 0.1;

    return new THREE.Vector3(vx, vy, vz);
  }

  private generatePlankton(config: typeof REGION_CONFIGS[OceanRegion]): PlanktonData[] {
    const plankton: PlanktonData[] = [];
    const { width, height, depth, planktonDensity } = config;

    const algaeCount = Math.floor(PLANKTON_COUNT * 0.6);
    const krillCount = PLANKTON_COUNT - algaeCount;

    for (let i = 0; i < algaeCount; i++) {
      const x = (Math.random() - 0.5) * width;
      const y = Math.random() * 10 - 2;
      const z = (Math.random() - 0.5) * height;

      const densityFactor = Math.max(0, 1 - Math.abs(y) / 15) * (0.5 + Math.random() * 0.5);

      plankton.push({
        id: uuidv4(),
        type: 'algae',
        position: new THREE.Vector3(x, y, z),
        density: planktonDensity * densityFactor,
        depth: Math.abs(y),
      });
    }

    for (let i = 0; i < krillCount; i++) {
      const x = (Math.random() - 0.5) * width;
      const y = -(8 + Math.random() * 15);
      const z = (Math.random() - 0.5) * height;

      const densityFactor = (0.4 + Math.random() * 0.6);

      plankton.push({
        id: uuidv4(),
        type: 'krill',
        position: new THREE.Vector3(x, y, z),
        density: planktonDensity * 0.6 * densityFactor,
        depth: Math.abs(y),
      });
    }

    return plankton;
  }

  private calculateStats(
    particles: ParticleData[],
    plankton: PlanktonData[],
    config: typeof REGION_CONFIGS[OceanRegion]
  ): OceanStats {
    const totalSpeed = particles.reduce((sum, p) => sum + p.speed, 0);
    const avgSpeed = totalSpeed / particles.length;

    const totalPlanktonDensity = plankton.reduce((sum, p) => sum + p.density, 0);
    const avgPlanktonDensity = totalPlanktonDensity / plankton.length;

    return {
      averageSpeed: Math.round(avgSpeed * 100) / 100,
      surfaceTemperature: config.temperature,
      planktonDensity: Math.round(avgPlanktonDensity),
      salinity: config.salinity,
    };
  }

  updateParticle(
    particle: ParticleData,
    delta: number,
    region: OceanRegion
  ): void {
    const config = REGION_CONFIGS[region];
    const { width, depth, height } = config;

    const newVelocity = this.calculateVelocity(
      particle.position.x,
      particle.position.y,
      particle.position.z,
      config.baseSpeed,
      config.currentPattern,
      depth
    );

    particle.velocity.lerp(newVelocity, 0.02);
    particle.position.add(particle.velocity.clone().multiplyScalar(delta * 5));
    particle.speed = particle.velocity.length();
    particle.depth = Math.abs(particle.position.y);

    const halfW = width / 2;
    const halfH = height / 2;
    const halfD = depth / 2;

    if (particle.position.x > halfW) particle.position.x = -halfW;
    if (particle.position.x < -halfW) particle.position.x = halfW;
    if (particle.position.z > halfH) particle.position.z = -halfH;
    if (particle.position.z < -halfH) particle.position.z = halfH;
    if (particle.position.y > halfD * 0.3) particle.position.y = -halfD * 0.8;
    if (particle.position.y < -halfD) particle.position.y = halfD * 0.2;
  }

  getRealTimeStats(region: OceanRegion, particles: ParticleData[]): OceanStats {
    const config = REGION_CONFIGS[region];
    const surfaceParticles = particles.filter(p => p.depth < 5);
    const avgSpeed = surfaceParticles.length > 0
      ? surfaceParticles.reduce((sum, p) => sum + p.speed, 0) / surfaceParticles.length
      : config.baseSpeed;

    const tempVariation = Math.sin(Date.now() / 5000) * 0.5;
    const densityVariation = Math.sin(Date.now() / 7000) * 50;

    return {
      averageSpeed: Math.round(avgSpeed * 100) / 100,
      surfaceTemperature: Math.round((config.temperature + tempVariation) * 10) / 10,
      planktonDensity: Math.round(config.planktonDensity + densityVariation),
      salinity: Math.round(config.salinity * 100) / 100,
    };
  }
}

export const oceanDataService = new OceanDataService();
