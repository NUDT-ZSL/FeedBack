import * as Comlink from 'comlink';
import * as THREE from 'three';

interface ClothWorkerAPI {
  computeWrinklePositions: (
    originalPositions: Float32Array,
    wrinkleIntensity: number,
    time: number,
    vertexCount: number
  ) => Float32Array;
  computeVertexColors: (
    positions: Float32Array,
    vertexCount: number
  ) => Float32Array;
  generateNoiseSeeds: (count: number) => Float32Array;
}

const clothWorker: ClothWorkerAPI = {
  generateNoiseSeeds(count: number): Float32Array {
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = Math.random() * 1000;
      seeds[i * 3 + 1] = Math.random() * 1000;
      seeds[i * 3 + 2] = Math.random() * 1000;
    }
    return seeds;
  },

  computeWrinklePositions(
    originalPositions: Float32Array,
    wrinkleIntensity: number,
    time: number,
    vertexCount: number
  ): Float32Array {
    const newPositions = new Float32Array(originalPositions.length);
    const intensity = wrinkleIntensity / 1000;

    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3;
      const x = originalPositions[i3];
      const y = originalPositions[i3 + 1];
      const z = originalPositions[i3 + 2];

      const noise1 = Math.sin(x * 8 + time * 0.5) * Math.cos(y * 6 + time * 0.3);
      const noise2 = Math.sin(x * 12 + z * 5 + time * 0.2) * Math.cos(y * 9 + time * 0.4);
      const noise3 = Math.sin((x + y + z) * 6 + time * 0.6);

      const displacement = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2) * intensity;

      const centerDist = Math.sqrt(x * x + z * z);
      const falloff = Math.max(0, 1 - centerDist * 0.5);
      const finalDisplacement = displacement * (0.5 + falloff * 0.5);

      const nx = x / Math.max(0.001, centerDist);
      const nz = z / Math.max(0.001, centerDist);

      newPositions[i3] = x + nx * finalDisplacement * 0.3;
      newPositions[i3 + 1] = y + finalDisplacement;
      newPositions[i3 + 2] = z + nz * finalDisplacement * 0.3;
    }

    return newPositions;
  },

  computeVertexColors(
    positions: Float32Array,
    vertexCount: number
  ): Float32Array {
    const colors = new Float32Array(vertexCount * 3);
    const colorStart = new THREE.Color('#81d4fa');
    const colorEnd = new THREE.Color('#7b1fa2');

    let maxY = -Infinity;
    let minY = Infinity;

    for (let i = 0; i < vertexCount; i++) {
      const y = positions[i * 3 + 1];
      maxY = Math.max(maxY, y);
      minY = Math.min(minY, y);
    }

    const range = Math.max(0.001, maxY - minY);

    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3;
      const y = positions[i3 + 1];
      const t = (y - minY) / range;

      const color = colorStart.clone().lerp(colorEnd, t);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    return colors;
  }
};

Comlink.expose(clothWorker);

export type { ClothWorkerAPI };
