import * as THREE from 'three';

export interface PlantParams {
  light: number;
  water: number;
  temperature: number;
}

export type GrowthStage = 'seed' | 'sprout' | 'adult' | 'flowering';

interface LeafData {
  mesh: THREE.Mesh;
  baseRotation: number;
  heightPosition: number;
  side: number;
  windOffset: number;
  vibrating: boolean;
  vibrationStart: number;
}

interface FlowerData {
  group: THREE.Group;
  petals: THREE.Mesh[];
  basePosition: THREE.Vector3;
  scattered: boolean;
}

export class Plant {
  public group: THREE.Group;
  private params: PlantParams;
  private growthTime: number = 0;
  public currentStage: GrowthStage = 'seed';
  private stageTransitionStart: number = -1;
  private isWilting: boolean = false;
  private wiltProgress: number = 0;

  private stemSegments: THREE.Mesh[] = [];
  private leaves: LeafData[] = [];
  private flowers: FlowerData[] = [];
  private seedMesh!: THREE.Mesh;
  private stemGroup!: THREE.Group;
  private leavesGroup!: THREE.Group;
  private flowersGroup!: THREE.Group;

  private wiltParticles!: THREE.Points;
  private flowerParticles!: THREE.Points;
  private sparkleParticles!: THREE.Points;
  private sparkleActive: boolean = false;
  private sparkleTime: number = 0;

  private time: number = 0;
  public lightDirection: THREE.Vector3 = new THREE.Vector3(1, 1, 1).normalize();

  constructor(params: PlantParams) {
    this.params = { ...params };
    this.group = new THREE.Group();
    this.initPlant();
    this.initParticleSystems();
  }

  private initPlant() {
    this.stemGroup = new THREE.Group();
    this.leavesGroup = new THREE.Group();
    this.flowersGroup = new THREE.Group();

    this.group.add(this.stemGroup);
    this.group.add(this.leavesGroup);
    this.group.add(this.flowersGroup);

    this.createSeed();
    this.updateGrowth();
  }

  private createSeed() {
    const seedGeometry = new THREE.SphereGeometry(0.08, 16, 16);
    const seedMaterial = new THREE.MeshStandardMaterial({
      color: 0x8d6e63,
      roughness: 0.9,
      metalness: 0.1
    });
    this.seedMesh = new THREE.Mesh(seedGeometry, seedMaterial);
    this.seedMesh.position.y = 0.05;
    this.group.add(this.seedMesh);
  }

