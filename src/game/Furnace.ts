import * as THREE from 'three';
import { FurnaceSlot, ElementType, ELEMENT_COLORS, ELEMENT_NAMES, HerbData, PillData, PillQuality } from '../types';

export class Furnace {
  private mesh: THREE.Group;
  private slots: FurnaceSlot[];
  private furnaceBody: THREE.Mesh;
  private furnaceGlow: THREE.Mesh;
  private currentColor: number;
  private particles: THREE.Points | null = null;
  private baguaPattern: THREE.Mesh;
  private animationTime: number = 0;
  private isRefining: boolean = false;
  private refiningProgress: number = 0;

  constructor() {
    this.mesh = new THREE.Group();
    this.currentColor = 0x333333;
    
    this.slots = ELEMENT_NAMES.map(element => ({
      element,
      herb: null,
      isCorrect: false
    }));

    this.furnaceBody = this.createFurnaceBody();
    this.mesh.add(this.furnaceBody);

    this.furnaceGlow = this.createFurnaceGlow();
    this.mesh.add(this.furnaceGlow);

    this.baguaPattern = this.createBaguaPattern();
    this.mesh.add(this.baguaPattern);

    this.createElementSlots();
  }

  private createFurnaceBody(): THREE.Mesh {
    const bodyGeometry = new THREE.CylinderGeometry(1.2, 1.5, 2, 16);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.7,
      metalness: 0.5
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1;
    body.castShadow = true;
    return body;
  }

