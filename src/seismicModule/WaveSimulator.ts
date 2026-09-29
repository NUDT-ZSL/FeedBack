import * as THREE from 'three';

export interface EarthquakeParams {
  intensity: number;
  frequency: number;
  attenuation: number;
}

export interface WaveSource {
  id: number;
  position: THREE.Vector3;
  params: EarthquakeParams;
  startTime: number;
  waveCount: number;
  speed: number;
  maxRadius: number;
}

export interface ParticleData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  count: number;
}

export class WaveSimulator {
  private sources: Map<number, WaveSource> = new Map();
  private nextId: number = 0;
  private particlesPerWave: number = 1000;
  private readonly MAX_TOTAL_PARTICLES: number = 5000;
  private readonly WAVE_DURATION: number = 2000;
  private readonly LOW_PARTICLES: number = 500;
  private readonly HIGH_PARTICLES: number = 1000;

  public addSource(position: THREE.Vector3, params: EarthquakeParams): number {
    const id = this.nextId++;
    const baseSpeed = 30;
    const speed = baseSpeed * Math.pow(1.2, params.intensity - 1);
    const waveCount = Math.floor(3 + (params.intensity - 1) * (7 / 9));
    const maxRadius = 50 + (params.intensity - 1) * (100 / 9);

    const source: WaveSource = {
      id,
      position: position.clone(),
      params: { ...params },
      startTime: performance.now(),
      waveCount,
      speed,
      maxRadius
    };

    this.sources.set(id, source);
    this.updateParticlesPerWave();
    return id;
  }

  public removeSource(id: number): void {
    this.sources.delete(id);
    this.updateParticlesPerWave();
  }

  public updateIntensity(intensity: number): void {
    const baseSpeed = 30;
    const speed = baseSpeed * Math.pow(1.2, intensity - 1);
    const waveCount = Math.floor(3 + (intensity - 1) * (7 / 9));
    const maxRadius = 50 + (intensity - 1) * (100 / 9);

    this.sources.forEach((source) => {
      source.params.intensity = intensity;
      source.speed = speed;
      source.waveCount = waveCount;
      source.maxRadius = maxRadius;
    });

    this.updateParticlesPerWave();
  }

  private updateParticlesPerWave(): void {
    const activeSources = this.getActiveSources().length;
    if (activeSources > 5) {
      this.particlesPerWave = this.LOW_PARTICLES;
    } else {
      this.particlesPerWave = this.HIGH_PARTICLES;
    }
  }

  public getActiveSources(): WaveSource[] {
    const now = performance.now();
    const active: WaveSource[] = [];
    const toRemove: number[] = [];

    this.sources.forEach((source) => {
      const elapsed = now - source.startTime;
      const maxLife = (source.maxRadius / source.speed) * 1000 + this.WAVE_DURATION;
      if (elapsed < maxLife) {
        active.push(source);
      } else {
        toRemove.push(source.id);
      }
    });

    toRemove.forEach((id) => this.sources.delete(id));
    this.updateParticlesPerWave();
    return active;
  }

  public getParticlesData(): ParticleData {
    const sources = this.getActiveSources();
    const now = performance.now();

    const totalWaves = sources.reduce((sum, s) => {
      const elapsed = now - s.startTime;
      const waveInterval = this.WAVE_DURATION / s.waveCount;
      const visibleWaves = Math.min(s.waveCount, Math.ceil(elapsed / waveInterval) + 1);
      return sum + visibleWaves;
    }, 0);

    const actualParticlesPerWave = Math.min(
      this.particlesPerWave,
      totalWaves > 0 ? Math.floor(this.MAX_TOTAL_PARTICLES / totalWaves) : this.particlesPerWave
    );

    const maxParticles = Math.min(this.MAX_TOTAL_PARTICLES, totalWaves * actualParticlesPerWave);
    const positions = new Float32Array(maxParticles * 3);
    const colors = new Float32Array(maxParticles * 3);
    const sizes = new Float32Array(maxParticles);

    let particleIndex = 0;

    for (const source of sources) {
      const elapsed = now - source.startTime;
      const waveInterval = this.WAVE_DURATION / source.waveCount;

      for (let w = 0; w < source.waveCount; w++) {
        const waveStartTime = w * waveInterval;
        const waveElapsed = elapsed - waveStartTime;

        if (waveElapsed < 0 || waveElapsed > this.WAVE_DURATION) continue;
        if (particleIndex >= maxParticles) break;

        const progress = waveElapsed / this.WAVE_DURATION;
        const radius = progress * source.maxRadius;
        const alpha = 1 - progress;
        const attenuation = Math.exp(-source.params.attenuation * radius * 0.01);

        for (let p = 0; p < actualParticlesPerWave; p++) {
          if (particleIndex >= maxParticles) break;

          const angle = (p / actualParticlesPerWave) * Math.PI * 2 + Math.random() * 0.02;
          const jitter = (Math.random() - 0.5) * 2;

          const px = source.position.x + Math.cos(angle) * (radius + jitter);
          const py = source.position.y + 0.5;
          const pz = source.position.z + Math.sin(angle) * (radius + jitter);

          positions[particleIndex * 3] = px;
          positions[particleIndex * 3 + 1] = py;
          positions[particleIndex * 3 + 2] = pz;

          const energy = alpha * attenuation;
          const color = this.getWaveColor(energy, progress);
          colors[particleIndex * 3] = color.r;
          colors[particleIndex * 3 + 1] = color.g;
          colors[particleIndex * 3 + 2] = color.b;

          sizes[particleIndex] = (2 + Math.random() * 3) * (0.5 + energy * 0.5);

          particleIndex++;
        }
      }
    }

    return {
      positions,
      colors,
      sizes,
      count: particleIndex
    };
  }

  private getWaveColor(energy: number, _progress: number): THREE.Color {
    const red = new THREE.Color(1.0, 0.15, 0.25);
    const blue = new THREE.Color(0.2, 0.5, 1.0);
    const t = THREE.MathUtils.clamp(1 - energy, 0, 1);
    const color = red.clone().lerp(blue, t);
    color.multiplyScalar(0.8 + energy * 0.4);
    return color;
  }

  public clearAll(): void {
    this.sources.clear();
  }

  public getSourceCount(): number {
    return this.getActiveSources().length;
  }
}
