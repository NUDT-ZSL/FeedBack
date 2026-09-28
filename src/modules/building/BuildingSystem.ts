import * as THREE from 'three';
import { sceneManager } from '../../core/SceneManager';

export interface BuildingData {
  id: string;
  position: THREE.Vector3;
  height: number;
  color: number;
  group: THREE.Group;
  mesh: THREE.Mesh;
  topLight: THREE.PointLight | null;
}

export const BUILDING_COLORS = [
  0x3498db,
  0xe74c3c,
  0x2ecc71,
  0xf39c12,
  0x9b59b6,
  0x1abc9c,
  0xe91e63,
  0x607d8b,
];

const MIN_HEIGHT = 5;
const MAX_HEIGHT = 100;
const CELL_SIZE = 10;
const GRID_SIZE = 50;
const GRID_OFFSET = (GRID_SIZE * CELL_SIZE) / 2;

export class BuildingSystem {
  private static _instance: BuildingSystem;
  private _buildings: BuildingData[] = [];
  private _nextId: number = 1;
  private _isNightMode: boolean = false;
  private _sortByHeight: 'asc' | 'desc' | null = null;

  private constructor() {}

  public static get instance(): BuildingSystem {
    if (!BuildingSystem._instance) {
      BuildingSystem._instance = new BuildingSystem();
    }
    return BuildingSystem._instance;
  }

  private _snapToGrid(value: number): number {
    return Math.round(value / CELL_SIZE) * CELL_SIZE;
  }

  private _clampToGrid(value: number): number {
    const min = -GRID_OFFSET + CELL_SIZE / 2;
    const max = GRID_OFFSET - CELL_SIZE / 2;
    return Math.max(min, Math.min(max, value));
  }

  private _generateId(): string {
    return `building_${this._nextId++}`;
  }

  public addBuilding(worldX: number, worldZ: number, height: number = 20, colorIndex: number = 0): BuildingData | null {
    if (this._buildings.length >= 100) {
      return null;
    }

    const x = this._clampToGrid(this._snapToGrid(worldX));
    const z = this._clampToGrid(this._snapToGrid(worldZ));

    for (const building of this._buildings) {
      if (Math.abs(building.position.x - x) < CELL_SIZE * 0.8 &&
          Math.abs(building.position.z - z) < CELL_SIZE * 0.8) {
        return null;
      }
    }

    const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
    const color = BUILDING_COLORS[colorIndex % BUILDING_COLORS.length];

    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const geometry = new THREE.BoxGeometry(CELL_SIZE * 0.8, clampedHeight, CELL_SIZE * 0.8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.7,
      metalness: 0.3,
      transparent: false,
      opacity: 1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = clampedHeight / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.buildingId = '';

    group.add(mesh);

    const topLight = new THREE.PointLight(color, 2, 40);
    topLight.position.set(
      (Math.random() - 0.5) * CELL_SIZE * 0.5,
      clampedHeight + 1,
      (Math.random() - 0.5) * CELL_SIZE * 0.5
    );
    topLight.visible = false;
    group.add(topLight);

    const building: BuildingData = {
      id: this._generateId(),
      position: new THREE.Vector3(x, 0, z),
      height: clampedHeight,
      color: color,
      group: group,
      mesh: mesh,
      topLight: topLight,
    };

    mesh.userData.buildingId = building.id;

    this._buildings.push(building);
    sceneManager.addObject(group);

    this._animateBuildIn(group, mesh, clampedHeight);

    return building;
  }

  private _animateBuildIn(group: THREE.Group, mesh: THREE.Mesh, targetHeight: number): void {
    const startTime = performance.now();
    const duration = 500;

    mesh.scale.y = 0.01;
    mesh.position.y = 0.005;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const scale = easeOut;
      
      mesh.scale.y = scale;
      mesh.position.y = (targetHeight * scale) / 2;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  public updateHeight(id: string, newHeight: number): boolean {
    const building = this._buildings.find(b => b.id === id);
    if (!building) return false;

    const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
    building.height = clampedHeight;

    const oldGeometry = building.mesh.geometry;
    const newGeometry = new THREE.BoxGeometry(CELL_SIZE * 0.8, clampedHeight, CELL_SIZE * 0.8);
    building.mesh.geometry = newGeometry;
    oldGeometry.dispose();

    building.mesh.position.y = clampedHeight / 2;

    if (building.topLight) {
      const lightY = clampedHeight + 1;
      building.topLight.position.y = lightY;
    }

    return true;
  }

  public updateColor(id: string, colorIndex: number): boolean {
    const building = this._buildings.find(b => b.id === id);
    if (!building) return false;

    const color = BUILDING_COLORS[colorIndex % BUILDING_COLORS.length];
    building.color = color;

    const material = building.mesh.material as THREE.MeshStandardMaterial;
    
    const startColor = new THREE.Color(material.color.getHex());
    const endColor = new THREE.Color(color);
    const startTime = performance.now();
    const duration = 300;

    const animateColor = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      material.color.lerpColors(startColor, endColor, progress);

      if (building.topLight) {
        building.topLight.color.lerpColors(startColor, endColor, progress);
      }

      if (progress < 1) {
        requestAnimationFrame(animateColor);
      }
    };

    requestAnimationFrame(animateColor);

    return true;
  }

  public removeBuilding(id: string): boolean {
    const index = this._buildings.findIndex(b => b.id === id);
    if (index === -1) return false;

    const building = this._buildings[index];
    
    sceneManager.removeObject(building.group);
    
    building.mesh.geometry.dispose();
    if (building.mesh.material instanceof THREE.Material) {
      building.mesh.material.dispose();
    }
    if (building.topLight) {
      building.topLight.dispose();
    }

    this._buildings.splice(index, 1);
    return true;
  }

  public removeBuildings(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      if (this.removeBuilding(id)) {
        count++;
      }
    }
    return count;
  }

