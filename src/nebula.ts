import * as THREE from 'three';
import { copyParams, type NebulaParams } from './params.ts';
import {
  applyHue,
  applyParams,
  applyParticleCount,
  applyRadius,
  createBuffers,
  generateBaseData,
  MAX_PARTICLES,
  type ParticleBaseData,
  type ParticleBuffers
} from './particles.ts';
import {
  advanceAnimation,
  createAnimationState,
  type AnimationState
} from './animation.ts';

export type { NebulaParams } from './params.ts';

interface NebulaUserData {
  params: NebulaParams;
  baseData: ParticleBaseData;
  buffers: ParticleBuffers;
  animation: AnimationState;
  maxParticles: number;
}

function userDataOf(points: THREE.Points): NebulaUserData {
  return points.userData as unknown as NebulaUserData;
}

function createParticleTexture(): THREE.Texture {
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

const vertexShader = `
  attribute float alpha;
  attribute float particleSize;
  attribute float phase;
  attribute vec3 color;
  uniform float uTime;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float wave = sin(uTime * 2.0 + phase) * 0.15;
    vAlpha = clamp(alpha + wave, 0.3, 1.0);
    vColor = color;
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

export function createNebula(params: NebulaParams): THREE.Points {
  const baseData = generateBaseData(MAX_PARTICLES);
  const buffers = createBuffers(baseData);

  applyParticleCount(buffers, baseData, params.particleCount, params.radius);
  applyRadius(buffers, baseData, params.radius);
  applyHue(buffers, baseData, params.hueOffset);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(buffers.alphas, 1));
  geometry.setAttribute('particleSize', new THREE.BufferAttribute(buffers.sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(buffers.phases, 1));
  geometry.setDrawRange(0, buffers.drawRange);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      pointTexture: { value: createParticleTexture() },
      uTime: { value: 0 }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const points = new THREE.Points(geometry, material);
  const userData: NebulaUserData = {
    params: copyParams(params),
    baseData,
    buffers,
    animation: createAnimationState(),
    maxParticles: MAX_PARTICLES
  };
  points.userData = userData as unknown as typeof points.userData;

  return points;
}

export function updateNebula(points: THREE.Points, params: NebulaParams): void {
  const userData = userDataOf(points);
  const geometry = points.geometry;
  const changed = applyParams(userData.buffers, userData.baseData, userData.params, params);

  if (changed.includes('radius') || changed.includes('particleCount')) {
    geometry.attributes.position.needsUpdate = true;
  }
  if (changed.includes('hueOffset') || changed.includes('particleCount')) {
    geometry.attributes.color.needsUpdate = true;
  }
  if (changed.includes('particleCount')) {
    geometry.setDrawRange(0, userData.buffers.drawRange);
  }

  userData.params = copyParams(params);
}

export function disposeNebula(points: THREE.Points): void {
  const geometry = points.geometry;
  const material = points.material as THREE.ShaderMaterial;

  geometry.dispose();
  if (material.uniforms.pointTexture?.value) {
    material.uniforms.pointTexture.value.dispose();
  }
  material.dispose();
}

export function animateNebula(points: THREE.Points, delta: number): void {
  const userData = userDataOf(points);

  advanceAnimation(
    userData.animation,
    delta,
    userData.params.rotationSpeed,
    performance.now() * 0.001
  );

  points.rotation.y = userData.animation.rotationAngle;
  (points.material as THREE.ShaderMaterial).uniforms.uTime.value = userData.animation.time;
}
