import * as THREE from 'three';

export interface NebulaParams {
  particleCount: number;
  hueOffset: number;
  radius: number;
  rotationSpeed: number;
}

interface NebulaUserData {
  params: NebulaParams;
  maxParticles: number;
  baseDirections: Float32Array;
  baseRadialT: Float32Array;
  recomputeRequested: boolean;
  recomputeIndex: number;
  recomputeParams: NebulaParams | null;
}

const RECOMPUTE_CHUNK_SIZE = 2048;

function getUserData(points: THREE.Points): NebulaUserData {
  return (points as THREE.Points & { userData: NebulaUserData }).userData;
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

function hslToRgb(h: number, s: number, l: number): THREE.Color {
  return new THREE.Color().setHSL(h / 360, s / 100, l / 100);
}

function lerpColor(color1: THREE.Color, color2: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().lerpColors(color1, color2, t);
}

function applyParamsToRange(
  points: THREE.Points,
  params: NebulaParams,
  start: number,
  end: number
): void {
  const userData = getUserData(points);
  const geometry = points.geometry;
  const positions = geometry.attributes.position.array as Float32Array;
  const colors = geometry.attributes.color.array as Float32Array;
  const distances = geometry.attributes.distance.array as Float32Array;
  const directions = userData.baseDirections;
  const radialT = userData.baseRadialT;

  const innerRadius = params.radius * 0.7;
  const outerRadius = params.radius;
  const span = outerRadius - innerRadius;

  const centerColor = hslToRgb((20 + params.hueOffset) % 360, 100, 60);
  const outerColor = hslToRgb((250 + params.hueOffset) % 360, 80, 50);

  for (let i = start; i < end; i++) {
    const i3 = i * 3;
    const t = radialT[i];
    const r = innerRadius + t * span;

    positions[i3] = directions[i3] * r;
    positions[i3 + 1] = directions[i3 + 1] * r;
    positions[i3 + 2] = directions[i3 + 2] * r;
    distances[i] = r;

    const particleColor = lerpColor(centerColor, outerColor, t);
    colors[i3] = particleColor.r;
    colors[i3 + 1] = particleColor.g;
    colors[i3 + 2] = particleColor.b;
  }
}

function processPendingRecompute(points: THREE.Points): void {
  const userData = getUserData(points);

  if (userData.recomputeIndex < 0 && userData.recomputeRequested) {
    userData.recomputeRequested = false;
    userData.recomputeParams = { ...userData.params };
    userData.recomputeIndex = 0;
  }

  const params = userData.recomputeParams;
  if (userData.recomputeIndex < 0 || !params) {
    return;
  }

  const start = userData.recomputeIndex;
  const end = Math.min(start + RECOMPUTE_CHUNK_SIZE, userData.maxParticles);
  applyParamsToRange(points, params, start, end);

  const attributes = points.geometry.attributes;
  attributes.position.needsUpdate = true;
  attributes.color.needsUpdate = true;
  attributes.distance.needsUpdate = true;

  userData.recomputeIndex = end >= userData.maxParticles ? -1 : end;
}

export function createNebula(params: NebulaParams): THREE.Points {
  const { particleCount } = params;
  const maxParticles = 10000;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxParticles * 3);
  const colors = new Float32Array(maxParticles * 3);
  const alphas = new Float32Array(maxParticles);
  const sizes = new Float32Array(maxParticles);
  const distances = new Float32Array(maxParticles);
  const baseDirections = new Float32Array(maxParticles * 3);
  const baseRadialT = new Float32Array(maxParticles);

  for (let i = 0; i < maxParticles; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const sinPhi = Math.sin(phi);

    baseDirections[i * 3] = sinPhi * Math.cos(theta);
    baseDirections[i * 3 + 1] = sinPhi * Math.sin(theta);
    baseDirections[i * 3 + 2] = Math.cos(phi);
    baseRadialT[i] = Math.random();

    alphas[i] = 0.3 + Math.random() * 0.7;
    sizes[i] = 0.05 + Math.random() * 0.45;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('distance', new THREE.BufferAttribute(distances, 1));

  geometry.setDrawRange(0, particleCount);

  const texture = createParticleTexture();

  const vertexShader = `
    attribute float alpha;
    attribute float particleSize;
    attribute vec3 color;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
      vAlpha = alpha;
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

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      pointTexture: { value: texture }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  (material as THREE.ShaderMaterial & { userData: { time: number } }).userData = { time: 0 };

  const points = new THREE.Points(geometry, material);
  (points as unknown as THREE.Points & { userData: NebulaUserData }).userData = {
    params: { ...params },
    maxParticles,
    baseDirections,
    baseRadialT,
    recomputeRequested: false,
    recomputeIndex: -1,
    recomputeParams: null
  };

  applyParamsToRange(points, params, 0, maxParticles);

  return points;
}

export function updateNebula(points: THREE.Points, params: NebulaParams): void {
  const userData = getUserData(points);
  const oldParams = userData.params;

  if (oldParams.particleCount !== params.particleCount) {
    points.geometry.setDrawRange(0, params.particleCount);
  }

  userData.params = { ...params };

  if (oldParams.radius !== params.radius || oldParams.hueOffset !== params.hueOffset) {
    userData.recomputeRequested = true;
  }
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
  const userData = getUserData(points);
  points.rotation.y += userData.params.rotationSpeed * delta;

  const alphas = points.geometry.attributes.alpha.array as Float32Array;
  const count = points.geometry.drawRange.count;
  const time = performance.now() * 0.001;

  for (let i = 0; i < count; i++) {
    const baseAlpha = 0.3 + ((i * 0.618033988749895) % 1) * 0.7;
    const wave = Math.sin(time * 2 + i * 0.1) * 0.15;
    alphas[i] = Math.max(0.3, Math.min(1.0, baseAlpha + wave));
  }
  points.geometry.attributes.alpha.needsUpdate = true;

  processPendingRecompute(points);
}
