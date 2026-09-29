import * as THREE from 'three';

export interface TerrainParams {
  amplitude: number;
  opacity: number;
}

export class TerrainGenerator {
  private mesh: THREE.Mesh | null = null;
  private clipPlaneX: THREE.Plane | null = null;
  private clipPlaneZ: THREE.Plane | null = null;
  private size: number;
  private segments: number;

  constructor(size = 400, segments = 200) {
    this.size = size;
    this.segments = segments;
  }

  public generate(params: TerrainParams): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const height = this.noiseHeight(x, z) * params.amplitude;
      positions.setY(i, height);

      const color = this.getElevationColor(height, params.amplitude);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: params.opacity,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: false,
      clippingPlanes: []
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';

    this.mesh = mesh;
    return mesh;
  }

  private noiseHeight(x: number, z: number): number {
    const freq1 = 0.008;
    const freq2 = 0.02;
    const freq3 = 0.05;
    const amp1 = 1.0;
    const amp2 = 0.4;
    const amp3 = 0.15;

    let h = 0;
    h += Math.sin(x * freq1) * Math.cos(z * freq1) * amp1;
    h += Math.sin(x * freq2 + 1.3) * Math.cos(z * freq2 + 0.7) * amp2;
    h += Math.sin(x * freq3 + 2.1) * Math.cos(z * freq3 + 1.8) * amp3;
    h += Math.sin((x + z) * freq2 * 0.5) * 0.2;

    return h;
  }

  private getElevationColor(height: number, maxAmp: number): THREE.Color {
    const t = THREE.MathUtils.clamp((height + maxAmp) / (maxAmp * 2), 0, 1);

    const deepSea = new THREE.Color(0x0a1628);
    const shallowSea = new THREE.Color(0x1a4a7a);
    const beach = new THREE.Color(0x8a7a5a);
    const lowland = new THREE.Color(0x2d5a3d);
    const highland = new THREE.Color(0x4a6a4a);
    const mountain = new THREE.Color(0x7a6a5a);
    const peak = new THREE.Color(0xd0d8e0);

    let c: THREE.Color;
    if (t < 0.2) {
      c = deepSea.clone().lerp(shallowSea, t / 0.2);
    } else if (t < 0.35) {
      c = shallowSea.clone().lerp(beach, (t - 0.2) / 0.15);
    } else if (t < 0.55) {
      c = beach.clone().lerp(lowland, (t - 0.35) / 0.2);
    } else if (t < 0.75) {
      c = lowland.clone().lerp(highland, (t - 0.55) / 0.2);
    } else if (t < 0.9) {
      c = highland.clone().lerp(mountain, (t - 0.75) / 0.15);
    } else {
      c = mountain.clone().lerp(peak, (t - 0.9) / 0.1);
    }

    return c;
  }

  public updateOpacity(opacity: number): void {
    if (this.mesh && this.mesh.material instanceof THREE.MeshStandardMaterial) {
      this.mesh.material.opacity = opacity;
      this.mesh.material.transparent = opacity < 1;
    }
  }

  public updateAmplitude(amplitude: number): void {
    if (!this.mesh) return;

    const positions = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const colors = this.mesh.geometry.attributes.color as THREE.BufferAttribute;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const height = this.noiseHeight(x, z) * amplitude;
      positions.setY(i, height);

      const color = this.getElevationColor(height, amplitude);
      colors.setXYZ(i, color.r, color.g, color.b);
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  public setClipping(axis: 'x' | 'z' | null, position: number): void {
    if (!this.mesh || !(this.mesh.material instanceof THREE.MeshStandardMaterial)) return;

    const planes: THREE.Plane[] = [];

    if (axis === 'x') {
      this.clipPlaneX = new THREE.Plane(new THREE.Vector3(1, 0, 0), -position);
      planes.push(this.clipPlaneX);
    } else if (axis === 'z') {
      this.clipPlaneZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), -position);
      planes.push(this.clipPlaneZ);
    }

    this.mesh.material.clippingPlanes = planes;
    this.mesh.material.clipShadows = true;
    this.mesh.material.needsUpdate = true;
  }

  public getMesh(): THREE.Mesh | null {
    return this.mesh;
  }

  public getHeightAt(x: number, z: number, amplitude: number): number {
    return this.noiseHeight(x, z) * amplitude;
  }
}