  private createFurnaceGlow(): THREE.Mesh {
    const glowGeometry = new THREE.CylinderGeometry(1.3, 1.6, 2.1, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.y = 1;
    return glow;
  }

  private createBaguaPattern(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 512, 512);

    const centerX = 256;
    const centerY = 256;
    const radius = 200;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 4;
    ctx.stroke();

    const trigrams = ['☰', '☳', '☵', '☶', '☷', '☴', '☲', '☱'];
    ctx.font = 'bold 48px serif';
    ctx.fillStyle = '#f5e6d0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * 150;
      const y = centerY + Math.sin(angle) * 150;
      ctx.fillText(trigrams[i], x, y);
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b';
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(6, 6);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    });

    const pattern = new THREE.Mesh(geometry, material);
    pattern.rotation.x = -Math.PI / 2;
    pattern.position.y = 0.01;
    return pattern;
  }

  private createElementSlots(): void {
    const slotRadius = 3;
    
    this.slots.forEach((slot, index) => {
      const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * slotRadius;
      const z = Math.sin(angle) * slotRadius;

      const slotGroup = new THREE.Group();
      slotGroup.position.set(x, 0.5, z);

      const baseGeometry = new THREE.CylinderGeometry(0.5, 0.6, 0.2, 8);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        roughness: 0.8,
        metalness: 0.3
      });
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      slotGroup.add(base);

      const haloGeometry = new THREE.RingGeometry(0.55, 0.65, 32);
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: ELEMENT_COLORS[slot.element],
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
      });
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.11;
      slotGroup.add(halo);

      const symbolGeometry = new THREE.PlaneGeometry(0.4, 0.4);
      const symbolCanvas = document.createElement('canvas');
      symbolCanvas.width = 128;
      symbolCanvas.height = 128;
      const symbolCtx = symbolCanvas.getContext('2d')!;
      symbolCtx.fillStyle = 'transparent';
      symbolCtx.fillRect(0, 0, 128, 128);
      symbolCtx.font = 'bold 80px "Ma Shan Zheng", serif';
      symbolCtx.fillStyle = `#${ELEMENT_COLORS[slot.element].toString(16).padStart(6, '0')}`;
      symbolCtx.textAlign = 'center';
      symbolCtx.textBaseline = 'middle';
      symbolCtx.fillText(slot.element, 64, 64);

      const symbolTexture = new THREE.CanvasTexture(symbolCanvas);
      const symbolMaterial = new THREE.MeshBasicMaterial({
        map: symbolTexture,
        transparent: true,
        side: THREE.DoubleSide
      });
      const symbol = new THREE.Mesh(symbolGeometry, symbolMaterial);
      symbol.rotation.x = -Math.PI / 2;
      symbol.position.y = 0.25;
      slotGroup.add(symbol);

      slotGroup.userData = { slotIndex: index, halo, base };
      this.mesh.add(slotGroup);
    });
  }

  public placeHerb(herbData: HerbData, slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    
    if (slot.herb) return false;

    const isCorrect = herbData.element === slot.element;
    slot.herb = herbData;
    slot.isCorrect = isCorrect;

    this.updateFurnaceColor();
    this.updateSlotVisual(slotIndex, isCorrect);

    return isCorrect;
  }

  private updateSlotVisual(slotIndex: number, isCorrect: boolean): void {
    const slotObject = this.mesh.children.find(
      child => child.userData.slotIndex === slotIndex
    );
    
    if (slotObject) {
      const halo = slotObject.userData.halo;
      const base = slotObject.userData.base;

      if (halo) {
        halo.material.opacity = isCorrect ? 0.8 : 0.3;
        
        if (isCorrect) {
          const glowGeometry = new THREE.SphereGeometry(0.3, 16, 16);
          const glowMaterial = new THREE.MeshBasicMaterial({
            color: this.slots[slotIndex].herb!.color,
            transparent: true,
            opacity: 0.6
          });
          const herbGlow = new THREE.Mesh(glowGeometry, glowMaterial);
          herbGlow.position.y = 0.5;
          slotObject.add(herbGlow);
        }
      }
    }
  }

  private updateFurnaceColor(): void {
    const filledSlots = this.slots.filter(s => s.herb && s.isCorrect);
    if (filledSlots.length === 0) {
      this.currentColor = 0x333333;
    } else {
      let r = 0, g = 0, b = 0;
      filledSlots.forEach(slot => {
        const color = new THREE.Color(ELEMENT_COLORS[slot.element]);
        r += color.r;
        g += color.g;
        b += color.b;
      });
      r /= filledSlots.length;
      g /= filledSlots.length;
      b /= filledSlots.length;
      this.currentColor = new THREE.Color().setRGB(r, g, b).getHex();
    }

    (this.furnaceBody.material as THREE.MeshStandardMaterial).color.setHex(this.currentColor);
    (this.furnaceGlow.material as THREE.MeshBasicMaterial).color.setHex(this.currentColor);
  }

  public startRefining(): void {
    this.isRefining = true;
    this.refiningProgress = 0;
    this.createRefiningParticles();
  }

  private createRefiningParticles(): void {
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2;
      
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.random() * 3;
      positions[i * 3 + 2] = Math.sin(theta) * radius;

      const slot = this.slots[i % 5];
      const color = new THREE.Color(ELEMENT_COLORS[slot.element]);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      velocities[i * 3] = (Math.random() - 0.5) * 2;
      velocities[i * 3 + 1] = Math.random() * 3 + 1;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    this.particles = new THREE.Points(geometry, material);
    this.mesh.add(this.particles);
  }

  public update(deltaTime: number): boolean {
    this.animationTime += deltaTime;

    this.baguaPattern.rotation.z += deltaTime * (Math.PI * 2 / 15);

    if (this.isRefining) {
      this.refiningProgress += deltaTime;

      if (this.particles) {
        const positions = this.particles.geometry.attributes.position.array as Float32Array;
        const velocities = this.particles.geometry.attributes.velocity.array as Float32Array;

        for (let i = 0; i < positions.length; i += 3) {
          positions[i] += velocities[i] * deltaTime;
          positions[i + 1] += velocities[i + 1] * deltaTime;
          positions[i + 2] += velocities[i + 2] * deltaTime;

          positions[i + 1] -= 5 * deltaTime;

          if (positions[i + 1] < 0) {
            positions[i + 1] = 0;
            velocities[i + 1] = Math.random() * 2 + 1;
            const theta = Math.random() * Math.PI * 2;
            const radius = Math.random() * 1.5;
            positions[i] = Math.cos(theta) * radius;
            positions[i + 2] = Math.sin(theta) * radius;
          }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
      }

      const pulseIntensity = 0.3 + Math.sin(this.refiningProgress * 10) * 0.2;
      (this.furnaceGlow.material as THREE.MeshBasicMaterial).opacity = pulseIntensity;

      if (this.refiningProgress >= 2) {
        this.isRefining = false;
        if (this.particles) {
          this.mesh.remove(this.particles);
          this.particles.geometry.dispose();
          this.particles.material.dispose();
          this.particles = null;
        }
        return true;
      }
    }

    return false;
  }

  public isAllSlotsFilled(): boolean {
    return this.slots.every(slot => slot.herb !== null);
  }

  public calculateMatchScore(): number {
    const correctCount = this.slots.filter(s => s.isCorrect).length;
    return correctCount / 5;
  }

  public generatePill(): PillData {
    const matchScore = this.calculateMatchScore();
    let quality: PillQuality;
    let effects: string[];
    let color: number;

    if (matchScore >= 0.9) {
      quality = '仙品';
      color = 0xffd700;
      effects = [
        '起死回生，肉白骨',
        '飞升成仙，长生不老',
        '灵力充沛，修为大增'
      ];
    } else if (matchScore >= 0.6) {
      quality = '灵品';
      color = 0x9966ff;
      effects = [
        '修为大增五十年',
        '百病不侵，益寿延年',
        '灵力精纯，修炼加速'
      ];
    } else {
      quality = '凡品';
      color = 0x888888;
      effects = [
        '强身健体，气力倍增',
        '治愈外伤，恢复元气',
        '小补气血，精神焕发'
      ];
    }

    const herbNames = this.slots
      .filter(s => s.herb)
      .map(s => s.herb!.name)
      .join('、');

    return {
      id: `pill_${Date.now()}`,
      name: `${quality}${this.getPillName()}`,
      quality,
      effects,
      matchScore,
      color
    };
  }

  private getPillName(): string {
    const names = ['九转还魂丹', '混元益气丹', '太清辟谷丹', '凝神聚气丹', '太素丹'];
    return names[Math.floor(Math.random() * names.length)];
  }

  public getSlots(): FurnaceSlot[] {
    return this.slots.map(s => ({ ...s, herb: s.herb ? { ...s.herb } : null }));
  }

  public getCurrentColor(): number {
    return this.currentColor;
  }

  public getMesh(): THREE.Group {
    return this.mesh;
  }

  public getSlotWorldPosition(slotIndex: number): THREE.Vector3 {
    const slotObject = this.mesh.children.find(
      child => child.userData.slotIndex === slotIndex
    );
    const worldPos = new THREE.Vector3();
    slotObject!.getWorldPosition(worldPos);
    return worldPos;
  }

  public reset(): void {
    this.slots.forEach(slot => {
      slot.herb = null;
      slot.isCorrect = false;
    });
    this.currentColor = 0x333333;
    (this.furnaceBody.material as THREE.MeshStandardMaterial).color.setHex(0x333333);
    (this.furnaceGlow.material as THREE.MeshBasicMaterial).opacity = 0.2;
    this.isRefining = false;
    this.refiningProgress = 0;

    this.mesh.children.forEach(child => {
      if (child.userData.slotIndex !== undefined) {
        while (child.children.length > 3) {
          child.remove(child.children[3]);
        }
        child.userData.halo.material.opacity = 0.3;
      }
    });
  }

  public getRefiningProgress(): number {
    return this.isRefining ? this.refiningProgress / 2 : 0;
  }

  public isCurrentlyRefining(): boolean {
    return this.isRefining;
  }
}
