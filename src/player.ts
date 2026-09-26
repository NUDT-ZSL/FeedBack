import * as THREE from 'three';
import { MazeData, GemData, WallData } from './maze';

export interface PlayerState {
  position: THREE.Vector3;
  collectedGems: number[];
  isFlashing: boolean;
  flashColor: THREE.Color;
}

export class Player {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  speed: number;
  radius: number;
  private keys: Set<string>;
  private mazeData: MazeData;
  private collectedGemIndices: Set<number>;
  private isFlashing: boolean;
  private flashTimer: number;
  private flashColor: THREE.Color;
  private baseColor: THREE.Color;
  private breathePhase: number;
  private originalEmissiveIntensity: number;

  constructor(mazeData: MazeData) {
    this.mazeData = mazeData;
    this.speed = 2;
    this.radius = 0.3;
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.collectedGemIndices = new Set();
    this.isFlashing = false;
    this.flashTimer = 0;
    this.flashColor = new THREE.Color(0xff0000);
    this.baseColor = new THREE.Color(0xffd700);
    this.breathePhase = 0;
    this.originalEmissiveIntensity = 0.3;

    const geometry = new THREE.SphereGeometry(this.radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: this.baseColor,
      emissive: this.baseColor,
      emissiveIntensity: this.originalEmissiveIntensity,
      metalness: 0.8,
      roughness: 0.2
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(mazeData.startX, this.radius, mazeData.startZ);
    this.mesh.castShadow = true;

    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.key.toLowerCase());
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key.toLowerCase());
  }

  update(deltaTime: number): void {
    this.breathePhase += deltaTime * 2;
    const breatheIntensity = this.originalEmissiveIntensity + Math.sin(this.breathePhase) * 0.1;

    const material = this.mesh.material as THREE.MeshStandardMaterial;

    if (this.isFlashing) {
      this.flashTimer -= deltaTime;
      if (this.flashTimer <= 0) {
        this.isFlashing = false;
        material.color.copy(this.baseColor);
        material.emissive.copy(this.baseColor);
        material.emissiveIntensity = breatheIntensity;
      }
    } else {
      material.emissiveIntensity = breatheIntensity;
    }

    const moveX = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    const moveZ = (this.keys.has('s') ? 1 : 0) - (this.keys.has('w') ? 1 : 0);

    if (moveX !== 0 || moveZ !== 0) {
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      this.velocity.x = (moveX / length) * this.speed;
      this.velocity.z = (moveZ / length) * this.speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    const newPos = this.mesh.position.clone();
    newPos.x += this.velocity.x * deltaTime;
    newPos.z += this.velocity.z * deltaTime;

    if (!this.checkWallCollision(newPos.x, this.mesh.position.z)) {
      this.mesh.position.x = newPos.x;
    } else {
      this.triggerFlash();
    }

    if (!this.checkWallCollision(this.mesh.position.x, newPos.z)) {
      this.mesh.position.z = newPos.z;
    } else {
      this.triggerFlash();
    }
  }

  private checkWallCollision(px: number, pz: number): boolean {
    for (const wall of this.mazeData.walls) {
      if (this.sphereBoxCollision(px, pz, this.radius, wall)) {
        return true;
      }
    }
    return false;
  }

  private sphereBoxCollision(px: number, pz: number, radius: number, wall: WallData): boolean {
    const halfW = wall.width / 2;
    const halfD = wall.depth / 2;

    const closestX = Math.max(wall.x - halfW, Math.min(px, wall.x + halfW));
    const closestZ = Math.max(wall.z - halfD, Math.min(pz, wall.z + halfD));

    const dx = px - closestX;
    const dz = pz - closestZ;

    return (dx * dx + dz * dz) < (radius * radius);
  }

  private triggerFlash(): void {
    if (this.isFlashing) return;
    this.isFlashing = true;
    this.flashTimer = 0.1;
    const material = this.mesh.material as THREE.MeshStandardMaterial;
    material.color.copy(this.flashColor);
    material.emissive.copy(this.flashColor);
    material.emissiveIntensity = 0.8;
  }

  checkGemCollection(): number | null {
    const playerPos = this.mesh.position;
    const pickupRange = 1;

    for (let i = 0; i < this.mazeData.gems.length; i++) {
      if (this.collectedGemIndices.has(i)) continue;

      const gem = this.mazeData.gems[i];
      const dx = playerPos.x - gem.x;
      const dz = playerPos.z - gem.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < pickupRange) {
        this.collectedGemIndices.add(i);
        return i;
      }
    }
    return null;
  }

  getCollectedCount(): number {
    return this.collectedGemIndices.size;
  }

  getTotalGems(): number {
    return this.mazeData.gems.length;
  }

  isGemCollected(index: number): boolean {
    return this.collectedGemIndices.has(index);
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone();
  }

  checkExit(): boolean {
    if (this.collectedGemIndices.size < this.mazeData.gems.length) return false;

    const dx = this.mesh.position.x - this.mazeData.exitX;
    const dz = this.mesh.position.z - this.mazeData.exitZ;
    const distance = Math.sqrt(dx * dx + dz * dz);

    return distance < 1;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
    window.removeEventListener('keyup', this.onKeyUp.bind(this));
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
