import * as THREE from 'three';

export type ParticleType = 'fire' | 'steam' | 'spark';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  type: ParticleType;
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private maxParticles: number = 500;
  private fireEmissionRate: number = 100;
  private fireEmissionTimer: number = 0;
  private firePosition: THREE.Vector3;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.firePosition = new THREE.Vector3(0, 1.5, 0);
  }

  setFirePosition(position: THREE.Vector3): void {
    this.firePosition.copy(position);
  }

  emitFireParticles(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.removeOldestParticle();
      }

      const geometry = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 4, 4);
      const material = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.8
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      mesh.position.set(
        this.firePosition.x + (Math.random() - 0.5) * 0.5,
        this.firePosition.y,
        this.firePosition.z + (Math.random() - 0.5) * 0.5
      );

      const particle: Particle = {
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          1 + Math.random() * 2,
          (Math.random() - 0.5) * 0.5
        ),
        life: 0,
        maxLife: 1 + Math.random() * 1.5,
        type: 'fire',
        colorStart: new THREE.Color(0xff6600),
        colorEnd: new THREE.Color(0xaaddff)
      };

      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  emitSteamParticles(position: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.removeOldestParticle();
      }

      const geometry = new THREE.SphereGeometry(0.08 + Math.random() * 0.08, 4, 4);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 1,
        position.y,
        position.z + (Math.random() - 0.5) * 1
      );

      const particle: Particle = {
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          0.5 + Math.random() * 1,
          (Math.random() - 0.5) * 0.3
        ),
        life: 0,
        maxLife: 2 + Math.random() * 2,
        type: 'steam',
        colorStart: new THREE.Color(0xffffff),
        colorEnd: new THREE.Color(0xcccccc)
      };

      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  emitSparkParticles(position: THREE.Vector3, direction: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.removeOldestParticle();
      }

      const geometry = new THREE.SphereGeometry(0.02 + Math.random() * 0.02, 3, 3);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 1
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      mesh.position.copy(position);

      const sparkDir = direction.clone().normalize();
      sparkDir.x += (Math.random() - 0.5) * 0.5;
      sparkDir.y += (Math.random() - 0.5) * 0.5;
      sparkDir.z += (Math.random() - 0.5) * 0.5;
      sparkDir.normalize();

      const particle: Particle = {
        mesh,
        velocity: sparkDir.multiplyScalar(2 + Math.random() * 3),
        life: 0,
        maxLife: 0.3 + Math.random() * 0.3,
        type: 'spark',
        colorStart: new THREE.Color(0xffff00),
        colorEnd: new THREE.Color(0xff4400)
      };

      this.particles.push(particle);
      this.scene.add(mesh);
    }
  }

  private removeOldestParticle(): void {
    if (this.particles.length === 0) return;
    const oldest = this.particles.shift();
    if (oldest) {
      this.scene.remove(oldest.mesh);
      oldest.mesh.geometry.dispose();
      (oldest.mesh.material as THREE.Material).dispose();
    }
  }

  update(delta: number): void {
    this.fireEmissionTimer += delta;
    const emitInterval = 1 / this.fireEmissionRate;
    
    while (this.fireEmissionTimer >= emitInterval) {
      this.fireEmissionTimer -= emitInterval;
      this.emitFireParticles(1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life += delta;

      if (particle.life >= particle.maxLife) {
        this.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const lifeRatio = particle.life / particle.maxLife;

      if (particle.type === 'fire') {
        particle.velocity.y -= delta * 0.5;
      } else if (particle.type === 'spark') {
        particle.velocity.y -= delta * 5;
      }

      particle.mesh.position.add(particle.velocity.clone().multiplyScalar(delta));

      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      const color = particle.colorStart.clone().lerp(particle.colorEnd, lifeRatio);
      material.color.copy(color);
      
      if (particle.type === 'fire') {
        material.opacity = 0.8 * (1 - lifeRatio);
        const scale = 1 + lifeRatio * 1.5;
        particle.mesh.scale.setScalar(scale);
      } else if (particle.type === 'steam') {
        material.opacity = 0.4 * (1 - lifeRatio);
        const scale = 1 + lifeRatio * 2;
        particle.mesh.scale.setScalar(scale);
      } else if (particle.type === 'spark') {
        material.opacity = 1 - lifeRatio;
      }
    }
  }

  pauseFireEmission(): void {
    this.fireEmissionRate = 0;
  }

  resumeFireEmission(): void {
    this.fireEmissionRate = 100;
  }

  clear(): void {
    for (const particle of this.particles) {
      this.scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
  }

  getParticleCount(): number {
    return this.particles.length;
  }
}