  public getBuildings(): BuildingData[] {
    let result = [...this._buildings];
    
    if (this._sortByHeight === 'asc') {
      result.sort((a, b) => a.height - b.height);
    } else if (this._sortByHeight === 'desc') {
      result.sort((a, b) => b.height - a.height);
    }
    
    return result;
  }

  public getBuildingById(id: string): BuildingData | undefined {
    return this._buildings.find(b => b.id === id);
  }

  public getBuildingCount(): number {
    return this._buildings.length;
  }

  public setSortByHeight(order: 'asc' | 'desc' | null): void {
    this._sortByHeight = order;
  }

  public getSortByHeight(): 'asc' | 'desc' | null {
    return this._sortByHeight;
  }

  public setNightMode(isNight: boolean): void {
    this._isNightMode = isNight;
    
    for (const building of this._buildings) {
      const material = building.mesh.material as THREE.MeshStandardMaterial;
      
      if (isNight) {
        material.transparent = false;
        material.opacity = 1;
      } else {
        material.transparent = true;
        material.opacity = 0.7;
      }
    }
  }

  public isNightMode(): boolean {
    return this._isNightMode;
  }

  public getAllBuildingMeshes(): THREE.Mesh[] {
    return this._buildings.map(b => b.mesh);
  }

  public getBuildingByMesh(mesh: THREE.Mesh): BuildingData | undefined {
    return this._buildings.find(b => b.mesh === mesh || b.group === mesh.parent);
  }

  public snapWorldPosition(x: number, z: number): { x: number; z: number } {
    return {
      x: this._clampToGrid(this._snapToGrid(x)),
      z: this._clampToGrid(this._snapToGrid(z)),
    };
  }

  public getMinHeight(): number {
    return MIN_HEIGHT;
  }

  public getMaxHeight(): number {
    return MAX_HEIGHT;
  }

  public getCellSize(): number {
    return CELL_SIZE;
  }
}

export const buildingSystem = BuildingSystem.instance;
