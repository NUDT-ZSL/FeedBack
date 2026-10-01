import * as THREE from 'three';

export type HeightDistribution = 'uniform' | 'pyramid' | 'random';
export type ColorTheme = 'sunset' | 'cyberpunk' | 'nordic';

export interface BuildingData {
  id: string;
  mesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  gridX: number;
  gridZ: number;
  height: number;
  width: number;
  color: THREE.Color;
  targetColor: THREE.Color;
  isAnimating: boolean;
  animationProgress: number;
  animationType: 'none' | 'rise' | 'fall' | 'color';
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

  updateParams(newParams: Partial<CityParams>): void {
    const oldDensity = this.params.density;
    const oldHeightDist = this.params.heightDistribution;
    const oldTheme = this.params.colorTheme;

    Object.assign(this.params, newParams);

    if ('density' in newParams || 'heightDistribution' in newParams) {
      if (oldDensity !== this.params.density || oldHeightDist !== this.params.heightDistribution) {
        this.rebuildCity();
      }
    }

    if ('colorTheme' in newParams && oldTheme !== this.params.colorTheme) {
      this.animateColorTransition();
    }

    this.updateFogDensity();
  }

  private updateFogDensity(): void {
    const fogNear = 30 + (1 - this.params.density) * 40;
    const fogFar = 120 + (1 - this.params.density) * 60;
    this.fog.near = fogNear;
    this.fog.far = fogFar;
  }

  getBuildings(): BuildingData[] {
    return Array.from(this.buildings.values());
  }

  generateCity(): void {
    this.clearCity();
    this.createGround();

    const totalCells = this.params.gridSize * this.params.gridSize;
    const targetBuildings = Math.floor(totalCells * this.params.density);

    const positions: { x: number; z: number; priority: number }[] = [];
    for (let x = 0; x < this.params.gridSize; x++) {
      for (let z = 0; z < this.params.gridSize; z++) {
        const centerDist = Math.sqrt(
          Math.pow(x - (this.params.gridSize - 1) / 2, 2) +
          Math.pow(z - (this.params.gridSize - 1) / 2, 2)
        );
        const priority = Math.random() + (1 - centerDist / this.params.gridSize) * 0.5;
        positions.push({ x, z, priority });
      }
    }

    positions.sort((a, b) => b.priority - a.priority);
    const selectedPositions = positions.slice(0, targetBuildings);

    selectedPositions.forEach((pos, index) => {
      const delay = index * 0.03;
      setTimeout(() => {
        this.createBuilding(pos.x, pos.z, 'rise');
      }, delay * 1000);
    });
  }

  rebuildCity(): void {
    const totalCells = this.params.gridSize * this.params.gridSize;
    const targetCount = Math.floor(totalCells * this.params.density);
    const currentCount = this.buildings.size;

    if (targetCount > currentCount) {
      const existingPositions = new Set(
        this.getBuildings().map(b => `${b.gridX},${b.gridZ}`)
      );

      const availablePositions: { x: number; z: number; priority: number }[] = [];
      for (let x = 0; x < this.params.gridSize; x++) {
        for (let z = 0; z < this.params.gridSize; z++) {
          if (!existingPositions.has(`${x},${z}`)) {
            const centerDist = Math.sqrt(
              Math.pow(x - (this.params.gridSize - 1) / 2, 2) +
              Math.pow(z - (this.params.gridSize - 1) / 2, 2)
            );
            const priority = Math.random() + (1 - centerDist / this.params.gridSize) * 0.5;
            availablePositions.push({ x, z, priority });
          }
        }
      }

      availablePositions.sort((a, b) => b.priority - a.priority);
      const toAdd = availablePositions.slice(0, targetCount - currentCount);

      toAdd.forEach((pos, index) => {
        const delay = index * 0.02;
        setTimeout(() => {
          this.createBuilding(pos.x, pos.z, 'rise', 0.8);
        }, delay * 1000);
      });
    } else if (targetCount < currentCount) {
      const buildingsArray = this.getBuildings();
      buildingsArray.sort(() => Math.random() - 0.5);
      const toRemove = buildingsArray.slice(0, currentCount - targetCount);

      toRemove.forEach((building, index) => {
        const delay = index * 0.02;
        setTimeout(() => {
          this.removeBuilding(building, 0.8);
        }, delay * 1000);
      });
    }
  }

