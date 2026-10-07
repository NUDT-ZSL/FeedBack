import * as THREE from 'three';
import { EffectManager } from './EffectManager';

export type DamageType = 'worm' | 'mold' | 'tear';

export interface Damage {
  id: string;
  type: DamageType;
  position: { x: number; y: number };
  radius: number;
  repaired: boolean;
  repairMaterial?: string;
  repairProgress: number;
  mesh?: THREE.Mesh;
}

export interface RepairRecord {
  beforeImage: string;
  afterImage: string;
  materials: { name: string; count: number }[];
  restorerSignature: string;
  timestamp: number;
}

export class BookManager {
  private scene: THREE.Scene;
  private effectManager: EffectManager;
  private bookGroup: THREE.Group = new THREE.Group();
  private pageMesh: THREE.Mesh | null = null;
  private pageMaterial: THREE.MeshStandardMaterial | null = null;
  private damageMeshes: THREE.Group = new THREE.Group();
  private damages: Damage[] = [];
  private usedMaterials: { name: string; count: number }[] = [];
  private repairAnimations: { damage: Damage; startTime: number; duration: number }[] = [];
  private scrollAnimation: { active: boolean; startTime: number; duration: number; direction: 'roll' | 'unroll' } | null = null;
  private repairRecord: RepairRecord | null = null;
  private scrollMesh: THREE.Group | null = null;
  private sealMesh: THREE.Mesh | null = null;
  private pageCanvas: HTMLCanvasElement | null = null;
  private pageTexture: THREE.CanvasTexture | null = null;
  private originalPageImageData: ImageData | null = null;

  private readonly PAGE_WIDTH = 2.5;
  private readonly PAGE_HEIGHT = 1.8;
  private readonly REPAIR_DURATION = 1.5;
  private readonly SCROLL_DURATION = 2.0;

  constructor(scene: THREE.Scene, effectManager: EffectManager) {
    this.scene = scene;
    this.effectManager = effectManager;
    this.scene.add(this.bookGroup);
    this.scene.add(this.damageMeshes);
  }

  public createBook(position: THREE.Vector3): void {
    this.bookGroup.position.copy(position);
    this.pageCanvas = document.createElement('canvas');
    this.pageCanvas.width = 1024;
    this.pageCanvas.height = 768;
    const ctx = this.pageCanvas.getContext('2d')!;
    ctx.fillStyle = '#f5f0e6';
    ctx.fillRect(0, 0, 1024, 768);
    this.drawPaperTexture(ctx);
    this.drawAncientText(ctx);
    this.originalPageImageData = ctx.getImageData(0, 0, 1024, 768);
    this.pageTexture = new THREE.CanvasTexture(this.pageCanvas);
    this.pageTexture.colorSpace = THREE.SRGBColorSpace;
    this.pageMaterial = new THREE.MeshStandardMaterial({
      map: this.pageTexture,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1
    });
    const pageGeometry = new THREE.PlaneGeometry(this.PAGE_WIDTH, this.PAGE_HEIGHT, 32, 32);
    this.pageMesh = new THREE.Mesh(pageGeometry, this.pageMaterial);
    this.pageMesh.rotation.x = -Math.PI / 2;
    this.pageMesh.position.y = 0.01;
    this.bookGroup.add(this.pageMesh);
    this.createDamages();
    this.updatePageTexture();
  }

