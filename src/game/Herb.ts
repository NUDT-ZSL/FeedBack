import * as THREE from 'three';
import { HerbData, ElementType, HERB_TYPES } from '../types';

export class Herb {
  private mesh: THREE.Group;
  private data: HerbData;
  private particles: THREE.Points;
  private glowMesh: THREE.Mesh;
  private animationTime: number = 0;

  constructor(position: THREE.Vector3) {
    const herbType = HERB_TYPES[Math.floor(Math.random() * HERB_TYPES.length)];
    
    this.data = {
      id: `herb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: herbType.name,
      element: herbType.element,
      color: herbType.color,
      potency: 0.5 + Math.random() * 0.5,
      position: { x: position.x, y: position.y, z: position.z }
    };

    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);

    this.createHerbModel();
    this.createGlowEffect();
    this.createParticles();
  }

  private createHerbModel(): void {
    const stemGeometry = new THREE.CylinderGeometry(0.02, 0.03, 0.3, 6);
    const stemMaterial = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = 0.15;
    this.mesh.add(stem);

    const leafGeometry = new THREE.SphereGeometry(0.08, 8, 6);
    const leafMaterial = new THREE.MeshLambertMaterial({ color: this.data.color });
    
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
      const angle = (i / 3) * Math.PI * 2;
      leaf.position.set(
        Math.cos(angle) * 0.08,
        0.3 + Math.sin(i * 0.5) * 0.05,
        Math.sin(angle) * 0.08
      );
      leaf.scale.set(1, 0.5, 1);
      this.mesh.add(leaf);
    }

    const flowerGeometry = new THREE.SphereGeometry(0.06, 8, 8);
    const flowerMaterial = new THREE.MeshLambertMaterial({ 
      color: this.data.color,
      emissive: this.data.color,
      emissiveIntensity: 0.3
    });
    const flower = new THREE.Mesh(flowerGeometry, flowerMaterial);
    flower.position.y = 0.35;
    this.mesh.add(flower);
  }

  private createGlowEffect(): void {
    const glowGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.data.color,
      transparent: true,
      opacity: 0.2
    });
    this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    this.glowMesh.position.y = 0.3;
    this.mesh.add(this.glowMesh);
  }

  private createParticles(): void {
    const particleCount = 15;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    const color = new THREE.Color(this.data.color);
    
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const radius = 0.15 + Math.random() * 0.1;
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = 0.3 + radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.03,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    this.particles = new THREE.Points(geometry, material);
    this.mesh.add(this.particles);
  }

  public update(deltaTime: number): void {
    this.animationTime += deltaTime;
    
    const pulseIntensity = 0.2 + Math.sin(this.animationTime * 2) * 0.1;
    (this.glowMesh.material as THREE.MeshBasicMaterial).opacity = pulseIntensity;
    
    const positions = this.particles.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] += Math.sin(this.animationTime * 2 + i) * 0.001;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  public collectAnimation(targetPos: THREE.Vector3, onComplete: () => void): void {
    const startPos = this.mesh.position.clone();
    const duration = 1000;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      this.mesh.position.lerpVectors(startPos, targetPos, easeProgress);
      this.mesh.scale.setScalar(1 - easeProgress * 0.8);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        onComplete();
      }
    };
    animate();
  }

  public getMesh(): THREE.Group {
    return this.mesh;
  }

  public getData(): HerbData {
    return { ...this.data };
  }

  public getElement(): ElementType {
    return this.data.element;
  }

  public getPosition(): THREE.Vector3 {
    return this.mesh.position.clone();
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
