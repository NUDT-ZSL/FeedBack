import * as THREE from 'three';
import type { AudioData, ColorTheme, GestureType } from './audio-visualizer';

export class ParticleSystem {
  private scene: THREE.Scene;
  private count: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private basePositions: Float32Array;
  private velocities: Float32Array;
  private seeds: Float32Array;
  private theme: ColorTheme;
  private targetTheme: ColorTheme;
  private themeTransition = 1;
  private lastGesture: GestureType = 'none';
  private gesturePulse = 0;
  private frozen = false;
  private frozenAlpha = 0;
  private expandRadius = 0;
  private time = 0;
  private burstTime = -1;
  private radius = 6;

  constructor(scene: THREE.Scene, count: number = 3000) {
    this.scene = scene;
    this.count = count;
    this.theme = {
      name: 'default',
      lowColor: [255, 0, 102],
      midColor: [0, 255, 204],
      highColor: [0, 102, 255],
      bgTop: '#0a0a2e',
      bgBottom: '#1a0a3e'
    };
    this.targetTheme = { ...this.theme };
    this.basePositions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = this.radius * Math.pow(Math.random(), 0.5);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      this.basePositions[i * 3] = x;
      this.basePositions[i * 3 + 1] = y;
      this.basePositions[i * 3 + 2] = z;
      this.velocities[i * 3] = (Math.random() - 0.5) * 0.002;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.002;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
      this.seeds[i] = Math.random();
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.basePositions), 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.material = this.createShader();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  private createShader(): THREE.ShaderMaterial {
    const vertexShader = /* glsl */`
      attribute float aSeed;
      uniform float uTime;
      uniform float uLow;
      uniform float uMid;
      uniform float uHigh;
      uniform float uIsBeat;
      uniform float uGesturePulse;
      uniform float uFrozen;
      uniform float uExpand;
      uniform vec3 uLowColor;
      uniform vec3 uMidColor;
      uniform vec3 uHighColor;
      uniform vec3 uLowColorTgt;
      uniform vec3 uMidColorTgt;
      uniform vec3 uHighColorTgt;
      uniform float uThemeT;
      varying vec3 vColor;
      varying float vSize;
      varying float vAlpha;
      void main() {
        vec3 pos = position;
        float seed = aSeed;
        float t = uTime * (0.3 + seed * 0.4);
        float noiseSlow = sin(t + seed * 31.4) * 0.5 + 0.5;
        float noiseFast = sin(t * 2.5 + seed * 17.3) * 0.5 + 0.5;
        float band = fract(seed * 3.0);
        float freqContrib;
        vec3 freqColor;
        if (band < 0.333) {
          freqContrib = uLow;
          freqColor = mix(uLowColor, uLowColorTgt, uThemeT);
        } else if (band < 0.666) {
          freqContrib = uMid;
          freqColor = mix(uMidColor, uMidColorTgt, uThemeT);
        } else {
          freqContrib = uHigh;
          freqColor = mix(uHighColor, uHighColorTgt, uThemeT);
        }
        float expandFactor = 1.0 + uExpand * 1.4 + uIsBeat * 0.35 + freqContrib * 0.5 + uGesturePulse * 0.4;
        float lenOrg = length(pos);
        if (lenOrg > 0.0001) {
          vec3 dir = pos / lenOrg;
          float wave = sin(t * 1.5 + seed * 19.0 + uTime * 0.5) * 0.25;
          float midRipple = sin(lenOrg * 2.0 - uTime * 3.0) * uMid * 0.5;
          float twinkle = (sin(t * 3.7 + seed * 53.0) * 0.5 + 0.5) * uHigh * 0.6;
          pos = dir * (lenOrg * expandFactor + wave * 0.6 + midRipple * 0.8);
          pos.y += sin(t + seed * 7.1) * 0.15 * (1.0 + uMid * 0.8);
          pos.x += cos(t * 0.7 + seed * 11.7) * 0.1;
          vAlpha = 0.4 + freqContrib * 0.55 + twinkle * 0.4 + uIsBeat * 0.2;
          vSize = (1.8 + freqContrib * 6.0 + uIsBeat * 5.0 + noiseFast * 2.0 + uGesturePulse * 3.5) * (1.0 - uFrozen * 0.3);
          vAlpha *= (1.0 - uFrozen * 0.55);
        } else {
          vAlpha = 0.0;
          vSize = 0.0;
        }
        vec3 whiteBoost = vec3(1.0) * uIsBeat * 0.2;
        vColor = clamp(freqColor + whiteBoost + vec3(uHigh * 0.1), 0.0, 1.0);
        vColor *= (1.0 - uFrozen * 0.45);
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = vSize * (280.0 / -mvPosition.z);
      }
    `;
    const fragmentShader = /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 cxy = gl_PointCoord - vec2(0.5);
        float d = length(cxy);
        if (d > 0.5) discard;
        float soft = 1.0 - smoothstep(0.2, 0.5, d);
        float core = smoothstep(0.3, 0.0, d);
        vec3 col = vColor + vec3(core * 0.4);
        float a = clamp(soft * vAlpha + core * vAlpha * 0.5, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uLow: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uIsBeat: { value: 0 },
        uGesturePulse: { value: 0 },
        uFrozen: { value: 0 },
        uExpand: { value: 0 },
        uLowColor: { value: new THREE.Vector3(...this.theme.lowColor.map(v => v / 255)) },
        uMidColor: { value: new THREE.Vector3(...this.theme.midColor.map(v => v / 255)) },
        uHighColor: { value: new THREE.Vector3(...this.theme.highColor.map(v => v / 255)) },
        uLowColorTgt: { value: new THREE.Vector3(...this.targetTheme.lowColor.map(v => v / 255)) },
        uMidColorTgt: { value: new THREE.Vector3(...this.targetTheme.midColor.map(v => v / 255)) },
        uHighColorTgt: { value: new THREE.Vector3(...this.targetTheme.highColor.map(v => v / 255)) },
        uThemeT: { value: 1.0 }
      }
    });
  }

  setTheme(theme: ColorTheme, smooth: boolean = true): void {
    if (smooth) {
      const currLow = this.material.uniforms.uLowColor.value as THREE.Vector3;
      const currMid = this.material.uniforms.uMidColor.value as THREE.Vector3;
      const currHigh = this.material.uniforms.uHighColor.value as THREE.Vector3;
      this.material.uniforms.uLowColor.value = currLow.clone();
      this.material.uniforms.uMidColor.value = currMid.clone();
      this.material.uniforms.uHighColor.value = currHigh.clone();
      this.material.uniforms.uLowColorTgt.value = new THREE.Vector3(...theme.lowColor.map(v => v / 255));
      this.material.uniforms.uMidColorTgt.value = new THREE.Vector3(...theme.midColor.map(v => v / 255));
      this.material.uniforms.uHighColorTgt.value = new THREE.Vector3(...theme.highColor.map(v => v / 255));
      this.themeTransition = 0;
    } else {
      this.material.uniforms.uLowColor.value = new THREE.Vector3(...theme.lowColor.map(v => v / 255));
      this.material.uniforms.uMidColor.value = new THREE.Vector3(...theme.midColor.map(v => v / 255));
      this.material.uniforms.uHighColor.value = new THREE.Vector3(...theme.highColor.map(v => v / 255));
      this.material.uniforms.uLowColorTgt.value = new THREE.Vector3(...theme.lowColor.map(v => v / 255));
      this.material.uniforms.uMidColorTgt.value = new THREE.Vector3(...theme.midColor.map(v => v / 255));
      this.material.uniforms.uHighColorTgt.value = new THREE.Vector3(...theme.highColor.map(v => v / 255));
      this.themeTransition = 1;
    }
    this.targetTheme = { ...theme };
    this.theme = { ...theme };
    this.material.uniforms.uThemeT.value = this.themeTransition;
  }

  update(audio: AudioData, gesture: GestureType, delta: number): void {
    this.time += delta;
    if (this.themeTransition < 1) {
      this.themeTransition = Math.min(1, this.themeTransition + delta);
      this.material.uniforms.uThemeT.value = this.themeTransition;
    }
    if (gesture !== this.lastGesture && gesture !== 'none') {
      this.gesturePulse = 1;
      this.burstTime = this.time;
      if (gesture === '1-finger') {
        this.frozen = !this.frozen;
      }
    }
    this.lastGesture = gesture;
    this.gesturePulse = Math.max(0, this.gesturePulse - delta * 3.0);
    this.frozenAlpha = THREE.MathUtils.lerp(this.frozenAlpha, this.frozen ? 1 : 0, Math.min(1, delta * 4));
    if (gesture === '3-finger') {
      this.expandRadius = Math.min(1, this.expandRadius + delta * 1.5);
    } else if (gesture === '4-finger') {
      this.expandRadius = Math.max(0, this.expandRadius - delta * 1.5);
    } else {
      this.expandRadius = THREE.MathUtils.lerp(this.expandRadius, 0.5, Math.min(1, delta * 1.2));
    }
    if (gesture === 'fist') {
      this.frozenAlpha = Math.min(1, this.frozenAlpha + delta * 3);
    }
    if (gesture === '2-finger' && this.gesturePulse > 0.8) {
      this.burstTime = this.time;
    }
    const burstDecay = Math.exp(-(this.time - this.burstTime) * 2.5);
    const beatBurst = audio.isBeat ? 1 : 0;
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    if (this.frozenAlpha < 0.9) {
      const moveFactor = 1 - this.frozenAlpha;
      for (let i = 0; i < this.count; i++) {
        const i3 = i * 3;
        const seed = this.seeds[i];
        const band = (seed * 3) % 1;
        let audioPush = 0;
        if (band < 0.333) audioPush = audio.lowFrequency;
        else if (band < 0.666) audioPush = audio.midFrequency;
        else audioPush = audio.highFrequency;
        const bx = Math.sin(this.time * 0.5 + seed * 67) * 0.008;
        const by = Math.cos(this.time * 0.4 + seed * 31) * 0.008;
        const bz = Math.sin(this.time * 0.6 + seed * 13) * 0.008;
        const kick = beatBurst * (0.15 + audioPush * 0.3) + burstDecay * 0.4;
        positions[i3] += (this.velocities[i3] + bx + kick * (this.basePositions[i3] * 0.008)) * moveFactor;
        positions[i3 + 1] += (this.velocities[i3 + 1] + by + kick * (this.basePositions[i3 + 1] * 0.008)) * moveFactor;
        positions[i3 + 2] += (this.velocities[i3 + 2] + bz + kick * (this.basePositions[i3 + 2] * 0.008)) * moveFactor;
        const dx = positions[i3] - this.basePositions[i3];
        const dy = positions[i3 + 1] - this.basePositions[i3 + 1];
        const dz = positions[i3 + 2] - this.basePositions[i3 + 2];
        const spring = 0.02 * moveFactor;
        positions[i3] -= dx * spring;
        positions[i3 + 1] -= dy * spring;
        positions[i3 + 2] -= dz * spring;
      }
    }
    posAttr.needsUpdate = true;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uLow.value = audio.lowFrequency;
    this.material.uniforms.uMid.value = audio.midFrequency;
    this.material.uniforms.uHigh.value = audio.highFrequency;
    this.material.uniforms.uIsBeat.value = beatBurst;
    this.material.uniforms.uGesturePulse.value = this.gesturePulse;
    this.material.uniforms.uFrozen.value = this.frozenAlpha;
    this.material.uniforms.uExpand.value = this.expandRadius;
    this.points.rotation.y += delta * 0.08;
    this.points.rotation.x = Math.sin(this.time * 0.1) * 0.15;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
