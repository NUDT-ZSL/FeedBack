import * as THREE from 'three';

interface WaterParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

interface AromaParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
  startColor: THREE.Color;
  endColor: THREE.Color;
}

export type PourCompleteCallback = () => void;
export type AromaCompleteCallback = (particleCount: number) => void;

export class WaterEffect {
  private scene: THREE.Scene;
  private waterParticles: THREE.Points | null = null;
  private aromaParticles: THREE.Points | null = null;
  private waterParticleData: WaterParticle[] = [];
  private aromaParticleData: AromaParticle[] = [];
  private maxWaterParticles: number;
  private maxAromaParticles: number;
  private isPouring: boolean = false;
  private pourAngle: number = 45;
  private pourDuration: number = 30;
  private pourStartTime: number = 0;
  private teapotPosition: THREE.Vector3;
  private teacupPosition: THREE.Vector3;
  private gravity: number = -9.8;
  private waterColors: { [key: string]: THREE.Color } = {
    low: new THREE.Color(0xe8d5a3),
    medium: new THREE.Color(0xd4a84b),
    high: new THREE.Color(0x8b5e3c)
  };
  private onPourComplete: PourCompleteCallback | null = null;
  private onAromaComplete: AromaCompleteCallback | null = null;
  private teacupWaterMesh: THREE.Mesh | null = null;
  private teacupWaterMaxY: number = 0;
  private teacupWaterMinY: number = 0;
  private waterFillStartTime: number = 0;
  private waterFillDuration: number = 2;
  private aromaStartTime: number = 0;
  private isAromaActive: boolean = false;
  private aromaParticleCount: number = 0;
  private isMobile: boolean;

  constructor(
    scene: THREE.Scene,
    teapotPosition: THREE.Vector3,
    teacupPosition: THREE.Vector3,
    teacupWaterMesh: THREE.Mesh | null = null
  ) {
    this.scene = scene;
    this.teapotPosition = teapotPosition.clone();
    this.teacupPosition = teacupPosition.clone();
    this.teacupWaterMesh = teacupWaterMesh;
    this.isMobile = window.innerWidth <= 768;
    
    const particleScale = this.isMobile ? 0.75 : 1;
    this.maxWaterParticles = Math.floor(120 * particleScale);
    this.maxAromaParticles = Math.floor(80 * particleScale);

    this.initializeWaterParticleSystem();
    this.initializeAromaParticleSystem();
    this.updateTeacupWaterBounds();
  }

  private updateTeacupWaterBounds(): void {
    if (this.teacupWaterMesh) {
      this.teacupWaterMinY = this.teacupPosition.y;
      this.teacupWaterMaxY = this.teacupPosition.y + 0.15;
    }
  }

  private initializeWaterParticleSystem(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxWaterParticles * 3);
    const colors = new Float32Array(this.maxWaterParticles * 3);
    const sizes = new Float32Array(this.maxWaterParticles);

