import * as THREE from 'three';

export interface NebulaParams {
  particleCount: number;
  hueOffset: number;
  radius: number;
  rotationSpeed: number;
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

interface NebulaUserData {
  params: NebulaParams;
  appliedParams: NebulaParams;
  pendingParams: NebulaParams | null;
  rebuildCursor: number;
  maxParticles: number;
  baseDirections: Float32Array;
  baseRadialT: Float32Array;
}

const REBUILD_CHUNK_SIZE = 1024;

function getUserData(points: THREE.Points): NebulaUserData {
  return (points as THREE.Points & { userData: NebulaUserData }).userData;
}

function applyParticleRange(
  positions: Float32Array,
  colors: Float32Array,
  distances: Float32Array,
  baseDirections: Float32Array,
  baseRadialT: Float32Array,
  hueOffset: number,
  radius: number,
  start: number,
  end: number
): void {
  const innerRadius = radius * 0.7;
  const span = radius - innerRadius;
  const centerColor = hslToRgb((20 + hueOffset) % 360, 100, 60);
  const outerColor = hslToRgb((250 + hueOffset) % 360, 80, 50);

  for (let i = start; i < end; i++) {
    const i3 = i * 3;
    const t = baseRadialT[i];
    const dist = innerRadius + t * span;

    positions[i3] = baseDirections[i3] * dist;
    positions[i3 + 1] = baseDirections[i3 + 1] * dist;
    positions[i3 + 2] = baseDirections[i3 + 2] * dist;
    distances[i] = dist;

    colors[i3] = centerColor.r + (outerColor.r - centerColor.r) * t;
    colors[i3 + 1] = centerColor.g + (outerColor.g - centerColor.g) * t;
    colors[i3 + 2] = centerColor.b + (outerColor.b - centerColor.b) * t;
  }
}

export function createNebula(params: NebulaParams): THREE.Points {
  const { particleCount, hueOffset, radius } = params;
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
    const t = Math.random();

    const sinPhi = Math.sin(phi);
    baseDirections[i * 3] = sinPhi * Math.cos(theta);
    baseDirections[i * 3 + 1] = sinPhi * Math.sin(theta);
    baseDirections[i * 3 + 2] = Math.cos(phi);
    baseRadialT[i] = t;

    alphas[i] = 0.3 + Math.random() * 0.7;
    sizes[i] = 0.05 + Math.random() * 0.45;
  }

  applyParticleRange(
    positions,
    colors,
    distances,
    baseDirections,
    baseRadialT,
    hueOffset,
    radius,
    0,
    maxParticles
  );

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
    appliedParams: { ...params },
    pendingParams: null,
    rebuildCursor: 0,
    maxParticles,
    baseDirections,
    baseRadialT
  };

  return points;
}

export function updateNebula(points: THREE.Points, params: NebulaParams): void {
  const userData = getUserData(points);
  const geometry = points.geometry;

  if (userData.params.particleCount !== params.particleCount) {
    geometry.setDrawRange(0, params.particleCount);
  }

  userData.params = { ...params };

  const reference = userData.pendingParams ?? userData.appliedParams;
  if (reference.radius !== params.radius || reference.hueOffset !== params.hueOffset) {
    userData.pendingParams = { ...params };
    userData.rebuildCursor = 0;
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

  if (userData.pendingParams) {
    const pending = userData.pendingParams;
    const geometry = points.geometry;
    const start = userData.rebuildCursor;
    const end = Math.min(start + REBUILD_CHUNK_SIZE, userData.maxParticles);

    applyParticleRange(
      geometry.attributes.position.array as Float32Array,
      geometry.attributes.color.array as Float32Array,
      geometry.attributes.distance.array as Float32Array,
      userData.baseDirections,
      userData.baseRadialT,
      pending.hueOffset,
      pending.radius,
      start,
      end
    );

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.distance.needsUpdate = true;

    userData.rebuildCursor = end;
    if (end >= userData.maxParticles) {
      userData.appliedParams = { ...pending };
      userData.pendingParams = null;
    }
  }
}
