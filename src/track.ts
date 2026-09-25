import * as THREE from 'three';

export interface TrackSegment {
  mesh: THREE.Mesh;
  startZ: number;
  endZ: number;
}

export interface Obstacle {
  mesh: THREE.Object3D;
  type: 'jump' | 'slide' | 'coin';
  position: THREE.Vector3;
  collected?: boolean;
  hit?: boolean;
}

export interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class TrackManager {
  private scene: THREE.Scene;
  private segments: TrackSegment[] = [];
  private obstacles: Obstacle[] = [];
  private particles: Particle[] = [];

  private segmentLength: number = 8;
  private trackWidth: number = 4;
  private trackY: number = 0;

  private currentBeat: number = 0;
  private lastSegmentZ: number = 0;
  private viewDistance: number = 80;
  private despawnDistance: number = 20;

  private energyLevel: number = 0.5;

  private warmColor: THREE.Color = new THREE.Color(0xff6600);
  private coolColor: THREE.Color = new THREE.Color(0x00ffff);
  private currentColor: THREE.Color = new THREE.Color(0x00ffff);

  private coinRotationSpeed: number = 3;

  private obstacleChance: number = 0.6;
  private coinChance: number = 0.4;

  private pointLight: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.pointLight = new THREE.PointLight(0x00ffff, 1, 30);
    this.pointLight.position.set(0, 5, -5);
    this.scene.add(this.pointLight);

    this.initTrack();
  }

  private initTrack(): void {
    const initialSegments = Math.ceil(this.viewDistance / this.segmentLength);
    for (let i = 0; i < initialSegments; i++) {
      this.createSegment(-i * this.segmentLength);
    }
    this.lastSegmentZ = -(initialSegments - 1) * this.segmentLength;
  }

  private createSegment(zPos: number): void {
    const floorGeo = new THREE.BoxGeometry(this.trackWidth, 0.2, this.segmentLength);
    const floorMat = new THREE.MeshStandardMaterial({
      color: this.currentColor.clone(),
      emissive: this.currentColor.clone().multiplyScalar(0.2),
      metalness: 0.3,
      roughness: 0.7
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, this.trackY - 0.1, zPos - this.segmentLength / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const railGeo = new THREE.BoxGeometry(0.15, 0.8, this.segmentLength);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      emissive: 0xff00ff,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2
    });

    const leftRail = new THREE.Mesh(railGeo, railMat);
    leftRail.position.set(-this.trackWidth / 2, this.trackY + 0.3, zPos - this.segmentLength / 2);
    this.scene.add(leftRail);

    const rightRail = new THREE.Mesh(railGeo, railMat.clone());
    rightRail.position.set(this.trackWidth / 2, this.trackY + 0.3, zPos - this.segmentLength / 2);
    this.scene.add(rightRail);

    const segment: TrackSegment = {
      mesh: floor,
      startZ: zPos,
      endZ: zPos - this.segmentLength
    };
    this.segments.push(segment);

    const lineGeo = new THREE.BoxGeometry(0.02, 0.02, this.segmentLength);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    for (let lane = -1; lane <= 1; lane++) {
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.position.set(lane * 1.3, 0.11, 0);
      floor.add(line);
    }
  }

  onBeat(): void {
    this.currentBeat++;

    if (Math.random() < this.obstacleChance) {
      this.generateObstacle();
    }
  }

  private generateObstacle(): void {
    const spawnZ = this.lastSegmentZ - this.segmentLength;
    const laneIndex = Math.floor(Math.random() * 3) - 1;
    const xPos = laneIndex * 1.3;

    const rand = Math.random();

    if (rand < 0.35) {
      this.createJumpObstacle(xPos, spawnZ);
    } else if (rand < 0.6) {
      this.createSlideObstacle(xPos, spawnZ);
    } else {
      this.createCoin(xPos, spawnZ);
    }

    if (Math.random() < this.coinChance) {
      const coinLane = Math.floor(Math.random() * 3) - 1;
      if (coinLane !== laneIndex || rand >= 0.6) {
        this.createCoin(coinLane * 1.3, spawnZ + 1);
      }
    }
  }

  private createJumpObstacle(x: number, z: number): void {
    const height = 0.5 + Math.random() * 1.0;

    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(1.0, height, 0.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff2200,
      emissiveIntensity: 0.3,
      metalness: 0.6,
      roughness: 0.4
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = height / 2;
    group.add(body);

    const topGeo = new THREE.BoxGeometry(1.1, 0.1, 0.9);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xffff00,
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
      metalness: 0.8,
      roughness: 0.2
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = height + 0.05;
    group.add(top);

    group.position.set(x, 0, z);
    this.scene.add(group);

    this.obstacles.push({
      mesh: group,
      type: 'jump',
      position: new THREE.Vector3(x, height / 2, z)
    });
  }

  private createSlideObstacle(x: number, z: number): void {
    const height = 0.5;

    const group = new THREE.Group();

    const barGeo = new THREE.BoxGeometry(1.2, 0.15, 0.15);
    const barMat = new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      emissive: 0xff00ff,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.1
    });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.y = height;
    group.add(bar);

    const postGeo = new THREE.BoxGeometry(0.1, height, 0.1);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x880088,
      emissive: 0x440044,
      emissiveIntensity: 0.3,
      metalness: 0.7,
      roughness: 0.3
    });
    const leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(-0.55, height / 2, 0);
    group.add(leftPost);

    const rightPost = new THREE.Mesh(postGeo, postMat.clone());
    rightPost.position.set(0.55, height / 2, 0);
    group.add(rightPost);

    group.position.set(x, 0, z);
    this.scene.add(group);

    this.obstacles.push({
      mesh: group,
      type: 'slide',
      position: new THREE.Vector3(x, height, z)
    });
  }

  private createCoin(x: number, z: number): void {
    const group = new THREE.Group();

    const coinGeo = new THREE.TorusGeometry(0.25, 0.08, 8, 16);
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.1
    });
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.rotation.x = Math.PI / 2;
    group.add(coin);

    const innerGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xffff88,
      emissive: 0xffff00,
      emissiveIntensity: 0.5,
      metalness: 0.9,
      roughness: 0.1
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = Math.PI / 2;
    group.add(inner);

    group.position.set(x, 1.2, z);
    this.scene.add(group);

    this.obstacles.push({
      mesh: group,
      type: 'coin',
      position: new THREE.Vector3(x, 1.2, z),
      collected: false
    });
  }

  createCoinParticles(position: THREE.Vector3): void {
    const particleCount = 30;
    const particleGeo = new THREE.SphereGeometry(0.08, 4, 4);

    for (let i = 0; i < particleCount; i++) {
      const particleMat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 1
      });
      const mesh = new THREE.Mesh(particleGeo, particleMat);
      mesh.position.copy(position);

      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        1 + Math.random() * 3,
        Math.sin(angle) * speed
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        life: 0.3,
        maxLife: 0.3
      });
    }
  }

  update(deltaTime: number, playerZ: number): void {
    this.updateSegments(playerZ);
    this.updateObstacles(deltaTime, playerZ);
    this.updateParticles(deltaTime);
    this.updateLight(playerZ);
  }

  private updateSegments(playerZ: number): void {
    while (this.lastSegmentZ > playerZ - this.viewDistance) {
      this.lastSegmentZ -= this.segmentLength;
      this.createSegment(this.lastSegmentZ);
    }

    this.segments = this.segments.filter(seg => {
      if (seg.startZ > playerZ + this.despawnDistance) {
        this.scene.remove(seg.mesh);
        seg.mesh.geometry.dispose();
        if (Array.isArray(seg.mesh.material)) {
          seg.mesh.material.forEach(m => m.dispose());
        } else {
          seg.mesh.material.dispose();
        }
        return false;
      }
      return true;
    });
  }

  private updateObstacles(deltaTime: number, playerZ: number): void {
    this.obstacles = this.obstacles.filter(obs => {
      if (obs.type === 'coin' && !obs.collected) {
        obs.mesh.rotation.y += this.coinRotationSpeed * deltaTime;
        const floatOffset = Math.sin(performance.now() / 300 + obs.position.z) * 0.1;
        obs.mesh.position.y = obs.position.y + floatOffset;
      }

      if (obs.position.z > playerZ + this.despawnDistance) {
        this.scene.remove(obs.mesh);
        obs.mesh.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
        return false;
      }

      return !(obs.collected || obs.hit);
    });
  }

  private updateParticles(deltaTime: number): void {
    this.particles = this.particles.filter(p => {
      p.life -= deltaTime;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        if (p.mesh.material instanceof THREE.Material) {
          p.mesh.material.dispose();
        }
        return false;
      }

      p.velocity.y -= 10 * deltaTime;
      p.mesh.position.add(p.velocity.clone().multiplyScalar(deltaTime));

      const opacity = p.life / p.maxLife;
      if (p.mesh.material instanceof THREE.MeshBasicMaterial) {
        p.mesh.material.opacity = opacity;
      }

      return true;
    });
  }

  private updateLight(playerZ: number): void {
    this.pointLight.position.z = playerZ - 5;
    this.pointLight.position.y = 5 + Math.sin(performance.now() / 500) * 0.5;
  }

  checkCollisions(playerBox: THREE.Box3, isJumping: boolean): { coins: number; damage: boolean } {
    let coinsCollected = 0;
    let damageTaken = false;

    for (const obs of this.obstacles) {
      if (obs.collected || obs.hit) continue;

      const obsBox = this.getObstacleBox(obs);

      if (playerBox.intersectsBox(obsBox)) {
        if (obs.type === 'coin') {
          obs.collected = true;
          coinsCollected++;
          this.createCoinParticles(obs.position.clone());
        } else if (obs.type === 'jump') {
          if (playerBox.min.y < obs.position.y + 0.5) {
            obs.hit = true;
            damageTaken = true;
          }
        } else if (obs.type === 'slide') {
          if (!isJumping && playerBox.max.y > obs.position.y) {
            obs.hit = true;
            damageTaken = true;
          }
        }
      }
    }

    return { coins: coinsCollected, damage: damageTaken };
  }

  private getObstacleBox(obs: Obstacle): THREE.Box3 {
    const box = new THREE.Box3();

    switch (obs.type) {
      case 'jump':
        const jumpHeight = obs.position.y * 2;
        box.set(
          new THREE.Vector3(obs.position.x - 0.5, 0, obs.position.z - 0.4),
          new THREE.Vector3(obs.position.x + 0.5, jumpHeight + 0.2, obs.position.z + 0.4)
        );
        break;
      case 'slide':
        box.set(
          new THREE.Vector3(obs.position.x - 0.6, obs.position.y - 0.1, obs.position.z - 0.15),
          new THREE.Vector3(obs.position.x + 0.6, obs.position.y + 0.1, obs.position.z + 0.15)
        );
        break;
      case 'coin':
        box.set(
          new THREE.Vector3(obs.position.x - 0.3, obs.position.y - 0.3, obs.position.z - 0.3),
          new THREE.Vector3(obs.position.x + 0.3, obs.position.y + 0.3, obs.position.z + 0.3)
        );
        break;
    }

    return box;
  }

  updateColors(energyLevel: number): void {
    this.energyLevel = energyLevel;
    this.currentColor.lerpColors(this.warmColor, this.coolColor, energyLevel);

    for (const seg of this.segments) {
      if (seg.mesh.material instanceof THREE.MeshStandardMaterial) {
        seg.mesh.material.color.copy(this.currentColor);
        seg.mesh.material.emissive.copy(this.currentColor).multiplyScalar(0.2);
      }
    }
  }

  setBeatIntensity(intensity: number): void {
    const lightIntensity = 0.3 + intensity * 1.2;
    this.pointLight.intensity = lightIntensity;

    const lightColor = new THREE.Color().lerpColors(
      new THREE.Color(0x00ffff),
      new THREE.Color(0xff00ff),
      intensity
    );
    this.pointLight.color.copy(lightColor);
  }

  getSegmentLength(): number {
    return this.segmentLength;
  }

  getObstacles(): Obstacle[] {
    return this.obstacles;
  }

  reset(): void {
    for (const seg of this.segments) {
      this.scene.remove(seg.mesh);
      seg.mesh.geometry.dispose();
      if (Array.isArray(seg.mesh.material)) {
        seg.mesh.material.forEach(m => m.dispose());
      } else {
        seg.mesh.material.dispose();
      }
    }
    this.segments = [];

    for (const obs of this.obstacles) {
      this.scene.remove(obs.mesh);
      obs.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
    this.obstacles = [];

    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      if (p.mesh.material instanceof THREE.Material) {
        p.mesh.material.dispose();
      }
    }
    this.particles = [];

    this.currentBeat = 0;
    this.lastSegmentZ = 0;
    this.initTrack();
  }
}
