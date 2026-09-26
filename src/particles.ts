import * as THREE from 'three';

export interface StarParticles {
  points: THREE.Points;
  update: (delta: number) => void;
}

export function createStarParticles(scene: THREE.Scene): StarParticles {
  const count = 200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const originalPositions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const x = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 40;
    const y = 5 + Math.random() * 7;

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    originalPositions[i3] = x;
    originalPositions[i3 + 1] = y;
    originalPositions[i3 + 2] = z;

    const brightness = 0.3 + Math.random() * 0.5;
    colors[i3] = brightness;
    colors[i3 + 1] = brightness;
    colors[i3 + 2] = brightness * 1.1;

    sizes[i] = 1 + Math.random() * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(220, 230, 255, 0.8)');
  gradient.addColorStop(0.7, 'rgba(180, 200, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(100, 140, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const starTexture = new THREE.CanvasTexture(canvas);

  const material = new THREE.PointsMaterial({
    size: 0.08,
    map: starTexture,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  let angle = 0;

  function update(delta: number): void {
    angle += 0.002 * delta * 60;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const ox = originalPositions[i3];
      const oz = originalPositions[i3 + 2];
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      posArray[i3] = ox * cos - oz * sin;
      posArray[i3 + 2] = ox * sin + oz * cos;
      posArray[i3 + 1] = originalPositions[i3 + 1] + Math.sin(angle * 0.5 + i * 0.1) * 0.05;
    }
    posAttr.needsUpdate = true;
  }

  return { points, update };
}
