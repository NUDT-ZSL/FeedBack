import * as THREE from 'three';
import { ParticleData, PlanktonData } from '../data/OceanDataService';

const COLORS = {
  lowSpeed: new THREE.Color('#0a3d62'),
  midSpeed: new THREE.Color('#00b894'),
  highSpeed: new THREE.Color('#00cec9'),
  algae: new THREE.Color('#00ff88'),
  krill: new THREE.Color('#ff8c42'),
};

const SPEED_THRESHOLDS = {
  low: 0.5,
  high: 1.0,
};

const PARTICLE_SIZE_BASE = 0.15;
const PARTICLE_SIZE_MAX = 0.6;

export class ParticleSystem {
  private particleCount: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private trailPositions: Float32Array;
  private trailGeometry: THREE.BufferGeometry;
  private trailMaterial: THREE.PointsMaterial;
  private trailPoints: THREE.Points;

  private planktonGeometry: THREE.BufferGeometry;
  private planktonMaterial: THREE.PointsMaterial;
  private planktonPoints: THREE.Points;
  private planktonPositions: Float32Array;
  private planktonColors: Float32Array;
  private planktonSizes: Float32Array;

  constructor(particleCount: number, planktonCount: number) {
    this.particleCount = particleCount;

    this.positions = new Float32Array(particleCount * 3);
    this.colors = new Float32Array(particleCount * 3);
    this.sizes = new Float32Array(particleCount);

    this.trailPositions = new Float32Array(particleCount * 3);

    this.planktonPositions = new Float32Array(planktonCount * 3);
    this.planktonColors = new Float32Array(planktonCount * 3);
    this.planktonSizes = new Float32Array(planktonCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: PARTICLE_SIZE_BASE,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));

    this.trailMaterial = new THREE.PointsMaterial({
      size: PARTICLE_SIZE_BASE * 0.8,
      color: 0x00b894,
      transparent: true,
      opacity: 0.3,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.trailPoints = new THREE.Points(this.trailGeometry, this.trailMaterial);

    this.planktonGeometry = new THREE.BufferGeometry();
    this.planktonGeometry.setAttribute('position', new THREE.BufferAttribute(this.planktonPositions, 3));
    this.planktonGeometry.setAttribute('color', new THREE.BufferAttribute(this.planktonColors, 3));

    this.planktonMaterial = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
    });

    this.planktonPoints = new THREE.Points(this.planktonGeometry, this.planktonMaterial);
  }

  getPoints(): THREE.Points {
    return this.points;
  }

  getTrailPoints(): THREE.Points {
    return this.trailPoints;
  }

  getPlanktonPoints(): THREE.Points {
    return this.planktonPoints;
  }

  updateParticles(particles: ParticleData[], depthRange: [number, number]): void {
    for (let i = 0; i < particles.length && i < this.particleCount; i++) {
      const particle = particles[i];
      const idx = i * 3;

      this.trailPositions[idx] = this.positions[idx];
      this.trailPositions[idx + 1] = this.positions[idx + 1];
      this.trailPositions[idx + 2] = this.positions[idx + 2];

      this.positions[idx] = particle.position.x;
      this.positions[idx + 1] = particle.position.y;
      this.positions[idx + 2] = particle.position.z;

      const color = this.getSpeedColor(particle.speed);
      this.colors[idx] = color.r;
      this.colors[idx + 1] = color.g;
      this.colors[idx + 2] = color.b;

      const size = this.getSpeedSize(particle.speed);
      this.sizes[i] = size;

      const depthAlpha = this.getDepthAlpha(particle.depth, depthRange);
      this.material.opacity = 0.9;
      this.trailMaterial.opacity = 0.3 * depthAlpha;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.trailGeometry.attributes.position.needsUpdate = true;
  }

  updatePlankton(plankton: PlanktonData[], depthRange: [number, number]): void {
    for (let i = 0; i < plankton.length; i++) {
      const p = plankton[i];
      const idx = i * 3;

      this.planktonPositions[idx] = p.position.x;
      this.planktonPositions[idx + 1] = p.position.y;
      this.planktonPositions[idx + 2] = p.position.z;

      const color = p.type === 'algae' ? COLORS.algae : COLORS.krill;
      this.planktonColors[idx] = color.r;
      this.planktonColors[idx + 1] = color.g;
      this.planktonColors[idx + 2] = color.b;

      this.planktonSizes[i] = p.type === 'algae' ? 0.12 : 0.2;
    }

    this.planktonGeometry.attributes.position.needsUpdate = true;
    this.planktonGeometry.attributes.color.needsUpdate = true;
  }

  updateDepthOpacity(depthRange: [number, number]): void {
    this.material.opacity = 0.9;
    this.planktonMaterial.opacity = 0.85;
  }

  private getSpeedColor(speed: number): THREE.Color {
    const color = new THREE.Color();

    if (speed < SPEED_THRESHOLDS.low) {
      const t = speed / SPEED_THRESHOLDS.low;
      color.lerpColors(COLORS.lowSpeed, COLORS.midSpeed, t);
    } else if (speed < SPEED_THRESHOLDS.high) {
      const t = (speed - SPEED_THRESHOLDS.low) / (SPEED_THRESHOLDS.high - SPEED_THRESHOLDS.low);
      color.lerpColors(COLORS.midSpeed, COLORS.highSpeed, t);
    } else {
      color.copy(COLORS.highSpeed);
    }

    return color;
  }

  private getSpeedSize(speed: number): number {
    const normalizedSpeed = Math.min(speed / SPEED_THRESHOLDS.high, 1);
    return PARTICLE_SIZE_BASE + normalizedSpeed * (PARTICLE_SIZE_MAX - PARTICLE_SIZE_BASE);
  }

  private getDepthAlpha(depth: number, depthRange: [number, number]): number {
    const [minDepth, maxDepth] = depthRange;
    if (depth < minDepth || depth > maxDepth) {
      return 0;
    }
    const fadeRange = 5;
    if (depth < minDepth + fadeRange) {
      return (depth - minDepth) / fadeRange;
    }
    if (depth > maxDepth - fadeRange) {
      return (maxDepth - depth) / fadeRange;
    }
    return 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.planktonGeometry.dispose();
    this.planktonMaterial.dispose();
  }
}