  private drawPaperTexture(ctx: CanvasRenderingContext2D): void {
    const imageData = ctx.getImageData(0, 0, 1024, 768);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 15;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * 0.9));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 0.8));
    }
    ctx.putImageData(imageData, 0, 0);
    ctx.strokeStyle = 'rgba(92, 58, 33, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 50; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 1024, Math.random() * 768);
      ctx.lineTo(Math.random() * 1024, Math.random() * 768);
      ctx.stroke();
    }
  }

  private drawAncientText(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(40, 30, 20, 0.7)';
    ctx.font = '32px "Ma Shan Zheng", serif';
    const ancientPoems = [
      '关关雎鸠，在河之洲。',
      '窈窕淑女，君子好逑。',
      '参差荇菜，左右流之。',
      '窈窕淑女，寤寐求之。',
      '求之不得，寤寐思服。',
      '悠哉悠哉，辗转反侧。',
      '参差荇菜，左右采之。',
      '窈窕淑女，琴瑟友之。'
    ];
    for (let i = 0; i < ancientPoems.length; i++) {
      for (let j = 0; j < ancientPoems[i].length; j++) {
        ctx.fillText(ancientPoems[i][j], 120 + i * 100, 120 + j * 60);
      }
    }
  }

  private createDamages(): void {
    this.damages = [
      { id: 'd1', type: 'worm', position: { x: -0.6, y: 0.2 }, radius: 0.12, repaired: false, repairProgress: 0 },
      { id: 'd2', type: 'worm', position: { x: 0.3, y: -0.4 }, radius: 0.08, repaired: false, repairProgress: 0 },
      { id: 'd3', type: 'mold', position: { x: 0.7, y: 0.3 }, radius: 0.18, repaired: false, repairProgress: 0 },
      { id: 'd4', type: 'mold', position: { x: -0.2, y: -0.5 }, radius: 0.14, repaired: false, repairProgress: 0 },
      { id: 'd5', type: 'tear', position: { x: 0.1, y: 0.5 }, radius: 0.2, repaired: false, repairProgress: 0 },
      { id: 'd6', type: 'worm', position: { x: -0.8, y: -0.2 }, radius: 0.1, repaired: false, repairProgress: 0 }
    ];
    for (const damage of this.damages) {
      this.createDamageMesh(damage);
    }
  }

  private createDamageMesh(damage: Damage): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    switch (damage.type) {
      case 'worm':
        this.drawWormHole(ctx, damage.radius);
        break;
      case 'mold':
        this.drawMold(ctx, damage.radius);
        break;
      case 'tear':
        this.drawTear(ctx, damage.radius);
        break;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const size = damage.radius * 2.5;
    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(damage.position.x, 0.015, damage.position.y);
    damage.mesh = mesh;
    this.damageMeshes.add(mesh);
  }

  private drawWormHole(ctx: CanvasRenderingContext2D, _radius: number): void {
    ctx.clearRect(0, 0, 256, 256);
    const centerX = 128;
    const centerY = 128;
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 120);
    gradient.addColorStop(0, 'rgba(20, 10, 5, 0.9)');
    gradient.addColorStop(0.4, 'rgba(40, 25, 15, 0.7)');
    gradient.addColorStop(0.7, 'rgba(60, 40, 25, 0.3)');
    gradient.addColorStop(1, 'rgba(80, 55, 35, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const r = 80 + Math.sin(i * 2.5) * 25;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(10, 5, 0, 0.95)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMold(ctx: CanvasRenderingContext2D, _radius: number): void {
    ctx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      const centerX = 100 + Math.random() * 56;
      const centerY = 100 + Math.random() * 56;
      const r = 30 + Math.random() * 50;
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, r);
      const green = 40 + Math.random() * 30;
      gradient.addColorStop(0, `rgba(${60 + Math.random() * 20}, ${green}, ${20 + Math.random() * 20}, 0.6)`);
      gradient.addColorStop(0.5, `rgba(${70 + Math.random() * 20}, ${green + 10}, ${30 + Math.random() * 20}, 0.3)`);
      gradient.addColorStop(1, `rgba(${80 + Math.random() * 20}, ${green + 20}, ${40 + Math.random() * 20}, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTear(ctx: CanvasRenderingContext2D, _radius: number): void {
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(92, 58, 33, 0.8)';
    ctx.beginPath();
    ctx.moveTo(20, 128);
    let x = 20;
    let y = 128;
    for (let i = 0; i < 20; i++) {
      x += 11;
      y += (Math.random() - 0.5) * 40;
      y = Math.max(30, Math.min(226, y));
      ctx.lineTo(x, y);
    }
    for (let i = 0; i < 20; i++) {
      x -= 11;
      y += (Math.random() - 0.5) * 40 + 20;
      y = Math.max(30, Math.min(226, y));
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 40, 25, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  public getDamages(): Damage[] {
    return this.damages;
  }

  public findNearestDamage(worldPos: THREE.Vector3, maxDistance: number = 0.3): Damage | null {
    const localPos = this.bookGroup.worldToLocal(worldPos.clone());
    let nearest: Damage | null = null;
    let minDist = Infinity;
    for (const damage of this.damages) {
      if (damage.repaired) continue;
      const dx = localPos.x - damage.position.x;
      const dz = localPos.z - damage.position.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < maxDistance && dist < minDist) {
        minDist = dist;
        nearest = damage;
      }
    }
    return nearest;
  }

  public applyRepair(damage: Damage, materialName: string): boolean {
    if (damage.repaired || damage.repairProgress > 0) return false;
    damage.repairMaterial = materialName;
    this.repairAnimations.push({
      damage,
      startTime: performance.now(),
      duration: this.REPAIR_DURATION * 1000
    });
    const worldPos = this.bookGroup.localToWorld(new THREE.Vector3(damage.position.x, 0.02, damage.position.y));
    this.effectManager.emitRipple(worldPos, damage.radius);
    const existing = this.usedMaterials.find(m => m.name === materialName);
    if (existing) {
      existing.count++;
    } else {
      this.usedMaterials.push({ name: materialName, count: 1 });
    }
    return true;
  }

  private updateRepairAnimations(): void {
    const now = performance.now();
    for (let i = this.repairAnimations.length - 1; i >= 0; i--) {
      const anim = this.repairAnimations[i];
      const elapsed = now - anim.startTime;
      const progress = Math.min(1, elapsed / anim.duration);
      anim.damage.repairProgress = progress;
      const easedProgress = this.effectManager.easeInOutCustom(progress);
      if (anim.damage.mesh) {
        const material = anim.damage.mesh.material as THREE.MeshStandardMaterial;
        material.opacity = 1 - easedProgress;
        anim.damage.mesh.scale.setScalar(1 + easedProgress * 0.3);
      }
      this.updatePageTexture();
      if (progress >= 1) {
        anim.damage.repaired = true;
        if (anim.damage.mesh) {
          anim.damage.mesh.visible = false;
        }
        this.repairAnimations.splice(i, 1);
      }
    }
  }

  private updatePageTexture(): void {
    if (!this.pageCanvas || !this.originalPageImageData) return;
    const ctx = this.pageCanvas.getContext('2d')!;
    ctx.putImageData(this.originalPageImageData, 0, 0);
    for (const damage of this.damages) {
      if (damage.repairProgress > 0 && !damage.repaired) {
        const x = (damage.position.x / this.PAGE_WIDTH + 0.5) * 1024;
        const y = (damage.position.y / this.PAGE_HEIGHT + 0.5) * 768;
        const radius = damage.radius * 300;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(245, 240, 230, 0)');
        gradient.addColorStop(0.6 * damage.repairProgress, 'rgba(245, 240, 230, 0.8)');
        gradient.addColorStop(damage.repairProgress, 'rgba(245, 240, 230, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.pageTexture) {
      this.pageTexture.needsUpdate = true;
    }
  }

  public isComplete(): boolean {
    return this.damages.every(d => d.repaired);
  }

  public startScrollAnimation(): void {
    if (!this.isComplete() || this.scrollAnimation) return;
    this.scrollAnimation = {
      active: true,
      startTime: performance.now(),
      duration: this.SCROLL_DURATION * 1000,
      direction: 'roll'
    };
    this.damageMeshes.visible = false;
    this.createScrollMesh();
  }

  private createScrollMesh(): void {
    if (this.scrollMesh) {
      this.scene.remove(this.scrollMesh);
    }
    this.scrollMesh = new THREE.Group();
    const scrollCanvas = document.createElement('canvas');
    scrollCanvas.width = 2048;
    scrollCanvas.height = 512;
    const ctx = scrollCanvas.getContext('2d')!;
    ctx.fillStyle = '#f5f0e6';
    ctx.fillRect(0, 0, 2048, 512);
    this.drawScrollContent(ctx);
    const scrollTexture = new THREE.CanvasTexture(scrollCanvas);
    scrollTexture.colorSpace = THREE.SRGBColorSpace;
    const scrollMaterial = new THREE.MeshStandardMaterial({
      map: scrollTexture,
      side: THREE.DoubleSide,
      roughness: 0.7
    });
    const scrollGeometry = new THREE.PlaneGeometry(3.5, 0.9, 64, 16);
    const scrollPage = new THREE.Mesh(scrollGeometry, scrollMaterial);
    scrollPage.rotation.x = -Math.PI / 2;
    scrollPage.position.y = 0.03;
    this.scrollMesh.add(scrollPage);
    const rollerGeometry = new THREE.CylinderGeometry(0.06, 0.06, 1, 16);
    const rollerMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.6 });
    const leftRoller = new THREE.Mesh(rollerGeometry, rollerMaterial);
    leftRoller.rotation.z = Math.PI / 2;
    leftRoller.position.set(-1.75, 0.06, 0);
    this.scrollMesh.add(leftRoller);
    const rightRoller = new THREE.Mesh(rollerGeometry, rollerMaterial);
    rightRoller.rotation.z = Math.PI / 2;
    rightRoller.position.set(1.75, 0.06, 0);
    this.scrollMesh.add(rightRoller);
    const sealCanvas = document.createElement('canvas');
    sealCanvas.width = 128;
    sealCanvas.height = 128;
    const sealCtx = sealCanvas.getContext('2d')!;
    sealCtx.fillStyle = '#8b0000';
    sealCtx.beginPath();
    sealCtx.arc(64, 64, 55, 0, Math.PI * 2);
    sealCtx.fill();
    sealCtx.fillStyle = '#f5f0e6';
    sealCtx.font = 'bold 28px "Ma Shan Zheng", serif';
    sealCtx.textAlign = 'center';
    sealCtx.fillText('修复', 64, 55);
    sealCtx.fillText('珍藏', 64, 90);
    const sealTexture = new THREE.CanvasTexture(sealCanvas);
    sealTexture.colorSpace = THREE.SRGBColorSpace;
    const sealMaterial = new THREE.MeshStandardMaterial({
      map: sealTexture,
      transparent: true,
      side: THREE.DoubleSide,
      emissive: 0x8b0000,
      emissiveIntensity: 0.3
    });
    const sealGeometry = new THREE.PlaneGeometry(0.25, 0.25);
    this.sealMesh = new THREE.Mesh(sealGeometry, sealMaterial);
    this.sealMesh.rotation.x = -Math.PI / 2;
    this.sealMesh.position.set(1.4, 0.035, 0.25);
    this.scrollMesh.add(this.sealMesh);
    this.scrollMesh.position.copy(this.bookGroup.position);
    this.scrollMesh.visible = false;
    this.scene.add(this.scrollMesh);
    this.repairRecord = {
      beforeImage: '',
      afterImage: '',
      materials: [...this.usedMaterials],
      restorerSignature: '古籍修复师',
      timestamp: Date.now()
    };
  }

  private drawScrollContent(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(92, 58, 33, 0.2)';
    ctx.fillRect(0, 0, 2048, 512);
    ctx.fillStyle = '#3d2817';
    ctx.font = 'bold 56px "Ma Shan Zheng", serif';
    ctx.textAlign = 'center';
    ctx.fillText('古籍修复记录', 1024, 80);
    ctx.font = '28px "ZCOOL XiaoWei", serif';
    ctx.fillText('—————— 修旧如旧 · 传古承今 ——————', 1024, 130);
    ctx.fillStyle = '#2a1a0f';
    ctx.font = '24px "ZCOOL XiaoWei", serif';
    ctx.textAlign = 'left';
    ctx.fillText('【修复前后对比】', 150, 200);
    ctx.fillStyle = '#3d2817';
    ctx.fillText('修复前：书页破损，虫蛀霉斑，亟待修复', 180, 240);
    ctx.fillText('修复后：破镜重圆，墨迹如新，重现芳华', 180, 280);
    ctx.fillStyle = '#2a1a0f';
    ctx.fillText('【用材清单】', 150, 330);
    ctx.fillStyle = '#3d2817';
    const materials = this.usedMaterials.length > 0 
      ? this.usedMaterials.map(m => `${m.name} ×${m.count}`).join('、')
      : '安徽宣纸、蚕丝线、小麦浆糊、松烟墨';
    this.wrapText(ctx, materials, 180, 370, 1700, 35);
    ctx.fillStyle = '#2a1a0f';
    ctx.textAlign = 'right';
    ctx.fillText('【修复师签名】', 1900, 430);
    ctx.fillStyle = '#8b0000';
    ctx.font = '40px "Ma Shan Zheng", serif';
    ctx.fillText('古籍修复师  谨志', 1900, 480);
    ctx.fillStyle = '#5c3a21';
    ctx.font = '20px "ZCOOL XiaoWei", serif';
    ctx.fillText(new Date().toLocaleDateString('zh-CN'), 1900, 500);
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const chars = text.split('');
    let line = '';
    let currentY = y;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = chars[i];
        currentY += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  private updateScrollAnimation(): void {
    if (!this.scrollAnimation || !this.scrollMesh) return;
    const now = performance.now();
    const elapsed = now - this.scrollAnimation.startTime;
    const progress = Math.min(1, elapsed / this.scrollAnimation.duration);
    const easedProgress = this.effectManager.easeInOutCustom(progress);
    const scrollPage = this.scrollMesh.children[0] as THREE.Mesh;
    const geometry = scrollPage.geometry as THREE.PlaneGeometry;
    const positions = geometry.attributes.position;
    const originalPositions = (geometry as any)._originalPositions;
    if (!originalPositions) {
      (geometry as any)._originalPositions = positions.array.slice();
      return;
    }
    const scrollDir = this.scrollAnimation.direction === 'roll' ? 1 : -1;
    const scrollProgress = this.scrollAnimation.direction === 'roll' ? easedProgress : 1 - easedProgress;
    const rightRoller = this.scrollMesh.children[2] as THREE.Mesh;
    rightRoller.position.x = 1.75 - scrollProgress * 3.5;
    rightRoller.rotation.y = scrollProgress * Math.PI * 4 * scrollDir;
    const leftRoller = this.scrollMesh.children[1] as THREE.Mesh;
    leftRoller.rotation.y = scrollProgress * Math.PI * 0.5 * scrollDir;
    for (let i = 0; i < positions.count; i++) {
      const x = originalPositions[i * 3];
      const y = originalPositions[i * 3 + 1];
      const z = originalPositions[i * 3 + 2];
      const rollStartX = 1.75 - scrollProgress * 3.5;
      if (x > rollStartX) {
        const rollAmount = (x - rollStartX) / (3.5 * Math.max(0.01, scrollProgress));
        const rollAngle = rollAmount * Math.PI * 2 * scrollProgress;
        const radius = 0.06;
        const newX = rollStartX + Math.sin(rollAngle) * radius;
        const newZ = z + (1 - Math.cos(rollAngle)) * radius;
        positions.setXYZ(i, newX, y, newZ);
      } else {
        positions.setXYZ(i, x, y, z);
      }
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    if (Math.random() < 0.3) {
      const particlePos = new THREE.Vector3(
        rightRoller.position.x,
        0.1,
        (Math.random() - 0.5) * 0.8
      );
      this.effectManager.emitScrollParticles(particlePos, new THREE.Vector3(-1, 0, 0));
    }
    if (progress >= 1) {
      if (this.scrollAnimation.direction === 'roll') {
        this.scrollAnimation.direction = 'unroll';
        this.scrollAnimation.startTime = performance.now();
        if (this.pageMesh) this.pageMesh.visible = false;
        this.scrollMesh.visible = true;
        if (this.sealMesh) {
          const sealPos = new THREE.Vector3();
          this.sealMesh.getWorldPosition(sealPos);
          this.effectManager.emitSealGlow(sealPos);
        }
      } else {
        this.scrollAnimation.active = false;
        this.scrollAnimation = null;
      }
    }
  }

  public getRepairRecord(): RepairRecord | null {
    return this.repairRecord;
  }

  public getScrollMesh(): THREE.Group | null {
    return this.scrollMesh;
  }

  public update(_deltaTime: number): void {
    this.updateRepairAnimations();
    this.updateScrollAnimation();
  }

  public dispose(): void {
    this.scene.remove(this.bookGroup);
    this.scene.remove(this.damageMeshes);
    if (this.scrollMesh) {
      this.scene.remove(this.scrollMesh);
    }
    if (this.pageMesh) {
      this.pageMesh.geometry.dispose();
      (this.pageMesh.material as THREE.Material).dispose();
    }
    if (this.pageTexture) {
      this.pageTexture.dispose();
    }
  }
}
