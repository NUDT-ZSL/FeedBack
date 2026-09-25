import * as THREE from 'three';

export class Player {
  private mesh: THREE.Group;
  private position: THREE.Vector3;
  private velocity: THREE.Vector3;

  private isJumping: boolean = false;
  private jumpProgress: number = 0;
  private jumpDuration: number = 0.4;
  private jumpHeight: number = 1.2;
  private jumpStartY: number = 0;

  private dodgeDirection: 'left' | 'right' | null = null;
  private dodgeProgress: number = 0;
  private dodgeDuration: number = 0.2;
  private dodgeDistance: number = 1.0;
  private baseX: number = 0;

  private health: number = 5;
  private maxHealth: number = 5;

  private isInvincible: boolean = false;
  private invincibleTimer: number = 0;
  private invincibleDuration: number = 1.0;

  private runSpeed: number = 8;

  private bodyMesh: THREE.Mesh | null = null;
  private headMesh: THREE.Mesh | null = null;

  private baseScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);

  constructor() {
    this.position = new THREE.Vector3(0, 0.9, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.baseX = 0;

    this.mesh = new THREE.Group();
    this.createModel();
    this.mesh.position.copy(this.position);
  }

  private createModel(): void {
    const bodyGeo = new THREE.BoxGeometry(0.6, 1.2, 0.4);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x004444,
      metalness: 0.5,
      roughness: 0.3
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0;
    this.mesh.add(this.bodyMesh);

    const headGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      emissive: 0x440044,
      metalness: 0.5,
      roughness: 0.3
    });
    this.headMesh = new THREE.Mesh(headGeo, headMat);
    this.headMesh.position.y = 0.8;
    this.mesh.add(this.headMesh);

    const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.08, 0.85, 0.2);
    this.mesh.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.08, 0.85, 0.2);
    this.mesh.add(rightEye);

    const legGeo = new THREE.BoxGeometry(0.15, 0.5, 0.15);
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x0088aa,
      emissive: 0x002233,
      metalness: 0.6,
      roughness: 0.4
    });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.15, -0.85, 0);
    leftLeg.name = 'leftLeg';
    this.mesh.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.15, -0.85, 0);
    rightLeg.name = 'rightLeg';
    this.mesh.add(rightLeg);

    const armGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x0088aa,
      emissive: 0x002233,
      metalness: 0.6,
      roughness: 0.4
    });
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.4, 0.2, 0);
    leftArm.name = 'leftArm';
    this.mesh.add(leftArm);
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.4, 0.2, 0);
    rightArm.name = 'rightArm';
    this.mesh.add(rightArm);
  }

  update(deltaTime: number): void {
    if (this.isJumping) {
      this.jumpProgress += deltaTime / this.jumpDuration;
      if (this.jumpProgress >= 1) {
        this.jumpProgress = 1;
        this.isJumping = false;
        this.position.y = this.jumpStartY;
      } else {
        const jumpPhase = Math.sin(this.jumpProgress * Math.PI);
        this.position.y = this.jumpStartY + jumpPhase * this.jumpHeight;
      }
      this.updateJumpSquash();
    }

    if (this.dodgeDirection) {
      this.dodgeProgress += deltaTime / this.dodgeDuration;
      if (this.dodgeProgress >= 1) {
        this.dodgeProgress = 1;
        const targetX = this.dodgeDirection === 'left'
          ? this.baseX - this.dodgeDistance
          : this.baseX + this.dodgeDistance;
        this.baseX = targetX;
        this.position.x = targetX;
        this.dodgeDirection = null;
        this.dodgeProgress = 0;
        this.mesh.rotation.z = 0;
      } else {
        const easeProgress = this.dodgeProgress;
        const dir = this.dodgeDirection === 'left' ? -1 : 1;
        const offset = dir * this.dodgeDistance * easeProgress;
        this.position.x = this.baseX + offset;
        this.mesh.rotation.z = dir * 0.3 * Math.sin(easeProgress * Math.PI);
      }
    }

    if (this.isInvincible) {
      this.invincibleTimer -= deltaTime;
      if (this.invincibleTimer <= 0) {
        this.isInvincible = false;
        this.mesh.visible = true;
      } else {
        this.mesh.visible = Math.floor(this.invincibleTimer * 10) % 2 === 0;
      }
    }

    this.position.z -= this.runSpeed * deltaTime;

    this.mesh.position.copy(this.position);

    this.updateRunAnimation(deltaTime);
  }

  private updateJumpSquash(): void {
    if (!this.bodyMesh) return;
    const progress = this.jumpProgress;
    const squashPhase = Math.sin(progress * Math.PI);
    const scaleY = 1 + 0.3 * squashPhase;
    const scaleXZ = 1 - 0.15 * squashPhase;
    this.bodyMesh.scale.set(scaleXZ, scaleY, scaleXZ);
  }

  private updateRunAnimation(deltaTime: number): void {
    if (this.isJumping) return;

    const runCycle = (performance.now() / 1000 * 12) % (Math.PI * 2);
    const legSwing = Math.sin(runCycle) * 0.5;
    const armSwing = Math.sin(runCycle + Math.PI) * 0.6;

    const leftLeg = this.mesh.getObjectByName('leftLeg');
    const rightLeg = this.mesh.getObjectByName('rightLeg');
    const leftArm = this.mesh.getObjectByName('leftArm');
    const rightArm = this.mesh.getObjectByName('rightArm');

    if (leftLeg) leftLeg.rotation.x = legSwing;
    if (rightLeg) rightLeg.rotation.x = -legSwing;
    if (leftArm) leftArm.rotation.x = armSwing;
    if (rightArm) rightArm.rotation.x = -armSwing;
  }

  jump(): boolean {
    if (this.isJumping || this.dodgeDirection) return false;
    this.isJumping = true;
    this.jumpProgress = 0;
    this.jumpStartY = this.position.y;
    return true;
  }

  dodgeLeft(): boolean {
    if (this.isJumping || this.dodgeDirection) return false;
    if (this.baseX <= -1.5) return false;
    this.dodgeDirection = 'left';
    this.dodgeProgress = 0;
    return true;
  }

  dodgeRight(): boolean {
    if (this.isJumping || this.dodgeDirection) return false;
    if (this.baseX >= 1.5) return false;
    this.dodgeDirection = 'right';
    this.dodgeProgress = 0;
    return true;
  }

  takeDamage(): boolean {
    if (this.isInvincible) return false;
    this.health--;
    this.isInvincible = true;
    this.invincibleTimer = this.invincibleDuration;
    return this.health <= 0;
  }

  getBoundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    const size = new THREE.Vector3(0.5, 1.5, 0.4);
    box.min.copy(this.position).sub(size.clone().multiplyScalar(0.5));
    box.max.copy(this.position).add(size.clone().multiplyScalar(0.5));
    box.min.y = this.position.y - 0.75;
    box.max.y = this.position.y + 0.75;
    return box;
  }

  getMesh(): THREE.Group {
    return this.mesh;
  }

  getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  getHealth(): number {
    return this.health;
  }

  getMaxHealth(): number {
    return this.maxHealth;
  }

  getIsJumping(): boolean {
    return this.isJumping;
  }

  getDodgeDirection(): 'left' | 'right' | null {
    return this.dodgeDirection;
  }

  getIsInvincible(): boolean {
    return this.isInvincible;
  }

  getRunSpeed(): number {
    return this.runSpeed;
  }

  reset(): void {
    this.position.set(0, 0.9, 0);
    this.velocity.set(0, 0, 0);
    this.baseX = 0;
    this.isJumping = false;
    this.jumpProgress = 0;
    this.dodgeDirection = null;
    this.dodgeProgress = 0;
    this.health = this.maxHealth;
    this.isInvincible = false;
    this.invincibleTimer = 0;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.copy(this.position);
    if (this.bodyMesh) {
      this.bodyMesh.scale.set(1, 1, 1);
    }
  }

  setRunSpeed(speed: number): void {
    this.runSpeed = speed;
  }
}
