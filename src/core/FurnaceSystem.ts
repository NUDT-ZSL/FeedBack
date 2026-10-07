import * as THREE from 'three';
import { ForgeScene } from './ForgeScene';

interface IronParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  mesh: THREE.Mesh;
}

interface SmokeParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  mesh: THREE.Mesh;
}

interface SteamParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  mesh: THREE.Mesh;
}

export class FurnaceSystem {
  private forgeScene: ForgeScene;
  private airFlow: number;
  private temperature: number;
  private ironParticles: IronParticle[];
  private ironParticlePool: THREE.Mesh[];
  private smokeParticles: SmokeParticle[];
  private steamParticles: SteamParticle[];
  private isPouring: boolean;
  private pourTargetPosition: THREE.Vector3 | null;
  private currentMoldType: string | null;
  private moldTemperature: number;
  private isCooling: boolean;
  private coolingStartTime: number;
  private initialTemperature: number;
  private tempUpdateCallback: ((temp: number) => void) | null;

  constructor(forgeScene: ForgeScene) {
    this.forgeScene = forgeScene;
    this.airFlow = 0;
    this.temperature = 800;
    this.ironParticles = [];
    this.ironParticlePool = [];
    this.smokeParticles = [];
    this.steamParticles = [];
    this.isPouring = false;
    this.pourTargetPosition = null;
    this.currentMoldType = null;
    this.moldTemperature = 0;
    this.isCooling = false;
    this.coolingStartTime = 0;
    this.initialTemperature = 0;
    this.tempUpdateCallback = null;
  }

  init(): void {
    this.initIronParticlePool();
  }

  update(): void {
    // 更新由 ForgeScene 的 onUpdate 回调处理
  }

