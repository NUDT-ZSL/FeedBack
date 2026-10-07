import * as THREE from 'three';
import { PillData } from '../types';

export class Pill {
  private mesh: THREE.Group;
  private data: PillData;
  private animationTime: number = 0;
  private glowMesh: THREE.Mesh;
  private inscriptionMesh: THREE.Mesh;

  constructor(data: PillData) {
    this.data = data;
    this.mesh = new THREE.Group();

    this.createPillBody();
    this.glowMesh = this.createGlow();
    this.inscriptionMesh = this.createInscription();
  }

  private createPillBody(): void {
    const geometry = new THREE.SphereGeometry(0.5, 32, 32);
    
    const qualitySettings = {
      '仙品': { metalness: 0.9, roughness: 0.1, emissiveIntensity: 0.5 },
      '灵品': { metalness: 0.7, roughness: 0.2, emissiveIntensity: 0.3 },
      '凡品': { metalness: 0.5, roughness: 0.4, emissiveIntensity: 0.1 }
    };

    const settings = qualitySettings[this.data.quality];

    const material = new THREE.MeshStandardMaterial({
      color: this.data.color,
      metalness: settings.metalness,
      roughness: settings.roughness,
      emissive: this.data.color,
      emissiveIntensity: settings.emissiveIntensity
    });

    const body = new THREE.Mesh(geometry, material);
    body.castShadow = true;
    this.mesh.add(body);
  }

  private createGlow(): THREE.Mesh {
    const glowGeometry = new THREE.SphereGeometry(0.65, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.data.color,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.mesh.add(glow);
    return glow;
  }

  private createInscription(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, 256, 256);

    const inscriptions = ['乾', '坤', '震', '巽', '坎', '离', '艮', '兑'];
    const centerX = 128;
    const centerY = 128;
    const radius = 90;

    ctx.font = 'bold 32px "Ma Shan Zheng", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 30);
      gradient.addColorStop(0, `rgba(255, 215, 0, 0.8)`);
      gradient.addColorStop(1, `rgba(255, 215, 0, 0)`);
      
      ctx.fillStyle = gradient;
      ctx.fillText(inscriptions[i], x, y);
    }

    ctx.font = 'bold 48px "Ma Shan Zheng", serif';
    const qualityText = this.data.quality;
    const qualityGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 50);
    
    if (this.data.quality === '仙品') {
      qualityGradient.addColorStop(0, 'rgba(255, 215, 0, 1)');
      qualityGradient.addColorStop(1, 'rgba(255, 165, 0, 0.5)');
    } else if (this.data.quality === '灵品') {
      qualityGradient.addColorStop(0, 'rgba(153, 102, 255, 1)');
      qualityGradient.addColorStop(1, 'rgba(102, 51, 204, 0.5)');
    } else {
      qualityGradient.addColorStop(0, 'rgba(200, 200, 200, 1)');
      qualityGradient.addColorStop(1, 'rgba(150, 150, 150, 0.5)');
    }
    
    ctx.fillStyle = qualityGradient;
    ctx.fillText(qualityText, centerX, centerY);

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.SphereGeometry(0.52, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    const inscription = new THREE.Mesh(geometry, material);
    this.mesh.add(inscription);
    return inscription;
  }

  public update(deltaTime: number): void {
    this.animationTime += deltaTime;

    this.mesh.rotation.y += deltaTime * 0.5;
    this.inscriptionMesh.rotation.y -= deltaTime * 1.5;

    const pulseIntensity = 0.3 + Math.sin(this.animationTime * 3) * 0.1;
    this.glowMesh.material.opacity = pulseIntensity;

    const floatOffset = Math.sin(this.animationTime * 2) * 0.1;
    this.mesh.position.y = 1.5 + floatOffset;
  }

  public getMesh(): THREE.Group {
    return this.mesh;
  }

  public getData(): PillData {
    return { ...this.data };
  }

  public setPosition(position: THREE.Vector3): void {
    this.mesh.position.copy(position);
  }

  public dispose(): void {
    this.mesh.traverse((child) => {
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
}
