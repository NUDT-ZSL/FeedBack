import * as THREE from 'three';
import type { ParticleData, WaveSource } from './WaveSimulator';
import * as TWEEN from '@tweenjs/tween.js';

const vertexShader = `
  attribute float size;
  attribute vec3 customColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = customColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    vAlpha = clamp(1.0 - length(position) / 200.0, 0.3, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;
    float glow = 1.0 - dist * 2.0;
    glow = pow(glow, 1.5);
    gl_FragColor = vec4(vColor, glow * vAlpha * 0.9);
  }
`;

export class WaveRenderer {
  private particles: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private pulseRings: Map<number, THREE.Mesh> = new Map();
  private nextPulseId: number = 0;
  private readonly MAX_PARTICLES: number = 5000;

  public init(scene: THREE.Scene): void {
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(this.MAX_PARTICLES * 3);
    const colors = new Float32Array(this.MAX_PARTICLES * 3);
    const sizes = new Float32Array(this.MAX_PARTICLES);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true
    });

    this.particles = new THREE.Points(this.geometry, this.material);
    this.particles.frustumCulled = false;
    scene.add(this.particles);
  }

  public update(data: ParticleData): void {
    if (!this.geometry || !this.particles) return;

    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = this.geometry.attributes.customColor as THREE.BufferAttribute;
    const sizeAttr = this.geometry.attributes.size as THREE.BufferAttribute;

    const posArray = posAttr.array as Float32Array;
    const colorArray = colorAttr.array as Float32Array;
    const sizeArray = sizeAttr.array as Float32Array;

    for (let i = 0; i < data.count; i++) {
      posArray[i * 3] = data.positions[i * 3];
      posArray[i * 3 + 1] = data.positions[i * 3 + 1];
      posArray[i * 3 + 2] = data.positions[i * 3 + 2];

      colorArray[i * 3] = data.colors[i * 3];
      colorArray[i * 3 + 1] = data.colors[i * 3 + 1];
      colorArray[i * 3 + 2] = data.colors[i * 3 + 2];

      sizeArray[i] = data.sizes[i];
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, data.count);
  }

  public addPulseRing(position: THREE.Vector3, scene: THREE.Scene): number {
    const id = this.nextPulseId++;
    const geometry = new THREE.RingGeometry(0.1, 0.5, 64);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshBasicMaterial({
      color: 0xff3366,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.position.copy(position);
    ring.position.y += 0.3;
    scene.add(ring);

    const animState = { scale: 0.1, opacity: 0.9 };
    new TWEEN.Tween(animState)
      .to({ scale: 30, opacity: 0 }, 1500)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => {
        ring.scale.setScalar(animState.scale);
        if (ring.material instanceof THREE.MeshBasicMaterial) {
          ring.material.opacity = animState.opacity;
        }
      })
      .onComplete(() => {
        scene.remove(ring);
        geometry.dispose();
        material.dispose();
        this.pulseRings.delete(id);
      })
      .start();

    this.pulseRings.set(id, ring);
    return id;
  }

  public addWaveRings(source: WaveSource, scene: THREE.Scene): void {
    for (let i = 0; i < source.waveCount; i++) {
      setTimeout(() => {
        this.createSingleWaveRing(source, scene, i);
      }, (i * 2000) / source.waveCount);
    }
  }

  private createSingleWaveRing(source: WaveSource, scene: THREE.Scene, waveIndex: number): void {
    const innerGeom = new THREE.RingGeometry(1, 1.5, 128);
    innerGeom.rotateX(-Math.PI / 2);

    const innerMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMaxRadius: { value: source.maxRadius },
        uDuration: { value: 2.0 },
        uWaveIndex: { value: waveIndex },
        uTotalWaves: { value: source.waveCount }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec2 vUv;
        void main() {
          vPosition = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uMaxRadius;
        uniform float uDuration;
        uniform float uWaveIndex;
        uniform float uTotalWaves;
        varying vec3 vPosition;
        varying vec2 vUv;

        void main() {
          float dist = length(vPosition.xz);
          float progress = uTime / uDuration;
          float alpha = 1.0 - progress;
          alpha *= 1.0 - smoothstep(uMaxRadius * 0.7, uMaxRadius, dist);

          vec3 redColor = vec3(1.0, 0.2, 0.3);
          vec3 blueColor = vec3(0.1, 0.4, 1.0);
          vec3 color = mix(redColor, blueColor, progress);

          float edge = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          alpha *= edge;

          gl_FragColor = vec4(color, alpha * 0.7);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const ring = new THREE.Mesh(innerGeom, innerMat);
    ring.position.copy(source.position);
    ring.position.y += 0.5;
    scene.add(ring);

    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= 2.5) {
        scene.remove(ring);
        innerGeom.dispose();
        innerMat.dispose();
        return;
      }

      const scale = (elapsed / 2.0) * source.maxRadius;
      ring.scale.setScalar(Math.max(0.01, scale));
      innerMat.uniforms.uTime.value = elapsed;
      requestAnimationFrame(animate);
    };
    animate();
  }

  public fadeInUpdate(duration: number = 200): void {
    if (!this.material) return;

    const original = this.material.opacity;
    this.material.opacity = 0;
    new TWEEN.Tween(this.material)
      .to({ opacity: original }, duration)
      .easing(TWEEN.Easing.Quadratic.Out)
      .start();
  }

  public dispose(scene: THREE.Scene): void {
    if (this.particles) {
      scene.remove(this.particles);
      if (this.geometry) this.geometry.dispose();
      if (this.material) this.material.dispose();
    }

    this.pulseRings.forEach((ring) => {
      scene.remove(ring);
      if (ring.geometry) ring.geometry.dispose();
      if (ring.material instanceof THREE.Material) ring.material.dispose();
    });
    this.pulseRings.clear();
  }
}
