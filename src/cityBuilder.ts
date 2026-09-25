import * as THREE from 'three';

export type HeightDistribution = 'uniform' | 'pyramid' | 'random';
export type ColorTheme = 'sunset' | 'cyberpunk' | 'nordic';

export interface ScaleAnimation {
  kind: 'rise' | 'fall' | 'morph';
  startTime: number;
  duration: number;
  fromScale: number;
  toScale: number;
}

export interface ColorAnimation {
  startTime: number;
  duration: number;
  from: THREE.Color;
  to: THREE.Color;
}

export interface PositionAnimation {
  startTime: number;
  duration: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

export interface BuildingData {
  id: string;
  mesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  gridX: number;
  gridZ: number;
  height: number;
  width: number;
  depth: number;
  color: THREE.Color;
  targetColor: THREE.Color;
  scaleAnim: ScaleAnimation | null;
  colorAnim: ColorAnimation | null;
  posAnim: PositionAnimation | null;
}

export interface CityParams {
  gridSize: number;
  density: number;
  buildingSpacing: number;
  minHeight: number;
  maxHeight: number;
  heightDistribution: HeightDistribution;
  colorTheme: ColorTheme;
}

interface SpawnTask {
  gridX: number;
  gridZ: number;
  startAt: number;
  duration: number;
}

const colorThemes: Record<ColorTheme, string[]> = {
  sunset: ['#ff6b35', '#f7c59f', '#ef476f', '#9b5de5', '#7209b7', '#f72585'],
  cyberpunk: ['#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5', '#fee440', '#00ff88'],
  nordic: ['#f8f9fa', '#e9ecef', '#dee2e6', '#adb5bd', '#6c757d', '#a8dadc']
};

export class CityBuilder {
  private scene: THREE.Scene;
  private buildings: Map<string, BuildingData> = new Map();
  private params: CityParams;
  private animationFrame: number | null = null;
  private fog: THREE.Fog;
  private spawnQueue: SpawnTask[] = [];

  onBuildingRemoved: ((building: BuildingData) => void) | null = null;

  constructor(scene: THREE.Scene, initialParams: Partial<CityParams> = {}) {
    this.scene = scene;
    this.params = {
      gridSize: 10,
      density: 0.7,
      buildingSpacing: 2.5,
      minHeight: 5,
      maxHeight: 50,
      heightDistribution: 'pyramid',
      colorTheme: 'sunset',
      ...initialParams
    };

    this.fog = new THREE.Fog(0x1a1040, 30, 150);
    this.scene.fog = this.fog;
    this.updateFogDensity();
  }

  getParams(): CityParams {
    return { ...this.params };
  }

  getBuildings(): BuildingData[] {
    return Array.from(this.buildings.values());
  }

  getTargetBuildingCount(): number {
    const totalCells = this.params.gridSize * this.params.gridSize;
    return Math.floor(totalCells * this.params.density);
  }

  updateParams(newParams: Partial<CityParams>): void {
    const prev = { ...this.params };
    Object.assign(this.params, newParams);

    const layoutChanged =
      prev.gridSize !== this.params.gridSize ||
      prev.buildingSpacing !== this.params.buildingSpacing;
    const countChanged = layoutChanged || prev.density !== this.params.density;
    const heightChanged =
      prev.heightDistribution !== this.params.heightDistribution ||
      prev.minHeight !== this.params.minHeight ||
      prev.maxHeight !== this.params.maxHeight ||
      prev.gridSize !== this.params.gridSize;
    const themeChanged = prev.colorTheme !== this.params.colorTheme;

    if (layoutChanged) {
      this.refreshGround();
      this.repositionBuildings();
    }
    if (countChanged) {
      this.syncBuildingSet();
    }
    if (heightChanged) {
      this.recomputeHeights();
    }
    if (themeChanged) {
      this.startColorTransition();
    }

    this.updateFogDensity();
  }

