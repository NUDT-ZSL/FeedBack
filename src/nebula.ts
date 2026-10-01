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

function lerpColor(color1: THREE.Color, color2: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().lerpColors(color1, color2, t);
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

  const innerRadius = radius * 0.7;
  const outerRadius = radius;

  const centerColor = hslToRgb((20 + hueOffset) % 360, 100, 60);
  const outerColor = hslToRgb((250 + hueOffset) % 360, 80, 50);

  for (let i = 0; i < maxParticles; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = innerRadius + Math.random() * (outerRadius - innerRadius);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const t = (r - innerRadius) / (outerRadius - innerRadius);
    const particleColor = lerpColor(centerColor, outerColor, t);

    colors[i * 3] = particleColor.r;
    colors[i * 3 + 1] = particleColor.g;
    colors[i * 3 + 2] = particleColor.b;

    alphas[i] = 0.3 + Math.random() * 0.7;
    sizes[i] = 0.05 + Math.random() * 0.45;
    distances[i] = r;
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
  (points as unknown as THREE.Points & { userData: { params: NebulaParams; maxParticles: number } }).userData = {
    params: { ...params },
    maxParticles
  };

  return points;
}

export function updateNebula(points: THREE.Points, params: NebulaParams): void {
  const userData = (points as THREE.Points & { userData: { params: NebulaParams; maxParticles: number } }).userData;
  const oldParams = userData.params;
  const { particleCount, hueOffset, radius } = params;
  const geometry = points.geometry;

  if (oldParams.particleCount !== particleCount) {
    geometry.setDrawRange(0, particleCount);
  }

  if (oldParams.radius !== radius || oldParams.hueOffset !== hueOffset) {
    const positions = geometry.attributes.position.array as Float32Array;
    const colors = geometry.attributes.color.array as Float32Array;
    const distances = geometry.attributes.distance.array as Float32Array;
    const maxParticles = userData.maxParticles;

    const innerRadius = radius * 0.7;
    const outerRadius = radius;

    const centerColor = hslToRgb((20 + hueOffset) % 360, 100, 60);
    const outerColor = hslToRgb((250 + hueOffset) % 360, 80, 50);

    for (let i = 0; i < maxParticles; i++) {
      const i3 = i * 3;
      const oldDist = distances[i];
      const oldT = oldParams.radius > 0 
        ? (oldDist - oldParams.radius * 0.7) / (oldParams.radius * 0.3)
        : 0.5;
      const newDist = innerRadius + oldT * (outerRadius - innerRadius);

      const scale = oldDist > 0 ? newDist / oldDist : 1;
      positions[i3] *= scale;
      positions[i3 + 1] *= scale;
      positions[i3 + 2] *= scale;

      distances[i] = newDist;

      const t = (newDist - innerRadius) / (outerRadius - innerRadius);
      const particleColor = lerpColor(centerColor, outerColor, t);
      colors[i3] = particleColor.r;
      colors[i3 + 1] = particleColor.g;
      colors[i3 + 2] = particleColor.b;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.distance.needsUpdate = true;
  }

  userData.params = { ...params };
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
  const userData = (points as THREE.Points & { userData: { params: NebulaParams } }).userData;
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
}