  private initIronParticlePool(): void {
    const maxParticles = 60;
    for (let i = 0; i < maxParticles; i++) {
      const geo = new THREE.SphereGeometry(0.05, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffa500,
        transparent: true,
        opacity: 0.9
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.forgeScene.getScene().add(mesh);
      this.ironParticlePool.push(mesh);
    }
  }

  setAirFlow(value: number): void {
    this.airFlow = Math.max(0, Math.min(1, value));
    this.temperature = this.airFlow * 1000 + 800;
    
    if (this.tempUpdateCallback) {
      this.tempUpdateCallback(this.temperature);
    }
    
    this.updateFurnaceGlow();
    this.updateTemperatureDisplay();
  }

  getAirFlow(): number {
    return this.airFlow;
  }

  getTemperature(): number {
    return this.temperature;
  }

  private updateFurnaceGlow(): void {
    const glow = this.forgeScene.getScene().getObjectByName('furnaceGlow') as THREE.PointLight;
    if (glow) {
      const tempRatio = (this.temperature - 800) / 800;
      glow.intensity = 1 + tempRatio * 3;
      const color = this.getTemperatureColor(this.temperature);
      glow.color.setHex(color);
    }
  }

  getTemperatureColor(temp: number): number {
    const t = Math.max(0, Math.min(1, (temp - 800) / 800));
    
    if (t < 0.25) {
      const localT = t / 0.25;
      return this.lerpColor(0x8b0000, 0xff4400, localT);
    } else if (t < 0.5) {
      const localT = (t - 0.25) / 0.25;
      return this.lerpColor(0xff4400, 0xff8800, localT);
    } else if (t < 0.75) {
      const localT = (t - 0.5) / 0.25;
      return this.lerpColor(0xff8800, 0xffcc00, localT);
    } else {
      const localT = (t - 0.75) / 0.25;
      return this.lerpColor(0xffcc00, 0xffffe0, localT);
    }
  }

  private lerpColor(color1: number, color2: number, t: number): number {
    const r1 = (color1 >> 16) & 255;
    const g1 = (color1 >> 8) & 255;
    const b1 = color1 & 255;
    const r2 = (color2 >> 16) & 255;
    const g2 = (color2 >> 8) & 255;
    const b2 = color2 & 255;
    
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    
    return (r << 16) | (g << 8) | b;
  }

  private updateTemperatureDisplay(): void {
    const bubble = document.getElementById('temperature-bubble');
    if (bubble) {
      const furnace = this.forgeScene.getObject('furnace');
      if (furnace) {
        const screenPos = this.forgeScene.worldToScreen(new THREE.Vector3(0, 5.5, 0));
        bubble.style.left = screenPos.x + 'px';
        bubble.style.top = screenPos.y + 'px';
        bubble.style.display = 'block';
        bubble.textContent = `${Math.round(this.temperature)}°C`;
        const color = '#' + this.getTemperatureColor(this.temperature).toString(16).padStart(6, '0');
        bubble.style.color = color;
      }
    }
  }

  startPouring(moldType: string, targetPosition: THREE.Vector3): void {
    if (this.temperature < 1200) {
      console.warn('温度不足，无法浇铸！请先提升炉温到1200°C以上。');
      return;
    }
    
    this.isPouring = true;
    this.pourTargetPosition = targetPosition.clone();
    this.currentMoldType = moldType;
    this.moldTemperature = this.temperature;
    this.isCooling = false;
    
    this.forgeScene.getScene().getObjectByName('furnaceGlow')!;
  }

  stopPouring(): void {
    this.isPouring = false;
    this.pourTargetPosition = null;
    this.isCooling = true;
    this.coolingStartTime = Date.now();
    this.initialTemperature = this.moldTemperature;
    this.startSmokeEffect();
  }

  isPouringActive(): boolean {
    return this.isPouring;
  }

  getMoldTemperature(): number {
    return this.moldTemperature;
  }

  isMoldCooled(): boolean {
    return this.isCooling && this.moldTemperature <= 100;
  }

  startCooling(): void {
    if (!this.isCooling) {
      this.isCooling = true;
      this.coolingStartTime = Date.now();
      this.initialTemperature = this.moldTemperature;
    }
  }

  getMoldType(): string | null {
    return this.currentMoldType;
  }

  private spawnIronParticle(): void {
    if (!this.pourTargetPosition || this.ironParticles.length >= 60) return;
    
    const availableMesh = this.ironParticlePool.find(m => !m.visible);
    if (!availableMesh) return;
    
    const spoutPosition = new THREE.Vector3(0.8, 1.5, 1.4);
    const target = this.pourTargetPosition.clone();
    target.y = 0.5;
    
    const direction = target.clone().sub(spoutPosition).normalize();
    const distance = spoutPosition.distanceTo(target);
    const speed = distance * 1.5;
    
    const gravity = -9.8;
    const timeToTarget = distance / speed;
    const initialYVel = (-0.5 * gravity * timeToTarget * timeToTarget) / timeToTarget;
    
    const velocity = direction.multiplyScalar(speed);
    velocity.y = initialYVel;
    
    availableMesh.visible = true;
    availableMesh.position.copy(spoutPosition);
    (availableMesh.material as THREE.MeshBasicMaterial).color.setHex(this.getTemperatureColor(this.temperature));
    (availableMesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    
    const particle: IronParticle = {
      position: spoutPosition.clone(),
      velocity,
      life: 0,
      maxLife: timeToTarget * 1.2,
      mesh: availableMesh
    };
    
    this.ironParticles.push(particle);
  }

  private updateParticles(delta: number): void {
    if (this.isPouring && this.pourTargetPosition) {
      const spawnRate = 40 + Math.floor((this.temperature - 800) / 20);
      const spawnChance = (spawnRate / 60) * delta * 10;
      if (Math.random() < spawnChance) {
        this.spawnIronParticle();
      }
    }
    
    for (let i = this.ironParticles.length - 1; i >= 0; i--) {
      const p = this.ironParticles[i];
      p.life += delta;
      
      p.velocity.y -= 9.8 * delta;
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      p.mesh.position.copy(p.position);
      
      const opacity = 1 - (p.life / p.maxLife) * 0.5;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      
      if (this.pourTargetPosition) {
        const dist = p.position.distanceTo(this.pourTargetPosition);
        if (dist < 0.3 || p.life > p.maxLife) {
          p.mesh.visible = false;
          this.ironParticles.splice(i, 1);
        }
      } else if (p.life > p.maxLife) {
        p.mesh.visible = false;
        this.ironParticles.splice(i, 1);
      }
    }
    
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life += delta;
      
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      p.mesh.position.copy(p.position);
      
      const scale = 0.1 + (p.life / p.maxLife) * 0.3;
      p.mesh.scale.setScalar(scale);
      
      const opacity = 0.6 * (1 - p.life / p.maxLife);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      
      if (p.life > p.maxLife) {
        this.forgeScene.getScene().remove(p.mesh);
        this.smokeParticles.splice(i, 1);
      }
    }
    
    for (let i = this.steamParticles.length - 1; i >= 0; i--) {
      const p = this.steamParticles[i];
      p.life += delta;
      
      p.position.add(p.velocity.clone().multiplyScalar(delta));
      p.mesh.position.copy(p.position);
      
      const scale = 0.1 + (p.life / p.maxLife) * 0.2;
      p.mesh.scale.setScalar(scale);
      
      const opacity = 1 - p.life / p.maxLife;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      
      if (p.life > p.maxLife) {
        this.forgeScene.getScene().remove(p.mesh);
        this.steamParticles.splice(i, 1);
      }
    }
    
    if (this.isCooling && this.moldTemperature > 100) {
      const elapsed = (Date.now() - this.coolingStartTime) / 1000;
      const decayConstant = Math.log(2) / 2;
      this.moldTemperature = 100 + (this.initialTemperature - 100) * Math.exp(-decayConstant * elapsed);
    }
    
    const waterSurface = this.forgeScene.getObject('waterSurface') as THREE.Mesh;
    if (waterSurface) {
      const time = Date.now() * 0.001;
      const waveOffset = Math.sin(time * 2) * 0.01;
      waterSurface.position.y = 0.45 + waveOffset;
    }
  }

  private startSmokeEffect(): void {
    if (!this.pourTargetPosition) return;
    
    const smokeCount = 15;
    for (let i = 0; i < smokeCount; i++) {
      setTimeout(() => {
        if (!this.pourTargetPosition) return;
        
        const geo = new THREE.SphereGeometry(0.1, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xcccccc,
          transparent: true,
          opacity: 0.6
        });
        const mesh = new THREE.Mesh(geo, mat);
        
        const pos = this.pourTargetPosition.clone();
        pos.x += (Math.random() - 0.5) * 0.5;
        pos.z += (Math.random() - 0.5) * 0.5;
        pos.y = 0.5;
        
        mesh.position.copy(pos);
        this.forgeScene.getScene().add(mesh);
        
        const particle: SmokeParticle = {
          position: pos,
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            0.5 + Math.random() * 0.3,
            (Math.random() - 0.5) * 0.2
          ),
          life: 0,
          maxLife: 4,
          mesh
        };
        
        this.smokeParticles.push(particle);
      }, i * 200);
    }
  }

  startSteamEffect(position: THREE.Vector3): void {
    console.log('嘶嘶嘶... 淬火蒸汽升腾！');
    
    const steamCount = 25;
    for (let i = 0; i < steamCount; i++) {
      const geo = new THREE.SphereGeometry(0.08, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9
      });
      const mesh = new THREE.Mesh(geo, mat);
      
      const pos = position.clone();
      pos.x += (Math.random() - 0.5) * 0.4;
      pos.z += (Math.random() - 0.5) * 0.4;
      pos.y = 0.6;
      
      mesh.position.copy(pos);
      this.forgeScene.getScene().add(mesh);
      
      const particle: SteamParticle = {
        position: pos,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          1 + Math.random() * 0.5,
          (Math.random() - 0.5) * 0.3
        ),
        life: 0,
        maxLife: 1.5,
        mesh
      };
      
      this.steamParticles.push(particle);
    }
  }

  onTemperatureUpdate(callback: (temp: number) => void): void {
    this.tempUpdateCallback = callback;
  }

  reset(): void {
    this.ironParticles.forEach(p => p.mesh.visible = false);
    this.ironParticles = [];
    this.isPouring = false;
    this.pourTargetPosition = null;
    this.currentMoldType = null;
    this.isCooling = false;
    this.moldTemperature = 0;
  }
}
