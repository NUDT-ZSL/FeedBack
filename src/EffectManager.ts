import * as THREE from 'three';

export type ParticleType = 'ink' | 'scroll' | 'seal' | 'ripple';

export interface Particle {
  mesh: THREE.Points;
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  type: ParticleType;
  scale: number;
  opacity: number;
}

export class EffectManager {
  private scene: THREE.Scene;
  private particlePool: Particle[] = [];
  private maxParticles: number = 150;
  private activeParticles: Particle[] = [];
  private inkTexture: THREE.Texture | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createInkTexture();
    this.initializePool();
  }

  private createInkTexture(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(20, 20, 20, 0.8)');
    gradient.addColorStop(0.4, 'rgba(30, 30, 30, 0.4)');
    gradient.addColorStop(0.7, 'rgba(40, 40, 40, 0.1)');
    gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.inkTexture = new THREE.CanvasTexture(canvas);
  }

  private initializePool(): void {
    for (let i = 0; i < this.maxParticles; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(3);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.1,
        transparent: true,
        opacity: 0,
        vertexColors: false,
        map: this.inkTexture!,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Points(geometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particlePool.push({
        mesh,
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        type: 'ink',
        scale: 1,
        opacity: 0
      });
    }
  }

  private getParticleFromPool(): Particle | null {
    for (const particle of this.particlePool) {
      if (!particle.active) {
        return particle;
      }
    }
    return null;
  }

  public emitInkWash(position: THREE.Vector3, color: number = 0x2a2a2a): void {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const particle = this.getParticleFromPool();
      if (!particle) break;
      const angle = (i / count) * Math.PI * 2;
      const speed = 0.3 + Math.random() * 0.3;
      particle.active = true;
      particle.position.copy(position);
      particle.velocity.set(
        Math.cos(angle) * speed,
        Math.sin(angle) * speed * 0.5,
        (Math.random() - 0.5) * 0.2
      );
      particle.life = 0;
      particle.maxLife = 1.5;
      particle.type = 'ink';
      particle.scale = 0.5 + Math.random() * 0.5;
      particle.opacity = 0.6;
      const material = particle.mesh.material as THREE.PointsMaterial;
      material.color.setHex(color);
      material.opacity = 0;
      material.size = 0.15 * particle.scale;
      particle.mesh.visible = true;
      particle.mesh.position.copy(particle.position);
      this.activeParticles.push(particle);
    }
  }

  public emitRipple(position: THREE.Vector3, _radius: number = 0.5, color: number = 0x8baa9a): void {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const particle = this.getParticleFromPool();
        if (!particle) return;
        particle.active = true;
        particle.position.copy(position);
        particle.position.z += 0.01;
        particle.velocity.set(0, 0, 0);
        particle.life = 0;
        particle.maxLife = 1.5;
        particle.type = 'ripple';
        particle.scale = 0.1;
        particle.opacity = 0.5;
        const material = particle.mesh.material as THREE.PointsMaterial;
        material.color.setHex(color);
        material.opacity = 0.5;
        material.size = 0.1;
        particle.mesh.visible = true;
        particle.mesh.position.copy(particle.position);
        this.activeParticles.push(particle);
      }, i * 150);
    }
  }

  public emitScrollParticles(position: THREE.Vector3, direction: THREE.Vector3): void {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const particle = this.getParticleFromPool();
      if (!particle) break;
      particle.active = true;
      particle.position.copy(position);
      particle.position.x += (Math.random() - 0.5) * 0.3;
      particle.position.y += (Math.random() - 0.5) * 0.2;
      particle.velocity.copy(direction).multiplyScalar(0.2 + Math.random() * 0.2);
      particle.velocity.y += (Math.random() - 0.5) * 0.1;
      particle.life = 0;
      particle.maxLife = 2;
      particle.type = 'scroll';
      particle.scale = 0.3 + Math.random() * 0.4;
      particle.opacity = 0.4;
      const material = particle.mesh.material as THREE.PointsMaterial;
      material.color.setHex(0xf5f0e6);
      material.opacity = 0;
      material.size = 0.1 * particle.scale;
      particle.mesh.visible = true;
      particle.mesh.position.copy(particle.position);
      this.activeParticles.push(particle);
    }
  }

  public emitSealGlow(position: THREE.Vector3): void {
    const count = 6;
    for (let i = 0; i < count; i++) {
      const particle = this.getParticleFromPool();
      if (!particle) break;
      const angle = (i / count) * Math.PI * 2;
      particle.active = true;
      particle.position.copy(position);
      particle.position.x += Math.cos(angle) * 0.05;
      particle.position.y += Math.sin(angle) * 0.05;
      particle.velocity.set(
        Math.cos(angle) * 0.1,
        Math.sin(angle) * 0.1,
        0.05
      );
      particle.life = 0;
      particle.maxLife = 2.5;
      particle.type = 'seal';
      particle.scale = 0.4 + Math.random() * 0.3;
      particle.opacity = 0.8;
      const material = particle.mesh.material as THREE.PointsMaterial;
      material.color.setHex(0x8b0000);
      material.opacity = 0;
      material.size = 0.12 * particle.scale;
      particle.mesh.visible = true;
      particle.mesh.position.copy(particle.position);
      this.activeParticles.push(particle);
    }
  }

  public easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  public easeInOutCustom(t: number): number {
    return this.easeInOutCubic(t);
  }

  public update(deltaTime: number): void {
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const particle = this.activeParticles[i];
      if (!particle.active) continue;
      particle.life += deltaTime;
      const t = particle.life / particle.maxLife;
      if (t >= 1) {
        particle.active = false;
        particle.mesh.visible = false;
        const material = particle.mesh.material as THREE.PointsMaterial;
        material.opacity = 0;
        this.activeParticles.splice(i, 1);
        continue;
      }
      const easedT = this.easeInOutCustom(t);
      particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));
      particle.velocity.multiplyScalar(0.96);
      let opacity = 0;
      let scale = particle.scale;
      switch (particle.type) {
        case 'ink':
          opacity = Math.sin(t * Math.PI) * particle.opacity;
          scale = particle.scale * (1 + easedT * 1.5);
          break;
        case 'ripple':
          opacity = (1 - t) * particle.opacity;
          scale = particle.scale * (1 + t * 8);
          break;
        case 'scroll':
          opacity = Math.sin(t * Math.PI) * particle.opacity;
          scale = particle.scale * (1 + t * 0.5);
          break;
        case 'seal':
          opacity = (1 - t) * particle.opacity;
          scale = particle.scale * (1 + t * 0.3);
          break;
      }
      const material = particle.mesh.material as THREE.PointsMaterial;
      material.opacity = opacity;
      material.size = 0.1 * scale;
      particle.mesh.position.copy(particle.position);
    }
  }

  public getActiveParticleCount(): number {
    return this.activeParticles.length;
  }

  public dispose(): void {
    for (const particle of this.particlePool) {
      this.scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
    }
    this.particlePool = [];
    this.activeParticles = [];
    if (this.inkTexture) {
      this.inkTexture.dispose();
    }
  }
}