  generateCity(): void {
    this.cancelPendingSpawns();
    this.clearCity();
    this.refreshGround();

    const positions = this.computePrioritizedPositions();
    const selected = positions.slice(0, this.getTargetBuildingCount());
    const now = performance.now();

    selected.forEach((pos, index) => {
      this.spawnQueue.push({
        gridX: pos.x,
        gridZ: pos.z,
        startAt: now + index * 30,
        duration: 1.5
      });
    });
    this.ensureAnimationLoop();
  }

  private syncBuildingSet(): void {
    this.cancelPendingSpawns();

    const target = this.getTargetBuildingCount();
    const standing: BuildingData[] = [];
    const falling: BuildingData[] = [];
    this.buildings.forEach(building => {
      if (building.scaleAnim && building.scaleAnim.kind === 'fall') {
        falling.push(building);
      } else {
        standing.push(building);
      }
    });

    let current = standing.length;

    if (current < target && falling.length > 0) {
      falling.sort((a, b) => b.scaleAnim!.startTime - a.scaleAnim!.startTime);
      const toRevive = falling.slice(0, target - current);
      toRevive.forEach(building => this.reviveBuilding(building));
      current += toRevive.length;
    }

    if (current < target) {
      const occupied = new Set<string>();
      this.buildings.forEach(building => occupied.add(`${building.gridX},${building.gridZ}`));
      const available = this.computePrioritizedPositions(occupied);
      const toAdd = available.slice(0, target - current);
      const now = performance.now();
      toAdd.forEach((pos, index) => {
        this.spawnQueue.push({
          gridX: pos.x,
          gridZ: pos.z,
          startAt: now + index * 20,
          duration: 0.8
        });
      });
      this.ensureAnimationLoop();
    } else if (current > target) {
      const shuffled = [...standing].sort(() => Math.random() - 0.5);
      const toRemove = shuffled.slice(0, current - target);
      const now = performance.now();
      toRemove.forEach((building, index) => {
        this.startFall(building, 0.8, now + index * 20);
      });
    }
  }

  private computePrioritizedPositions(
    exclude?: Set<string>
  ): { x: number; z: number; priority: number }[] {
    const positions: { x: number; z: number; priority: number }[] = [];
    for (let x = 0; x < this.params.gridSize; x++) {
      for (let z = 0; z < this.params.gridSize; z++) {
        if (exclude && exclude.has(`${x},${z}`)) continue;
        const centerDist = Math.sqrt(
          Math.pow(x - (this.params.gridSize - 1) / 2, 2) +
          Math.pow(z - (this.params.gridSize - 1) / 2, 2)
        );
        const priority = Math.random() + (1 - centerDist / this.params.gridSize) * 0.5;
        positions.push({ x, z, priority });
      }
    }
    positions.sort((a, b) => b.priority - a.priority);
    return positions;
  }

  private reviveBuilding(building: BuildingData): void {
    building.scaleAnim = {
      kind: 'rise',
      startTime: performance.now(),
      duration: 0.8,
      fromScale: Math.max(building.mesh.scale.y, 0.01),
      toScale: 1
    };
    building.glowMesh.visible = true;
    this.ensureAnimationLoop();
  }

  private startFall(building: BuildingData, duration: number, startTime: number): void {
    building.scaleAnim = {
      kind: 'fall',
      startTime,
      duration,
      fromScale: building.mesh.scale.y,
      toScale: 0
    };
    this.ensureAnimationLoop();
  }

  private recomputeHeights(): void {
    const now = performance.now();
    this.buildings.forEach(building => {
      if (building.scaleAnim && building.scaleAnim.kind === 'fall') return;
      const newHeight = this.generateHeight(building.gridX, building.gridZ);
      this.applyHeight(building, newHeight, now);
    });
    this.ensureAnimationLoop();
  }

  private applyHeight(building: BuildingData, newHeight: number, now: number): void {
    const visualHeight = building.height * building.mesh.scale.y;
    building.height = newHeight;

    building.mesh.geometry.dispose();
    building.mesh.geometry = new THREE.BoxGeometry(building.width, newHeight, building.depth);
    building.glowMesh.geometry.dispose();
    building.glowMesh.geometry = new THREE.BoxGeometry(
      building.width * 1.05,
      0.3,
      building.depth * 1.05
    );

    building.scaleAnim = {
      kind: 'morph',
      startTime: now,
      duration: 0.8,
      fromScale: Math.max(visualHeight / newHeight, 0.01),
      toScale: 1
    };
  }

