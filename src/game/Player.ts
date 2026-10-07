import * as THREE from 'three';
import { PlayerState } from '../types';

export class Player {
  private mesh: THREE.Group;
  private skeleton: {
    body: THREE.Mesh;
    head: THREE.Mesh;
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
    basket: THREE.Mesh;
  };
  private state: PlayerState;
  private animationTime: number = 0;
  private targetPosition: THREE.Vector3 | null = null;
  private moveSpeed: number = 5;

  constructor() {
    this.mesh = new THREE.Group();
    
    this.state = {
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      isWalking: false,
      isPicking: false,
      basketCount: 0
    };

    this.skeleton = this.createSkeleton();
    this.mesh.add(this.skeleton.body);
    this.mesh.add(this.skeleton.head);
    this.mesh.add(this.skeleton.leftArm);
    this.mesh.add(this.skeleton.rightArm);
    this.mesh.add(this.skeleton.leftLeg);
    this.mesh.add(this.skeleton.rightLeg);
    this.mesh.add(this.skeleton.basket);
  }

  private createSkeleton(): Player['skeleton'] {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd4a574 });
    const clothMaterial = new THREE.MeshStandardMaterial({ color: 0x2e4a32 });

    const bodyGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
    const body = new THREE.Mesh(bodyGeometry, clothMaterial);
    body.position.y = 0.5;
    body.castShadow = true;

    const headGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const head = new THREE.Mesh(headGeometry, skinMaterial);
    head.position.y = 0.95;
    head.castShadow = true;

    const hairGeometry = new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const hair = new THREE.Mesh(hairGeometry, hairMaterial);
    hair.position.y = 0.05;
    head.add(hair);

    const armGeometry = new THREE.CapsuleGeometry(0.04, 0.3, 4, 8);
    const leftArm = new THREE.Mesh(armGeometry, clothMaterial);
    leftArm.position.set(-0.22, 0.55, 0);
    leftArm.rotation.z = 0.3;
    leftArm.castShadow = true;

    const rightArm = new THREE.Mesh(armGeometry, clothMaterial);
    rightArm.position.set(0.22, 0.55, 0);
    rightArm.rotation.z = -0.3;
    rightArm.castShadow = true;

    const legGeometry = new THREE.CapsuleGeometry(0.05, 0.3, 4, 8);
    const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);
    leftLeg.position.set(-0.08, 0.15, 0);
    leftLeg.castShadow = true;

    const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);
    rightLeg.position.set(0.08, 0.15, 0);
    rightLeg.castShadow = true;

    const basketGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.15, 8);
    const basketMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const basket = new THREE.Mesh(basketGeometry, basketMaterial);
    basket.position.set(0, 0.7, -0.2);
    basket.castShadow = true;

    return { body, head, leftArm, rightArm, leftLeg, rightLeg, basket };
  }

  public update(deltaTime: number, keys: Record<string, boolean>, getHeightAt: (x: number, z: number) => number): void {
    this.animationTime += deltaTime;

    let dx = 0, dz = 0;
    if (keys['w'] || keys['W'] || keys['ArrowUp']) dz -= 1;
    if (keys['s'] || keys['S'] || keys['ArrowDown']) dz += 1;
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx -= 1;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;

    if (this.targetPosition && !this.state.isPicking) {
      const toTarget = new THREE.Vector3(
        this.targetPosition.x - this.mesh.position.x,
        0,
        this.targetPosition.z - this.mesh.position.z
      );
      
      if (toTarget.length() > 0.5) {
        toTarget.normalize();
        dx = toTarget.x;
        dz = toTarget.z;
      } else {
        this.targetPosition = null;
      }
    }

    const isMoving = dx !== 0 || dz !== 0;
    this.state.isWalking = isMoving && !this.state.isPicking;

    if (isMoving && !this.state.isPicking) {
      const moveVec = new THREE.Vector3(dx, 0, dz).normalize();
      this.mesh.position.x += moveVec.x * this.moveSpeed * deltaTime;
      this.mesh.position.z += moveVec.z * this.moveSpeed * deltaTime;

      this.state.rotation = Math.atan2(moveVec.x, moveVec.z);
      this.mesh.rotation.y = this.state.rotation;

      this.mesh.position.y = getHeightAt(this.mesh.position.x, this.mesh.position.z);
      this.state.position = {
        x: this.mesh.position.x,
        y: this.mesh.position.y,
        z: this.mesh.position.z
      };
    }

    this.updateAnimations(deltaTime);
  }

  private updateAnimations(deltaTime: number): void {
    if (this.state.isPicking) {
      const pickProgress = Math.sin(this.animationTime * 5);
      this.skeleton.body.position.y = 0.5 - Math.abs(pickProgress) * 0.15;
      this.skeleton.leftArm.rotation.x = -0.8 - pickProgress * 0.5;
      this.skeleton.rightArm.rotation.x = -0.8 - pickProgress * 0.5;
      this.skeleton.leftLeg.rotation.x = 0;
      this.skeleton.rightLeg.rotation.x = 0;
    } else if (this.state.isWalking) {
      const walkCycle = Math.sin(this.animationTime * 8);
      this.skeleton.leftLeg.rotation.x = walkCycle * 0.5;
      this.skeleton.rightLeg.rotation.x = -walkCycle * 0.5;
      this.skeleton.leftArm.rotation.x = -walkCycle * 0.4;
      this.skeleton.rightArm.rotation.x = walkCycle * 0.4;
      this.skeleton.body.position.y = 0.5 + Math.abs(walkCycle) * 0.02;
    } else {
      this.skeleton.leftLeg.rotation.x *= 0.9;
      this.skeleton.rightLeg.rotation.x *= 0.9;
      this.skeleton.leftArm.rotation.x *= 0.9;
      this.skeleton.rightArm.rotation.x *= 0.9;
      this.skeleton.body.position.y = 0.5;
    }

    this.skeleton.head.rotation.y = Math.sin(this.animationTime * 0.5) * 0.05;
    this.skeleton.basket.rotation.z = Math.sin(this.animationTime * 2) * 0.02;
  }

  public moveTo(position: THREE.Vector3): void {
    this.targetPosition = position.clone();
  }

  public startPicking(): void {
    this.state.isPicking = true;
    this.targetPosition = null;
  }

  public finishPicking(): void {
    this.state.isPicking = false;
    this.state.basketCount++;
  }

  public getBasketPosition(): THREE.Vector3 {
    const basketWorldPos = new THREE.Vector3();
    this.skeleton.basket.getWorldPosition(basketWorldPos);
    return basketWorldPos;
  }

  public getPosition(): THREE.Vector3 {
    return this.mesh.position.clone();
  }

  public getMesh(): THREE.Group {
    return this.mesh;
  }

  public getState(): PlayerState {
    return { ...this.state };
  }

  public setPosition(position: THREE.Vector3): void {
    this.mesh.position.copy(position);
    this.state.position = { x: position.x, y: position.y, z: position.z };
  }

  public resetBasketCount(): void {
    this.state.basketCount = 0;
  }
}