    for (let i = 0; i < this.maxWaterParticles; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = 0.8;
      colors[i * 3 + 1] = 0.95;
      colors[i * 3 + 2] = 1.0;
      sizes[i] = 0;
      
      this.waterParticleData.push({
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        active: false
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.03,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    this.waterParticles = new THREE.Points(geometry, material);
    this.scene.add(this.waterParticles);
  }

  private initializeAromaParticleSystem(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxAromaParticles * 3);
    const colors = new Float32Array(this.maxAromaParticles * 3);
    const sizes = new Float32Array(this.maxAromaParticles);

    for (let i = 0; i < this.maxAromaParticles; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 1.0;
      colors[i * 3 + 2] = 1.0;
      sizes[i] = 0;
      
      this.aromaParticleData.push({
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 3,
        active: false,
        startColor: new THREE.Color(0xffffff),
        endColor: new THREE.Color(0xb0e57c)
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    this.aromaParticles = new THREE.Points(geometry, material);
    this.scene.add(this.aromaParticles);
  }

  getTeaColor(temp: number): THREE.Color {
    if (temp < 70) {
      return this.waterColors.low.clone();
    } else if (temp <= 90) {
      const t = (temp - 70) / 20;
      return new THREE.Color().lerpColors(
        this.waterColors.low,
        this.waterColors.medium,
        t
      );
    } else {
      const t = Math.min((temp - 90) / 10, 1);
      return new THREE.Color().lerpColors(
        this.waterColors.medium,
        this.waterColors.high,
        t
      );
    }
  }

  getTeaColorRGB(temp: number): { r: number; g: number; b: number } {
    const color = this.getTeaColor(temp);
    return {
      r: Math.round(color.r * 255),
      g: Math.round(color.g * 255),
      b: Math.round(color.b * 255)
    };
  }

  startPouring(angle: number, duration: number, onComplete?: PourCompleteCallback): void {
    this.isPouring = true;
    this.pourAngle = angle;
    this.pourDuration = duration;
    this.pourStartTime = performance.now();
    this.waterFillStartTime = performance.now();
    this.onPourComplete = onComplete || null;

    if (duration >= 60) {
      this.waterFillDuration = 3;
    } else if (duration >= 30) {
      this.waterFillDuration = 2;
    } else {
      this.waterFillDuration = 1;
    }
  }

  stopPouring(): void {
    this.isPouring = false;
  }

  releaseAroma(duration: number, onComplete?: AromaCompleteCallback): void {
    this.isAromaActive = true;
    this.aromaStartTime = performance.now();
    this.onAromaComplete = onComplete || null;

    if (duration >= 60) {
      this.aromaParticleCount = Math.floor(80 * (this.isMobile ? 0.75 : 1));
    } else if (duration >= 30) {
      this.aromaParticleCount = Math.floor(50 * (this.isMobile ? 0.75 : 1));
    } else {
      this.aromaParticleCount = Math.floor(20 * (this.isMobile ? 0.75 : 1));
    }

    this.emitAromaBurst(this.aromaParticleCount);
  }

  private emitAromaBurst(count: number): void {
    let emitted = 0;
    for (let i = 0; i < this.maxAromaParticles && emitted < count; i++) {
      if (!this.aromaParticleData[i].active) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 0.1;
        
        this.aromaParticleData[i].position.set(
          this.teacupPosition.x + Math.cos(angle) * radius,
          this.teacupPosition.y + 0.15,
          this.teacupPosition.z + Math.sin(angle) * radius
        );
        
        const spreadAngle = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.3;
        this.aromaParticleData[i].velocity.set(
          Math.cos(spreadAngle) * speed * 0.3,
          0.2 + Math.random() * 0.2,
          Math.sin(spreadAngle) * speed * 0.3
        );
        
        this.aromaParticleData[i].life = 0;
        this.aromaParticleData[i].maxLife = 2.5 + Math.random() * 1;
        this.aromaParticleData[i].active = true;
        emitted++;
      }
    }
  }

  private emitWaterParticle(waterTemp: number): void {
    for (let i = 0; i < this.maxWaterParticles; i++) {
      if (!this.waterParticleData[i].active) {
        const spoutOffset = new THREE.Vector3(0.15, 0.05, 0);
        const angleRad = (this.pourAngle * Math.PI) / 180;
        const rotatedOffset = new THREE.Vector3(
          spoutOffset.x * Math.cos(angleRad) - spoutOffset.y * Math.sin(angleRad),
          spoutOffset.x * Math.sin(angleRad) + spoutOffset.y * Math.cos(angleRad),
          spoutOffset.z
        );

        this.waterParticleData[i].position.copy(this.teapotPosition).add(rotatedOffset);
        
        const speed = 2 + Math.random() * 0.5;
        this.waterParticleData[i].velocity.set(
          Math.sin(angleRad) * speed * 0.5,
          Math.cos(angleRad) * speed,
          (Math.random() - 0.5) * 0.2
        );
        
        this.waterParticleData[i].life = 0;
        this.waterParticleData[i].maxLife = 0.8 + Math.random() * 0.2;
        this.waterParticleData[i].active = true;

        const teaColor = this.getTeaColor(waterTemp);
        const geometry = this.waterParticles?.geometry;
        if (geometry) {
          const colors = geometry.attributes.color.array as Float32Array;
          colors[i * 3] = teaColor.r * 0.8 + 0.2;
          colors[i * 3 + 1] = teaColor.g * 0.8 + 0.2;
          colors[i * 3 + 2] = teaColor.b * 0.8 + 0.2;
        }
        break;
      }
    }
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  update(delta: number, waterTemp: number): void {
    const now = performance.now();

    if (this.isPouring) {
      const elapsed = (now - this.pourStartTime) / 1000;
      const pourDuration = this.waterFillDuration;

      if (elapsed < pourDuration) {
        const particlesPerSecond = 60 + Math.random() * 40;
        const particlesToEmit = Math.floor(particlesPerSecond * delta);
        for (let i = 0; i < particlesToEmit; i++) {
          this.emitWaterParticle(waterTemp);
        }
      } else if (elapsed >= pourDuration + 0.3) {
        this.isPouring = false;
        if (this.onPourComplete) {
          this.onPourComplete();
        }
      }
    }

    if (this.teacupWaterMesh && this.waterFillStartTime > 0) {
      const fillElapsed = (now - this.waterFillStartTime) / 1000;
      const fillProgress = Math.min(fillElapsed / this.waterFillDuration, 1);
      const easedProgress = this.easeInOut(fillProgress);
      
      const currentY = this.teacupWaterMinY + 
        (this.teacupWaterMaxY - this.teacupWaterMinY) * easedProgress;
      
      this.teacupWaterMesh.position.y = currentY;
      this.teacupWaterMesh.scale.y = 0.1 + easedProgress * 0.9;

      const material = this.teacupWaterMesh.material as THREE.MeshStandardMaterial;
      if (material) {
        const targetColor = this.getTeaColor(waterTemp);
        material.color.lerp(targetColor, 0.05);
      }
    }

    this.updateWaterParticles(delta);
    this.updateAromaParticles(delta);

    if (this.isAromaActive) {
      const aromaElapsed = (now - this.aromaStartTime) / 1000;
      if (aromaElapsed >= 3.5) {
        this.isAromaActive = false;
        if (this.onAromaComplete) {
          this.onAromaComplete(this.aromaParticleCount);
        }
      }
    }
  }

  private updateWaterParticles(delta: number): void {
    if (!this.waterParticles) return;

    const geometry = this.waterParticles.geometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const sizes = geometry.attributes.size.array as Float32Array;

    for (let i = 0; i < this.maxWaterParticles; i++) {
      const particle = this.waterParticleData[i];
      
      if (particle.active) {
        particle.life += delta;
        particle.velocity.y += this.gravity * delta * 0.1;
        particle.position.add(particle.velocity.clone().multiplyScalar(delta));

        positions[i * 3] = particle.position.x;
        positions[i * 3 + 1] = particle.position.y;
        positions[i * 3 + 2] = particle.position.z;

        const lifeRatio = particle.life / particle.maxLife;
        sizes[i] = 0.03 * (1 - lifeRatio * 0.3);

        if (particle.life >= particle.maxLife || 
            particle.position.y < this.teacupPosition.y - 0.5) {
          particle.active = false;
          positions[i * 3 + 1] = -1000;
          sizes[i] = 0;
        }
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  private updateAromaParticles(delta: number): void {
    if (!this.aromaParticles) return;

    const geometry = this.aromaParticles.geometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const colors = geometry.attributes.color.array as Float32Array;
    const sizes = geometry.attributes.size.array as Float32Array;

    for (let i = 0; i < this.maxAromaParticles; i++) {
      const particle = this.aromaParticleData[i];
      
      if (particle.active) {
        particle.life += delta;
        particle.position.add(particle.velocity.clone().multiplyScalar(delta));
        particle.velocity.multiplyScalar(0.98);
        particle.velocity.y += 0.05 * delta;

        positions[i * 3] = particle.position.x;
        positions[i * 3 + 1] = particle.position.y;
        positions[i * 3 + 2] = particle.position.z;

        const lifeRatio = particle.life / particle.maxLife;
        const currentColor = new THREE.Color().lerpColors(
          particle.startColor,
          particle.endColor,
          lifeRatio
        );
        colors[i * 3] = currentColor.r;
        colors[i * 3 + 1] = currentColor.g;
        colors[i * 3 + 2] = currentColor.b;

        sizes[i] = 0.04 * (1 - lifeRatio * 0.5) * (1 + Math.sin(lifeRatio * Math.PI) * 0.3);

        if (particle.life >= particle.maxLife) {
          particle.active = false;
          positions[i * 3 + 1] = -1000;
          sizes[i] = 0;
        }
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
  }

  reset(): void {
    this.isPouring = false;
    this.isAromaActive = false;
    this.waterFillStartTime = 0;
    this.pourStartTime = 0;
    this.aromaStartTime = 0;
    this.aromaParticleCount = 0;
    this.onPourComplete = null;
    this.onAromaComplete = null;

    if (this.teacupWaterMesh) {
      this.teacupWaterMesh.position.y = this.teacupWaterMinY;
      this.teacupWaterMesh.scale.y = 0.1;
      const material = this.teacupWaterMesh.material as THREE.MeshStandardMaterial;
      if (material) {
        material.color.setHex(0xffffff);
      }
    }

    if (this.waterParticles) {
      const positions = this.waterParticles.geometry.attributes.position.array as Float32Array;
      const sizes = this.waterParticles.geometry.attributes.size.array as Float32Array;
      for (let i = 0; i < this.maxWaterParticles; i++) {
        this.waterParticleData[i].active = false;
        positions[i * 3 + 1] = -1000;
        sizes[i] = 0;
      }
      this.waterParticles.geometry.attributes.position.needsUpdate = true;
      this.waterParticles.geometry.attributes.size.needsUpdate = true;
    }

    if (this.aromaParticles) {
      const positions = this.aromaParticles.geometry.attributes.position.array as Float32Array;
      const sizes = this.aromaParticles.geometry.attributes.size.array as Float32Array;
      for (let i = 0; i < this.maxAromaParticles; i++) {
        this.aromaParticleData[i].active = false;
        positions[i * 3 + 1] = -1000;
        sizes[i] = 0;
      }
      this.aromaParticles.geometry.attributes.position.needsUpdate = true;
      this.aromaParticles.geometry.attributes.size.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.waterParticles) {
      this.scene.remove(this.waterParticles);
      this.waterParticles.geometry.dispose();
      (this.waterParticles.material as THREE.Material).dispose();
    }
    if (this.aromaParticles) {
      this.scene.remove(this.aromaParticles);
      this.aromaParticles.geometry.dispose();
      (this.aromaParticles.material as THREE.Material).dispose();
    }
    this.waterParticleData = [];
    this.aromaParticleData = [];
  }
}