  private startColorTransition(duration: number = 1.2): void {
    const now = performance.now();
    this.buildings.forEach(building => {
      const target = this.getRandomColor();
      building.targetColor.copy(target);
      building.colorAnim = {
        startTime: now,
        duration,
        from: building.color.clone(),
        to: target
      };
    });
    this.ensureAnimationLoop();
  }

  private repositionBuildings(duration: number = 0.6): void {
    const now = performance.now();
    const offset = ((this.params.gridSize - 1) * this.params.buildingSpacing) / 2;
    this.buildings.forEach(building => {
      building.posAnim = {
        startTime: now,
        duration,
        fromX: building.mesh.position.x,
        fromZ: building.mesh.position.z,
        toX: building.gridX * this.params.buildingSpacing - offset,
        toZ: building.gridZ * this.params.buildingSpacing - offset
      };
    });
    this.ensureAnimationLoop();
  }

  private ensureAnimationLoop(): void {
    if (this.animationFrame === null) {
      this.animationFrame = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    const now = performance.now();

    if (this.spawnQueue.length > 0) {
      const remaining: SpawnTask[] = [];
      for (const task of this.spawnQueue) {
        if (now >= task.startAt) {
          this.createBuilding(task.gridX, task.gridZ, task.duration);
        } else {
          remaining.push(task);
        }
      }
      this.spawnQueue = remaining;
    }

    const finishedFalls: BuildingData[] = [];
    this.buildings.forEach(building => {
      this.updateScaleAnimation(building, now, finishedFalls);
      this.updateColorAnimation(building, now);
      this.updatePositionAnimation(building, now);
    });
    finishedFalls.forEach(building => this.finalizeRemoval(building));

    let hasWork = this.spawnQueue.length > 0;
    if (!hasWork) {
      this.buildings.forEach(building => {
        if (building.scaleAnim || building.colorAnim || building.posAnim) {
          hasWork = true;
        }
      });
    }

    if (hasWork) {
      this.animationFrame = requestAnimationFrame(() => this.tick());
    } else {
      this.animationFrame = null;
    }
  }

  private updateScaleAnimation(
    building: BuildingData,
    now: number,
    finishedFalls: BuildingData[]
  ): void {
    const anim = building.scaleAnim;
    if (!anim) return;

    const progress = Math.min(Math.max((now - anim.startTime) / 1000 / anim.duration, 0), 1);
    let eased: number;
    if (anim.kind === 'fall') {
      eased = this.easeInBack(progress);
    } else if (anim.kind === 'rise') {
      eased = this.easeOutBack(progress);
    } else {
      eased = this.easeInOutQuad(progress);
    }

    const scale = anim.fromScale + (anim.toScale - anim.fromScale) * eased;
    building.mesh.scale.y = Math.max(scale, 0.0001);
    building.mesh.position.y = (building.height * building.mesh.scale.y) / 2;
    building.glowMesh.position.y = building.height * building.mesh.scale.y + 0.15;

    const glowMaterial = building.glowMesh.material as THREE.MeshBasicMaterial;
    if (anim.kind === 'fall') {
      glowMaterial.opacity = Math.min(Math.max(0.8 * (1 - eased), 0), 1);
    } else if (anim.kind === 'rise') {
      if (progress > 0.7) {
        building.glowMesh.visible = true;
        glowMaterial.opacity = ((progress - 0.7) / 0.3) * 0.8;
      } else {
        building.glowMesh.visible = false;
      }
    } else {
      building.glowMesh.visible = true;
      glowMaterial.opacity = 0.8;
    }

    if (progress >= 1) {
      building.scaleAnim = null;
      if (anim.kind === 'fall') {
        finishedFalls.push(building);
      } else {
        building.mesh.scale.y = 1;
        building.mesh.position.y = building.height / 2;
        building.glowMesh.position.y = building.height + 0.15;
        building.glowMesh.visible = true;
        glowMaterial.opacity = 0.8;
      }
    }
  }

  private updateColorAnimation(building: BuildingData, now: number): void {
    const anim = building.colorAnim;
    if (!anim) return;

    const progress = Math.min(Math.max((now - anim.startTime) / 1000 / anim.duration, 0), 1);
    building.color.lerpColors(anim.from, anim.to, progress);

    const material = building.mesh.material as THREE.MeshPhongMaterial;
    material.color.copy(building.color);
    material.emissive.copy(building.color).multiplyScalar(0.1);

    const glowMaterial = building.glowMesh.material as THREE.MeshBasicMaterial;
    glowMaterial.color.copy(building.color).multiplyScalar(0.5);

    if (progress >= 1) {
      building.color.copy(anim.to);
      building.colorAnim = null;
    }
  }

  private updatePositionAnimation(building: BuildingData, now: number): void {
    const anim = building.posAnim;
    if (!anim) return;

    const progress = Math.min(Math.max((now - anim.startTime) / 1000 / anim.duration, 0), 1);
    const eased = this.easeInOutQuad(progress);
    building.mesh.position.x = anim.fromX + (anim.toX - anim.fromX) * eased;
    building.mesh.position.z = anim.fromZ + (anim.toZ - anim.fromZ) * eased;
    building.glowMesh.position.x = building.mesh.position.x;
    building.glowMesh.position.z = building.mesh.position.z;

    if (progress >= 1) {
      building.posAnim = null;
    }
  }

  private createBuilding(
    gridX: number,
    gridZ: number,
    riseDuration: number = 1.5
  ): BuildingData | null {
    const id = `${gridX}-${gridZ}`;
    if (this.buildings.has(id)) {
      return null;
    }

    const height = this.generateHeight(gridX, gridZ);
    const width = 0.8 + Math.random() * 0.6;
    const depth = 0.8 + Math.random() * 0.6;

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const color = this.getRandomColor();
    const material = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color.clone().multiplyScalar(0.1),
      shininess: 30,
      specular: 0x444444
    });

