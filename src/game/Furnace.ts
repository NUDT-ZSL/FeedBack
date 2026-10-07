import * as THREE from 'three';
import { FurnaceSlot, ELEMENT_COLORS, ELEMENT_NAMES, HerbData, PillData } from '../types';
import { FurnaceCore } from '../core/furnace';
import { systemRandom } from '../core/random';
import type { RandomSource } from '../core/random';

export class Furnace {
  private mesh: THREE.Group;
  private furnaceBody: THREE.Mesh;
  private furnaceGlow: THREE.Mesh;
  private particles: THREE.Points | null = null;
  private baguaPattern: THREE.Mesh;
  private animationTime: number = 0;
  private random: RandomSource;
  /** 全部投料/炼制/成丹判定状态，与离线验证共用的同一实现。 */
  public readonly core: FurnaceCore;

  constructor(random: RandomSource = systemRandom) {
    this.random = random;
    this.core = new FurnaceCore();
    this.mesh = new THREE.Group();

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
    
    this.core.getSlots().forEach((slot, index) => {
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
    const result = this.core.placeHerb(herbData, slotIndex);
    if (!result.accepted) return false;

    this.updateFurnaceColor();
    this.updateSlotVisual(slotIndex, result.isCorrect);

    return result.isCorrect;
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
            color: this.core.getSlots()[slotIndex].herb!.color,
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
    const color = this.core.getCurrentColor();
    (this.furnaceBody.material as THREE.MeshStandardMaterial).color.setHex(color);
    (this.furnaceGlow.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  public startRefining(): void {
    if (!this.core.startRefining()) return;
    this.createRefiningParticles();
  }

  private createRefiningParticles(): void {
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const theta = this.random() * Math.PI * 2;
      const radius = this.random() * 2;
      
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = this.random() * 3;
      positions[i * 3 + 2] = Math.sin(theta) * radius;

      const color = new THREE.Color(ELEMENT_COLORS[ELEMENT_NAMES[i % 5]]);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      velocities[i * 3] = (this.random() - 0.5) * 2;
      velocities[i * 3 + 1] = this.random() * 3 + 1;
      velocities[i * 3 + 2] = (this.random() - 0.5) * 2;
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

    const wasRefining = this.core.isCurrentlyRefining();
    if (wasRefining) {
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
            velocities[i + 1] = this.random() * 2 + 1;
            const theta = this.random() * Math.PI * 2;
            const radius = this.random() * 1.5;
            positions[i] = Math.cos(theta) * radius;
            positions[i + 2] = Math.sin(theta) * radius;
          }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
      }

      const pulseIntensity = 0.3 + Math.sin(this.core.getRefiningElapsedSeconds() * 10) * 0.2;
      (this.furnaceGlow.material as THREE.MeshBasicMaterial).opacity = pulseIntensity;

    }

    if (this.core.update(deltaTime)) {
      if (this.particles) {
        this.mesh.remove(this.particles);
        this.particles.geometry.dispose();
        this.particles.material.dispose();
        this.particles = null;
      }
      return true;
    }
    return false;
  }

  public isAllSlotsFilled(): boolean {
    return this.core.isAllSlotsFilled();
  }

  public calculateMatchScore(): number {
    return this.core.calculateMatchScore();
  }

  public generatePill(): PillData {
    return this.core.generatePill();
  }

  public getSlots(): FurnaceSlot[] {
    return this.core.getSlots();
  }

  public getCurrentColor(): number {
    return this.core.getCurrentColor();
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
    this.core.reset();
    (this.furnaceBody.material as THREE.MeshStandardMaterial).color.setHex(0x333333);
    (this.furnaceGlow.material as THREE.MeshBasicMaterial).opacity = 0.2;

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
    return this.core.getRefiningProgress();
  }

  public isCurrentlyRefining(): boolean {
    return this.core.isCurrentlyRefining();
  }
}