  private createStem(height: number, segments: number = 8) {
    this.clearStem();
    const segmentHeight = height / segments;

    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const radius = 0.03 * (1 - t * 0.5);
      const geometry = new THREE.CylinderGeometry(radius * 0.9, radius, segmentHeight, 8);
      const material = new THREE.MeshStandardMaterial({
        color: this.getStemColor(),
        roughness: 0.8,
        metalness: 0.1
      });
      const segment = new THREE.Mesh(geometry, material);
      segment.position.y = i * segmentHeight + segmentHeight / 2;
      segment.userData.segmentIndex = i;
      segment.userData.type = 'stem';
      this.stemSegments.push(segment);
      this.stemGroup.add(segment);
    }
  }

  private getStemColor(): THREE.Color {
    if (this.isWilting) {
      const t = this.wiltProgress;
      return new THREE.Color().lerpColors(
        new THREE.Color(0x2e7d32),
        new THREE.Color(0x795548),
        t
      );
    }
    return new THREE.Color(0x2e7d32);
  }

  private clearStem() {
    this.stemSegments.forEach(s => {
      this.stemGroup.remove(s);
      s.geometry.dispose();
      (s.material as THREE.Material).dispose();
    });
    this.stemSegments = [];
  }

  private createLeaf(height: number, side: number, size: number = 0.15): LeafData {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(size * 0.6, size * 0.3, size, 0);
    shape.quadraticCurveTo(size * 0.6, -size * 0.3, 0, 0);

    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshStandardMaterial({
      color: this.getLeafColor(),
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.05
    });

    const leaf = new THREE.Mesh(geometry, material);
    leaf.position.y = height;
    leaf.position.x = side * 0.02;
    leaf.rotation.z = side * (Math.PI / 3);
    leaf.rotation.y = side * (Math.PI / 6);
    leaf.userData.type = 'leaf';
    leaf.castShadow = true;

    this.leavesGroup.add(leaf);

    return {
      mesh: leaf,
      baseRotation: leaf.rotation.z,
      heightPosition: height,
      side: side,
      windOffset: Math.random() * Math.PI * 2,
      vibrating: false,
      vibrationStart: 0
    };
  }

  private getLeafColor(): THREE.Color {
    const { temperature } = this.params;
    let baseColor = new THREE.Color(0x66bb6a);

    if (temperature < 15) {
      const t = (15 - temperature) / 15;
      baseColor.lerp(new THREE.Color(0x7e57c2), Math.min(t, 0.6));
    } else if (temperature > 28) {
      const t = (temperature - 28) / 12;
      baseColor.lerp(new THREE.Color(0xffeb3b), Math.min(t, 0.5));
    }

    if (this.isWilting) {
      baseColor.lerp(new THREE.Color(0x8d6e63), this.wiltProgress * 0.8);
    }

    return baseColor;
  }

  private clearLeaves() {
    this.leaves.forEach(l => {
      this.leavesGroup.remove(l.mesh);
      l.mesh.geometry.dispose();
      (l.mesh.material as THREE.Material).dispose();
    });
    this.leaves = [];
  }

  private createFlower(position: THREE.Vector3): FlowerData {
    const flowerGroup = new THREE.Group();
    flowerGroup.position.copy(position);

    const petals: THREE.Mesh[] = [];
    const petalCount = 6;

    for (let i = 0; i < petalCount; i++) {
      const angle = (i / petalCount) * Math.PI * 2;
      const petalShape = new THREE.Shape();
      petalShape.moveTo(0, 0);
      petalShape.quadraticCurveTo(0.06, 0.08, 0, 0.16);
      petalShape.quadraticCurveTo(-0.06, 0.08, 0, 0);

      const petalGeometry = new THREE.ShapeGeometry(petalShape);

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 0, 128);
      gradient.addColorStop(0, '#f8bbd0');
      gradient.addColorStop(0.5, '#f48fb1');
      gradient.addColorStop(1, '#ec407a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 128);

      const texture = new THREE.CanvasTexture(canvas);
      const petalMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.6
      });

      const petal = new THREE.Mesh(petalGeometry, petalMaterial);
      petal.rotation.y = angle;
      petal.rotation.x = -Math.PI / 6;
      petal.userData.type = 'flower';
      petal.userData.petalIndex = i;
      petals.push(petal);
      flowerGroup.add(petal);
    }

    const centerGeometry = new THREE.SphereGeometry(0.03, 12, 12);
    const centerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd54f,
      roughness: 0.5,
      emissive: 0xffa000,
      emissiveIntensity: 0.3
    });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    center.position.y = 0.04;
    flowerGroup.add(center);

    this.flowersGroup.add(flowerGroup);

    return {
      group: flowerGroup,
      petals,
      basePosition: position.clone(),
      scattered: false
    };
  }

  private clearFlowers() {
    this.flowers.forEach(f => {
      this.flowersGroup.remove(f.group);
      f.petals.forEach(p => {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      });
    });
    this.flowers = [];
  }

  private initParticleSystems() {
    const wiltGeometry = new THREE.BufferGeometry();
    const wiltPositions = new Float32Array(2000 * 3);
    const wiltVelocities = new Float32Array(2000 * 3);
    const wiltSizes = new Float32Array(2000);

    for (let i = 0; i < 2000; i++) {
      wiltPositions[i * 3] = 0;
      wiltPositions[i * 3 + 1] = -100;
      wiltPositions[i * 3 + 2] = 0;
      wiltVelocities[i * 3] = 0;
      wiltVelocities[i * 3 + 1] = 0;
      wiltVelocities[i * 3 + 2] = 0;
      wiltSizes[i] = 0;
    }

    wiltGeometry.setAttribute('position', new THREE.BufferAttribute(wiltPositions, 3));
    wiltGeometry.setAttribute('size', new THREE.BufferAttribute(wiltSizes, 1));

    const wiltMaterial = new THREE.PointsMaterial({
      color: 0xa1887f,
      size: 0.02,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });

    this.wiltParticles = new THREE.Points(wiltGeometry, wiltMaterial);
    this.wiltParticles.visible = false;
    this.group.add(this.wiltParticles);

    const flowerGeometry = new THREE.BufferGeometry();
    const flowerPositions = new Float32Array(1000 * 3);
    const flowerSizes = new Float32Array(1000);

    for (let i = 0; i < 1000; i++) {
      flowerPositions[i * 3] = 0;
      flowerPositions[i * 3 + 1] = -100;
      flowerPositions[i * 3 + 2] = 0;
      flowerSizes[i] = 0;
    }

    flowerGeometry.setAttribute('position', new THREE.BufferAttribute(flowerPositions, 3));
    flowerGeometry.setAttribute('size', new THREE.BufferAttribute(flowerSizes, 1));

    const flowerMaterial = new THREE.PointsMaterial({
      color: 0xf48fb1,
      size: 0.03,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true
    });

    this.flowerParticles = new THREE.Points(flowerGeometry, flowerMaterial);
    this.flowerParticles.visible = false;
    this.group.add(this.flowerParticles);

    const sparkleGeometry = new THREE.BufferGeometry();
    const sparklePositions = new Float32Array(500 * 3);
    const sparkleSizes = new Float32Array(500);

    for (let i = 0; i < 500; i++) {
      sparklePositions[i * 3] = 0;
      sparklePositions[i * 3 + 1] = -100;
      sparklePositions[i * 3 + 2] = 0;
      sparkleSizes[i] = 0;
    }

    sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
    sparkleGeometry.setAttribute('size', new THREE.BufferAttribute(sparkleSizes, 1));

    const sparkleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.04,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true
    });

    this.sparkleParticles = new THREE.Points(sparkleGeometry, sparkleMaterial);
    this.sparkleParticles.visible = false;
    this.group.add(this.sparkleParticles);
  }

  public triggerSparkle() {
    this.sparkleActive = true;
    this.sparkleTime = 0;
    this.sparkleParticles.visible = true;

    const positions = this.sparkleParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizes = this.sparkleParticles.geometry.getAttribute('size') as THREE.BufferAttribute;

    for (let i = 0; i < 500; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.15;
      positions.setXYZ(
        i,
        Math.cos(angle) * radius,
        Math.random() * 0.3,
        Math.sin(angle) * radius
      );
      sizes.setX(i, 0.02 + Math.random() * 0.04);
    }

    positions.needsUpdate = true;
    sizes.needsUpdate = true;
  }

  public updateParams(params: PlantParams) {
    this.params = { ...params };
    this.checkWilting();
    this.updateMaterials();
  }

  private checkWilting() {
    const { light, water, temperature } = this.params;
    const badConditions =
      light < 15 || light > 90 ||
      water < 15 || water > 90 ||
      temperature < 5 || temperature > 35;

    if (badConditions && !this.isWilting) {
      this.isWilting = true;
      this.wiltParticles.visible = true;
    } else if (!badConditions && this.isWilting) {
      this.isWilting = false;
    }
  }

  private updateMaterials() {
    this.stemSegments.forEach(s => {
      (s.material as THREE.MeshStandardMaterial).color.copy(this.getStemColor());
    });

    this.leaves.forEach(l => {
      (l.mesh.material as THREE.MeshStandardMaterial).color.copy(this.getLeafColor());
    });
  }

  private getGrowthRate(): number {
    const { light, water } = this.params;
    const lightFactor = Math.sin((light / 100) * Math.PI);
    const waterFactor = Math.sin((water / 100) * Math.PI);
    const tempFactor = this.params.temperature >= 10 && this.params.temperature <= 32 ? 1 : 0.3;
    return 0.3 + 0.7 * lightFactor * waterFactor * tempFactor;
  }

  public getStage(): GrowthStage {
    if (this.growthTime < 5) return 'seed';
    if (this.growthTime < 15) return 'sprout';
    if (this.growthTime < 30) return 'adult';
    return 'flowering';
  }

  public getGrowthDays(): number {
    return Math.floor(this.growthTime * 1.5);
  }

  private updateGrowth() {
    const newStage = this.getStage();
    if (newStage !== this.currentStage) {
      this.currentStage = newStage;
      this.stageTransitionStart = this.time;
      this.rebuildPlant();
    }
  }

  private rebuildPlant() {
    this.clearLeaves();
    this.clearFlowers();
    this.clearStem();

    switch (this.currentStage) {
      case 'seed':
        this.seedMesh.visible = true;
        break;
      case 'sprout':
        this.seedMesh.visible = false;
        this.createStem(0.05, 3);
        for (let i = 0; i < 2; i++) {
          this.leaves.push(this.createLeaf(0.04, i === 0 ? -1 : 1, 0.08));
        }
        break;
      case 'adult':
        this.seedMesh.visible = false;
        this.createStem(0.2, 8);
        for (let i = 0; i < 8; i++) {
          const height = 0.04 + (i / 8) * 0.15;
          const side = i % 2 === 0 ? -1 : 1;
          this.leaves.push(this.createLeaf(height, side, 0.15));
        }
        break;
      case 'flowering':
        this.seedMesh.visible = false;
        this.createStem(0.22, 10);
        for (let i = 0; i < 8; i++) {
          const height = 0.04 + (i / 8) * 0.15;
          const side = i % 2 === 0 ? -1 : 1;
          this.leaves.push(this.createLeaf(height, side, 0.15));
        }
        this.flowers.push(this.createFlower(new THREE.Vector3(0, 0.24, 0)));
        this.flowers.push(this.createFlower(new THREE.Vector3(-0.08, 0.22, 0.04)));
        this.flowers.push(this.createFlower(new THREE.Vector3(0.08, 0.22, -0.04)));
        break;
    }
  }

  public reset() {
    this.growthTime = 0;
    this.currentStage = 'seed';
    this.isWilting = false;
    this.wiltProgress = 0;
    this.wiltParticles.visible = false;
    this.flowerParticles.visible = false;
    this.rebuildPlant();
    this.group.scale.set(1, 1, 1);
  }

  public vibrateLeaf(leafMesh: THREE.Mesh) {
    const leafData = this.leaves.find(l => l.mesh === leafMesh);
    if (leafData) {
      leafData.vibrating = true;
      leafData.vibrationStart = this.time;
    }
  }

  public scatterFlower(flowerGroup: THREE.Group) {
    const flowerData = this.flowers.find(f => f.group === flowerGroup);
    if (flowerData && !flowerData.scattered) {
      flowerData.scattered = true;
      this.flowerParticles.visible = true;

      const positions = this.flowerParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const sizes = this.flowerParticles.geometry.getAttribute('size') as THREE.BufferAttribute;

      for (let i = 0; i < 200; i++) {
        const idx = (Date.now() + i) % 1000;
        const basePos = flowerData.group.position;
        positions.setXYZ(
          idx,
          basePos.x + (Math.random() - 0.5) * 0.1,
          basePos.y + Math.random() * 0.1,
          basePos.z + (Math.random() - 0.5) * 0.1
        );
        sizes.setX(idx, 0.02 + Math.random() * 0.03);
      }
      positions.needsUpdate = true;
      sizes.needsUpdate = true;

      flowerData.group.visible = false;
    }
  }

  public getInteractableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    this.stemSegments.forEach(s => objects.push(s));
    this.leaves.forEach(l => objects.push(l.mesh));
    this.flowers.forEach(f => {
      f.petals.forEach(p => objects.push(p));
    });
    return objects;
  }

  public getFlowerGroupFromPetal(petal: THREE.Mesh): THREE.Group | null {
    for (const flower of this.flowers) {
      if (flower.petals.includes(petal)) {
        return flower.group;
      }
    }
    return null;
  }

  public update(delta: number) {
    this.time += delta;

    if (!this.isWilting || this.wiltProgress < 0.9) {
      this.growthTime += delta * this.getGrowthRate();
    }
    this.updateGrowth();

    const targetWilt = this.isWilting ? 1 : 0;
    this.wiltProgress += (targetWilt - this.wiltProgress) * delta * 2;

    if (this.stageTransitionStart > 0) {
      const t = (this.time - this.stageTransitionStart) / 0.5;
      if (t < 1) {
        const scale = 0.8 + 0.2 * t;
        this.group.scale.set(scale, scale, scale);
      } else {
        this.group.scale.set(1, 1, 1);
        this.stageTransitionStart = -1;
      }
    }

    this.updateStemBending();
    this.updateLeaves(delta);
    this.updateFlowers(delta);
    this.updateWiltParticles(delta);
    this.updateFlowerParticles(delta);
    this.updateSparkleParticles(delta);
  }

  private updateStemBending() {
    const wiltBend = this.wiltProgress * 0.4;
    this.stemSegments.forEach((segment, i) => {
      const t = i / this.stemSegments.length;
      segment.rotation.x = Math.sin(this.time * 0.5) * 0.02 * (1 + t) + wiltBend * t;
      segment.rotation.z = Math.cos(this.time * 0.7) * 0.02 * (1 + t);
    });
  }

  private updateLeaves(delta: number) {
    this.leaves.forEach(leaf => {
      const windAngle = Math.sin(this.time * 0.8 + leaf.windOffset) * 0.05;
      const droop = this.wiltProgress * 0.5;

      let rotation = leaf.baseRotation + windAngle - droop * leaf.side;

      if (leaf.vibrating) {
        const vt = (this.time - leaf.vibrationStart) / 0.3;
        if (vt < 1) {
          rotation += Math.sin(vt * Math.PI * 20) * 0.15 * (1 - vt);
        } else {
          leaf.vibrating = false;
        }
      }

      if (this.currentStage === 'adult' || this.currentStage === 'flowering') {
        const lightAngle = Math.atan2(this.lightDirection.x, this.lightDirection.z);
        leaf.mesh.rotation.y = leaf.side * (Math.PI / 6) + lightAngle * 0.3;
      }

      leaf.mesh.rotation.z = rotation;
    });
  }

  private updateFlowers(delta: number) {
    this.flowers.forEach((flower, idx) => {
      if (!flower.scattered) {
        flower.group.rotation.y = Math.sin(this.time * 0.3 + idx) * 0.1;
        flower.petals.forEach((petal, pIdx) => {
          const baseAngle = (pIdx / flower.petals.length) * Math.PI * 2;
          petal.rotation.x = -Math.PI / 6 + Math.sin(this.time * 0.6 + idx + pIdx) * 0.08;
          petal.rotation.y = baseAngle + Math.sin(this.time * 0.4 + pIdx) * 0.05;
        });
      }
    });
  }

  private updateWiltParticles(delta: number) {
    if (!this.wiltParticles.visible) return;

    const positions = this.wiltParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const sizes = this.wiltParticles.geometry.getAttribute('size') as THREE.BufferAttribute;
    const sizeArr = sizes.array as Float32Array;

    for (let i = 0; i < 2000; i++) {
      if (sizeArr[i] > 0.001) {
        arr[i * 3 + 1] -= delta * (0.05 + Math.random() * 0.05);
        arr[i * 3] += Math.sin(this.time + i) * delta * 0.02;
        arr[i * 3 + 2] += Math.cos(this.time + i) * delta * 0.02;
        sizeArr[i] *= 0.99;

        if (arr[i * 3 + 1] < -0.1) {
          sizeArr[i] = 0;
        }
      } else if (this.isWilting && Math.random() < 0.1) {
        arr[i * 3] = (Math.random() - 0.5) * 0.3;
        arr[i * 3 + 1] = 0.15 + Math.random() * 0.1;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        sizeArr[i] = 0.015 + Math.random() * 0.02;
      }
    }

    positions.needsUpdate = true;
    sizes.needsUpdate = true;
  }

  private updateFlowerParticles(delta: number) {
    if (!this.flowerParticles.visible) return;

    const positions = this.flowerParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const sizes = this.flowerParticles.geometry.getAttribute('size') as THREE.BufferAttribute;
    const sizeArr = sizes.array as Float32Array;
    const material = this.flowerParticles.material as THREE.PointsMaterial;

    let anyActive = false;

    for (let i = 0; i < 1000; i++) {
      if (sizeArr[i] > 0.001) {
        anyActive = true;
        arr[i * 3 + 1] += delta * 0.08;
        arr[i * 3] += (Math.random() - 0.5) * delta * 0.1;
        arr[i * 3 + 2] += (Math.random() - 0.5) * delta * 0.1;
        sizeArr[i] *= 0.985;
      }
    }

    positions.needsUpdate = true;
    sizes.needsUpdate = true;

    if (!anyActive) {
      this.flowerParticles.visible = false;
    }
  }

  private updateSparkleParticles(delta: number) {
    if (!this.sparkleActive) return;

    this.sparkleTime += delta;
    const positions = this.sparkleParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const sizes = this.sparkleParticles.geometry.getAttribute('size') as THREE.BufferAttribute;
    const sizeArr = sizes.array as Float32Array;
    const material = this.sparkleParticles.material as THREE.PointsMaterial;

    const alpha = Math.sin((this.sparkleTime / 0.8) * Math.PI);
    material.opacity = Math.max(0, alpha);

    for (let i = 0; i < 500; i++) {
      if (sizeArr[i] > 0) {
        arr[i * 3 + 1] += delta * 0.15;
        sizeArr[i] *= 0.97;
      }
    }

    positions.needsUpdate = true;
    sizes.needsUpdate = true;

    if (this.sparkleTime > 0.8) {
      this.sparkleActive = false;
      this.sparkleParticles.visible = false;
    }
  }

  public dispose() {
    this.clearStem();
    this.clearLeaves();
    this.clearFlowers();
    if (this.seedMesh) {
      this.seedMesh.geometry.dispose();
      (this.seedMesh.material as THREE.Material).dispose();
    }
  }
}