    const mesh = new THREE.Mesh(geometry, material);
    const offset = ((this.params.gridSize - 1) * this.params.buildingSpacing) / 2;
    mesh.position.x = gridX * this.params.buildingSpacing - offset;
    mesh.position.y = height / 2;
    mesh.position.z = gridZ * this.params.buildingSpacing - offset;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const glowGeometry = new THREE.BoxGeometry(width * 1.05, 0.3, depth * 1.05);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.5),
      transparent: true,
      opacity: 0.8
    });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.position.x = mesh.position.x;
    glowMesh.position.y = height + 0.15;
    glowMesh.position.z = mesh.position.z;

    this.scene.add(mesh);
    this.scene.add(glowMesh);

    const building: BuildingData = {
      id,
      mesh,
      glowMesh,
      gridX,
      gridZ,
      height,
      width,
      depth,
      color: color.clone(),
      targetColor: color.clone(),
      scaleAnim: null,
      colorAnim: null,
      posAnim: null
    };

    this.buildings.set(id, building);

    building.scaleAnim = {
      kind: 'rise',
      startTime: performance.now(),
      duration: riseDuration,
      fromScale: 0.01,
      toScale: 1
    };
    mesh.scale.y = 0.01;
    mesh.position.y = 0.005;
    glowMesh.visible = false;
    this.ensureAnimationLoop();

    return building;
  }

  private finalizeRemoval(building: BuildingData): void {
    this.disposeBuildingMeshes(building);
    this.buildings.delete(building.id);
    if (this.onBuildingRemoved) {
      this.onBuildingRemoved(building);
    }
  }

  private disposeBuildingMeshes(building: BuildingData): void {
    this.scene.remove(building.mesh);
    this.scene.remove(building.glowMesh);
    building.mesh.geometry.dispose();
    (building.mesh.material as THREE.Material).dispose();
    building.glowMesh.geometry.dispose();
    (building.glowMesh.material as THREE.Material).dispose();
  }

  highlightBuilding(building: BuildingData, duration: number = 0.3): void {
    const material = building.mesh.material as THREE.MeshPhongMaterial;
    const glowMaterial = building.glowMesh.material as THREE.MeshBasicMaterial;
    const originalEmissive = material.emissive.clone();
    const originalGlowOpacity = glowMaterial.opacity;
    const targetEmissive = building.color.clone().multiplyScalar(0.6);

    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / (duration / 2), 1);
      const pulse = Math.sin(progress * Math.PI);

      material.emissive.lerpColors(originalEmissive, targetEmissive, pulse);
      glowMaterial.opacity = originalGlowOpacity + pulse * 0.5;

      if (progress < 1 || elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        material.emissive.copy(originalEmissive);
        glowMaterial.opacity = originalGlowOpacity;
      }
    };

    animate();
  }

  clearCity(): void {
    this.cancelPendingSpawns();
    const removed = Array.from(this.buildings.values());
    this.buildings.clear();
    removed.forEach(building => {
      this.disposeBuildingMeshes(building);
      if (this.onBuildingRemoved) {
        this.onBuildingRemoved(building);
      }
    });
  }

  private cancelPendingSpawns(): void {
    this.spawnQueue = [];
  }

  private refreshGround(): void {
    this.removeGround();
    this.createGround();
  }

  private removeGround(): void {
    const ground = this.scene.getObjectByName('ground') as THREE.GridHelper | null;
    if (ground) {
      this.scene.remove(ground);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
    }
    const groundPlane = this.scene.getObjectByName('groundPlane') as THREE.Mesh | null;
    if (groundPlane) {
      this.scene.remove(groundPlane);
      groundPlane.geometry.dispose();
      (groundPlane.material as THREE.Material).dispose();
    }
  }

  private createGround(): void {
    const groundSize = this.params.gridSize * this.params.buildingSpacing + 10;
    const gridHelper = new THREE.GridHelper(groundSize, Math.floor(groundSize), 0x444466, 0x333355);
    gridHelper.position.y = 0;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.4;
    gridHelper.name = 'ground';
    this.scene.add(gridHelper);

    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMaterial = new THREE.MeshBasicMaterial({
      color: 0x151030,
      transparent: true,
      opacity: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.name = 'groundPlane';
    this.scene.add(ground);
  }

  private generateHeight(gridX: number, gridZ: number): number {
    const { minHeight, maxHeight, heightDistribution, gridSize } = this.params;
    const range = maxHeight - minHeight;

    switch (heightDistribution) {
      case 'uniform':
        return minHeight + Math.random() * range;

      case 'pyramid': {
        const centerX = (gridSize - 1) / 2;
        const centerZ = (gridSize - 1) / 2;
        const maxDist = Math.sqrt(centerX * centerX + centerZ * centerZ);
        const dist = Math.sqrt(
          Math.pow(gridX - centerX, 2) + Math.pow(gridZ - centerZ, 2)
        );
        const heightFactor = 1 - (dist / maxDist) * 0.7;
        return minHeight + range * heightFactor * (0.7 + Math.random() * 0.3);
      }

      case 'random': {
        const rand = Math.random();
        if (rand < 0.6) {
          return minHeight + Math.random() * range * 0.4;
        } else if (rand < 0.9) {
          return minHeight + range * 0.3 + Math.random() * range * 0.5;
        } else {
          return minHeight + range * 0.7 + Math.random() * range * 0.3;
        }
      }

      default:
        return minHeight + Math.random() * range;
    }
  }

  private getRandomColor(): THREE.Color {
    const colors = colorThemes[this.params.colorTheme];
    const colorStr = colors[Math.floor(Math.random() * colors.length)];
    return new THREE.Color(colorStr);
  }

  private updateFogDensity(): void {
    const fogNear = 30 + (1 - this.params.density) * 40;
    const fogFar = 120 + (1 - this.params.density) * 60;
    this.fog.near = fogNear;
    this.fog.far = fogFar;
  }

  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  private easeInBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  dispose(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.clearCity();
    this.removeGround();
  }
}
