import * as THREE from 'three';
import type { NebulaParams } from './params.ts';
import { MAX_PARTICLES } from './params.ts';
import { NebulaModel } from './model.ts';
import { NebulaAnimation } from './animation.ts';

export interface NebulaRendererOptions {
  maxParticles?: number;
  random?: () => number;
  createTexture?: () => THREE.Texture;
}

const vertexShader = `
  attribute float particleSize;
  attribute float particleIndex;
  attribute vec3 color;
  uniform float uTime;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vColor = color;
    float baseAlpha = 0.3 + fract(particleIndex * 0.618033988749895) * 0.7;
    float wave = sin(uTime * 2.0 + particleIndex * 0.1) * 0.15;
    vAlpha = clamp(baseAlpha + wave, 0.3, 1.0);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = particleSize * 300.0 / -mvPosition.z;
  }
`;

const fragmentShader = `
  uniform sampler2D pointTexture;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 texColor = texture2D(pointTexture, gl_PointCoord);
    gl_FragColor = vec4(vColor, texColor.a * vAlpha);
  }
`;

export function createParticleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class NebulaRenderer {
  readonly points: THREE.Points;
  readonly model: NebulaModel;
  private readonly animation = new NebulaAnimation();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly texture: THREE.Texture;

  constructor(params: NebulaParams, options: NebulaRendererOptions = {}) {
    this.model = new NebulaModel(
      params,
      options.maxParticles ?? MAX_PARTICLES,
      options.random
    );
    const maxParticles = this.model.maxParticles;

    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);
    const sizes = new Float32Array(maxParticles);
    const indices = new Float32Array(maxParticles);

    for (let i = 0; i < maxParticles; i++) {
      sizes[i] = this.model.sizeAt(i);
      indices[i] = i;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('particleIndex', new THREE.BufferAttribute(indices, 1));

    this.writePositionRange(0, params.particleCount);
    this.writeColorRange(0, params.particleCount);
    this.geometry.setDrawRange(0, params.particleCount);

    this.texture = options.createTexture
      ? options.createTexture()
      : createParticleTexture();

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        pointTexture: { value: this.texture },
        uTime: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.points = new THREE.Points(this.geometry, this.material);
  }

  applyParams(next: NebulaParams): void {
    const changed = this.model.setParams(next);
    if (changed.length === 0) {
      return;
    }

    const params = this.model.getParams();
    const previousCount = this.geometry.drawRange.count;
    const targetCount = params.particleCount;
    const radiusChanged = changed.includes('radius');
    const hueChanged = changed.includes('hueOffset');

    if (radiusChanged) {
      this.writePositionRange(0, targetCount);
      this.geometry.attributes.position.needsUpdate = true;
    } else if (targetCount > previousCount) {
      this.writePositionRange(previousCount, targetCount);
      this.geometry.attributes.position.needsUpdate = true;
    }

    if (hueChanged) {
      this.writeColorRange(0, targetCount);
      this.geometry.attributes.color.needsUpdate = true;
    } else if (targetCount > previousCount) {
      this.writeColorRange(previousCount, targetCount);
      this.geometry.attributes.color.needsUpdate = true;
    }

    if (previousCount !== targetCount) {
      this.geometry.setDrawRange(0, targetCount);
    }
  }

  tick(delta: number): void {
    this.animation.advance(delta, this.model.getParams().rotationSpeed);
    this.points.rotation.y = this.animation.rotation;
    this.material.uniforms.uTime.value = this.animation.time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
  }

  private writePositionRange(start: number, end: number): void {
    for (let i = start; i < end; i++) {
      const [x, y, z] = this.model.positionAt(i);
      const offset = i * 3;
      this.positions[offset] = x;
      this.positions[offset + 1] = y;
      this.positions[offset + 2] = z;
    }
  }

  private writeColorRange(start: number, end: number): void {
    for (let i = start; i < end; i++) {
      const [r, g, b] = this.model.colorAt(i);
      const offset = i * 3;
      this.colors[offset] = r;
      this.colors[offset + 1] = g;
      this.colors[offset + 2] = b;
    }
  }
}