  private createGround(): void {
    const groundSize = this.params.gridSize * this.params.buildingSpacing + 10;
    const gridHelper = new THREE.GridHelper(groundSize, Math.floor(groundSize), 0x444466, 0x333355);
    gridHelper.position.y = 0;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.4;
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

  private createBuilding(
    gridX: number,
    gridZ: number,
    animationType: 'rise' | 'none' = 'rise',
    animationDuration: number = 1.5
  ): BuildingData {
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
    const offset = (this.params.gridSize - 1) * this.params.buildingSpacing / 2;
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

    const id = `${gridX}-${gridZ}`;
    const building: BuildingData = {
      id,
      mesh,
      glowMesh,
      gridX,
      gridZ,
      height,
      width,
      color: color.clone(),
      targetColor: color.clone(),
      isAnimating: animationType === 'rise',
      animationProgress: animationType === 'rise' ? 0 : 1,
      animationType: animationType === 'rise' ? 'rise' : 'none'
    };

    this.buildings.set(id, building);

    if (animationType === 'rise') {
      mesh.scale.y = 0.01;
      mesh.position.y = 0.01;
      glowMesh.visible = false;
      this.animateBuildingRise(building, animationDuration);
    }

    return building;
  }

  private animateBuildingRise(building: BuildingData, duration: number): void {
    const startTime = performance.now();
    const startScale = 0.01;
    const targetScale = 1;
    const targetY = building.height / 2;

    building.isAnimating = true;
    building.animationType = 'rise';

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutBack(progress);

      building.mesh.scale.y = startScale + (targetScale - startScale) * eased;
      building.mesh.position.y = 0.01 + targetY * eased;
      building.animationProgress = progress;

      if (progress > 0.7) {
        building.glowMesh.visible = true;
        (building.glowMesh.material as THREE.MeshBasicMaterial).opacity = (progress - 0.7) / 0.3 * 0.8;
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        building.isAnimating = false;
        building.animationType = 'none';
        building.glowMesh.position.y = building.height + 0.15;
      }
    };

    animate();
  }

  private removeBuilding(building: BuildingData, duration: number = 0.8): void {
    const startTime = performance.now();
    const startScale = building.mesh.scale.y;
    const startY = building.mesh.position.y;

    building.isAnimating = true;
    building.animationType = 'fall';

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeInBack(progress);

      building.mesh.scale.y = startScale * (1 - eased);
      building.mesh.position.y = startY * (1 - eased);
      (building.glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - eased);
      building.animationProgress = progress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(building.mesh);
        this.scene.remove(building.glowMesh);
        building.mesh.geometry.dispose();
        (building.mesh.material as THREE.Material).dispose();
        building.glowMesh.geometry.dispose();
        (building.glowMesh.material as THREE.Material).dispose();
        this.buildings.delete(building.id);
      }
    };

    animate();
  }

  private animateColorTransition(duration: number = 1.2): void {
    const buildings = this.getBuildings();
    buildings.forEach(building => {
      building.targetColor = this.getRandomColor();
    });

    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);

      buildings.forEach(building => {
        building.color.lerpColors(
          building.color.clone(),
          building.targetColor,
          progress
        );

        const material = building.mesh.material as THREE.MeshPhongMaterial;
        material.color.copy(building.color);
        material.emissive.copy(building.color.clone().multiplyScalar(0.1));

        const glowMaterial = building.glowMesh.material as THREE.MeshBasicMaterial;
        glowMaterial.color.copy(building.color.clone().multiplyScalar(0.5));
      });

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        buildings.forEach(building => {
          building.color.copy(building.targetColor);
        });
      }
    };

    animate();
  }

  highlightBuilding(building: BuildingData, duration: number = 0.3): void {
    const originalEmissive = (building.mesh.material as THREE.MeshPhongMaterial).emissive.clone();
    const originalGlowOpacity = (building.glowMesh.material as THREE.MeshBasicMaterial).opacity;
    const targetEmissive = building.color.clone().multiplyScalar(0.6);

    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / (duration / 2), 1);
      const pulse = Math.sin(progress * Math.PI);

      const material = building.mesh.material as THREE.MeshPhongMaterial;
      material.emissive.lerpColors(originalEmissive, targetEmissive, pulse);

      const glowMaterial = building.glowMesh.material as THREE.MeshBasicMaterial;
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
    this.buildings.forEach(building => {
      this.scene.remove(building.mesh);
      this.scene.remove(building.glowMesh);
      building.mesh.geometry.dispose();
      (building.mesh.material as THREE.Material).dispose();
      building.glowMesh.geometry.dispose();
      (building.glowMesh.material as THREE.Material).dispose();
    });
    this.buildings.clear();

    const ground = this.scene.getObjectByName('ground');
    if (ground) this.scene.remove(ground);
    const groundPlane = this.scene.getObjectByName('groundPlane');
    if (groundPlane) this.scene.remove(groundPlane);
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

  dispose(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.clearCity();
  }
}
