import * as THREE from 'three';

export interface FurnitureData {
  type: string;
  name: string;
  width: number;
  height: number;
  depth: number;
  color: number;
}

export interface FurnitureItem {
  id: string;
  type: string;
  group: THREE.Group;
  data: FurnitureData;
  originalPosition: THREE.Vector3;
  isDragging: boolean;
  isColliding: boolean;
  isSelected: boolean;
  targetRotation: number;
  currentRotation: number;
  isAnimatingRotation: boolean;
  rotationAnimationTime: number;
  rotationStartRotation: number;
  rotationIsReverting: boolean;
  isBouncing: boolean;
  bounceStartPosition: THREE.Vector3;
  bounceEndPosition: THREE.Vector3;
  bounceAnimationTime: number;
}

export const FURNITURE_TYPES: Record<string, FurnitureData> = {
  sofa: { type: 'sofa', name: '沙发', width: 2.4, height: 0.9, depth: 0.9, color: 0xC4A484 },
  table: { type: 'table', name: '桌子', width: 1.6, height: 0.75, depth: 0.9, color: 0xB8956E },
  chair: { type: 'chair', name: '椅子', width: 0.6, height: 0.9, depth: 0.6, color: 0xA0826D },
  bookshelf: { type: 'bookshelf', name: '书架', width: 1.2, height: 2.0, depth: 0.35, color: 0x8B7355 },
  bed: { type: 'bed', name: '床', width: 2.0, height: 0.5, depth: 2.2, color: 0xD4B896 }
};

const ROOM_BOUNDS = {
  minX: -4.5,
  maxX: 4.5,
  minZ: -4.5,
  maxZ: 4.5
};

const CONTACT_EPSILON = 1e-4;

const geometryCache = new Map<string, THREE.BoxGeometry>();
const materialCache = new Map<number, THREE.MeshStandardMaterial>();
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.3 });

function getGeometry(data: FurnitureData): THREE.BoxGeometry {
  const key = `${data.type}-${data.width}-${data.height}-${data.depth}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, new THREE.BoxGeometry(data.width, data.height, data.depth));
  }
  return geometryCache.get(key)!;
}

function getMaterial(color: number): THREE.MeshStandardMaterial {
  if (!materialCache.has(color)) {
    materialCache.set(color, new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.1
    }));
  }
  return materialCache.get(color)!;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class FurnitureManager {
  private scene: THREE.Scene;
  private items: FurnitureItem[] = [];
  private selectedItem: FurnitureItem | null = null;
  private dragItem: FurnitureItem | null = null;
  private dragOffset: THREE.Vector2 = new THREE.Vector2();
  private raycaster: THREE.Raycaster;
  private onSelectChange: ((item: FurnitureItem | null) => void) | null = null;
  private dragLight: THREE.PointLight | null = null;
  private groundProjection: THREE.Mesh | null = null;
  private dragPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(scene: THREE.Scene, raycaster: THREE.Raycaster) {
    this.scene = scene;
    this.raycaster = raycaster;
  }

  setOnSelectChange(callback: (item: FurnitureItem | null) => void): void {
    this.onSelectChange = callback;
  }

  createFurniture(type: string): FurnitureItem | null {
    const data = FURNITURE_TYPES[type];
    if (!data) return null;

    const group = new THREE.Group();
    
    const geometry = getGeometry(data);
    const material = getMaterial(data.color);
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.isFurniture = true;
    
    const edges = new THREE.EdgesGeometry(geometry);
    const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    edgeLines.renderOrder = 1;
    
    group.add(mesh);
    group.add(edgeLines);
    
    const posX = (Math.random() - 0.5) * 2;
    const posZ = (Math.random() - 0.5) * 2;
    const spawnPosition = this.findValidSpawnPosition(data);
    group.position.set(
      spawnPosition?.x ?? posX,
      data.height / 2,
      spawnPosition?.z ?? posZ
    );
    
    this.scene.add(group);
    
    const item: FurnitureItem = {
      id: generateId(),
      type,
      group,
      data,
      originalPosition: group.position.clone(),
      isDragging: false,
      isColliding: false,
      isSelected: false,
      targetRotation: 0,
      currentRotation: 0,
      isAnimatingRotation: false,
      rotationAnimationTime: 0,
      rotationStartRotation: 0,
      rotationIsReverting: false,
      isBouncing: false,
      bounceStartPosition: new THREE.Vector3(),
      bounceEndPosition: new THREE.Vector3(),
      bounceAnimationTime: 0
    };
    
    mesh.userData.furnitureItem = item;
    edgeLines.userData.furnitureItem = item;

    this.items.push(item);
    this.refreshCollisionStates();
    this.selectItem(item);
    
    return item;
  }

  selectItem(item: FurnitureItem | null): void {
    if (this.selectedItem && this.selectedItem !== item) {
      this.selectedItem.isSelected = false;
      this.updateItemVisual(this.selectedItem);
    }
    
    this.selectedItem = item;
    
    if (item) {
      item.isSelected = true;
      this.updateItemVisual(item);
    }
    
    if (this.onSelectChange) {
      this.onSelectChange(item);
    }
  }

  getSelectedItem(): FurnitureItem | null {
    return this.selectedItem;
  }

  getItems(): FurnitureItem[] {
    return this.items;
  }

  private findValidSpawnPosition(data: FurnitureData): THREE.Vector3 | null {
    const halfWidth = data.width / 2;
    const halfDepth = data.depth / 2;
    const minX = ROOM_BOUNDS.minX + halfWidth;
    const maxX = ROOM_BOUNDS.maxX - halfWidth;
    const minZ = ROOM_BOUNDS.minZ + halfDepth;
    const maxZ = ROOM_BOUNDS.maxZ - halfDepth;
    const position = new THREE.Vector3();

    for (let attempt = 0; attempt < 40; attempt += 1) {
      position.set(
        THREE.MathUtils.lerp(minX, maxX, Math.random()),
        data.height / 2,
        THREE.MathUtils.lerp(minZ, maxZ, Math.random())
      );

      const hasCollision = this.items.some((other) => this.checkOBBCollision(
        position,
        0,
        data.width,
        data.depth,
        other.group.position,
        other.currentRotation,
        other.data.width,
        other.data.depth
      ));

      if (!hasCollision) return position.clone();
    }

    return null;
  }

  private updateItemVisual(item: FurnitureItem): void {
    const mesh = item.group.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    
    if (item.isColliding) {
      material.color.setHex(0xFF4D4D);
      material.emissive.setHex(0xFF2A2A);
      material.emissiveIntensity = 0.35;
    } else if (item.isSelected) {
      material.color.setHex(item.data.color);
      material.emissive.setHex(0xD4A574);
      material.emissiveIntensity = 0.15;
    } else {
      material.color.setHex(item.data.color);
      material.emissive.setHex(0x000000);
      material.emissiveIntensity = 0;
    }
  }

  startDrag(item: FurnitureItem, mouse: THREE.Vector2, camera: THREE.Camera): void {
    this.raycaster.setFromCamera(mouse, camera);
    const point = new THREE.Vector3();

    if (this.raycaster.ray.intersectPlane(this.dragPlane, point)) {
      this.dragItem = item;
      item.isDragging = true;
      item.isBouncing = false;
      if (!item.originalPosition.equals(item.group.position)) {
        item.group.position.copy(item.originalPosition);
      }
      this.dragOffset.set(
        item.group.position.x - point.x,
        item.group.position.z - point.z
      );

      this.createDragLight(item.group.position);
      this.createGroundProjection(item);
      this.refreshCollisionStates();
    }
  }

  private createDragLight(position: THREE.Vector3): void {
    if (this.dragLight) {
      this.scene.remove(this.dragLight);
    }
    this.dragLight = new THREE.PointLight(0xFFF8E7, 1, 5);
    this.dragLight.position.copy(position);
    this.dragLight.position.y = 2;
    this.scene.add(this.dragLight);
  }

  private createGroundProjection(item: FurnitureItem): void {
    if (this.groundProjection) {
      this.scene.remove(this.groundProjection);
    }
    
    const geometry = new THREE.PlaneGeometry(item.data.width * 1.05, item.data.depth * 1.05);
    const material = new THREE.MeshBasicMaterial({
      color: 0xD4A574,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide
    });
    
    this.groundProjection = new THREE.Mesh(geometry, material);
    this.groundProjection.rotation.x = -Math.PI / 2;
    this.groundProjection.rotation.y = item.currentRotation;
    this.groundProjection.position.set(
      item.group.position.x,
      0.01,
      item.group.position.z
    );
    this.scene.add(this.groundProjection);
  }

  updateDrag(mouse: THREE.Vector2, camera: THREE.Camera): void {
    if (!this.dragItem) return;
    
    this.raycaster.setFromCamera(mouse, camera);
    const point = new THREE.Vector3();

    if (!this.raycaster.ray.intersectPlane(this.dragPlane, point)) return;

    const newX = point.x + this.dragOffset.x;
    const newZ = point.z + this.dragOffset.y;

    this.dragItem.group.position.x = newX;
    this.dragItem.group.position.z = newZ;

    if (this.dragLight) {
      this.dragLight.position.x = newX;
      this.dragLight.position.z = newZ;
    }

    if (this.groundProjection) {
      this.groundProjection.position.x = newX;
      this.groundProjection.position.z = newZ;
      this.groundProjection.rotation.x = -Math.PI / 2;
      this.groundProjection.rotation.y = this.dragItem.currentRotation;
    }

    this.refreshCollisionStates();
  }

  endDrag(): void {
    if (this.dragItem) {
      const item = this.dragItem;
      if (item.isColliding) {
        this.startBounce(item);
      } else {
        item.originalPosition.copy(item.group.position);
      }
      
      item.isDragging = false;
      this.dragItem = null;
      this.refreshCollisionStates();
    }
    
    this.removeDragHelpers();
  }

  private removeDragHelpers(): void {
    if (this.dragLight) {
      this.scene.remove(this.dragLight);
      this.dragLight = null;
    }

    if (this.groundProjection) {
      this.scene.remove(this.groundProjection);
      this.groundProjection.geometry.dispose();
      (this.groundProjection.material as THREE.Material).dispose();
      this.groundProjection = null;
    }
  }

  private updateGroundProjection(): void {
    if (!this.groundProjection || !this.dragItem) return;

    const material = this.groundProjection.material as THREE.MeshBasicMaterial;
    material.color.setHex(this.dragItem.isColliding ? 0xFF3B30 : 0xD4A574);
    material.opacity = this.dragItem.isColliding ? 0.38 : 0.25;
  }

  private startBounce(item: FurnitureItem): void {
    item.isBouncing = true;
    item.bounceStartPosition.copy(item.group.position);
    item.bounceEndPosition.copy(item.originalPosition);
    item.bounceAnimationTime = 0;
  }

  rotateSelected(): void {
    if (!this.selectedItem
      || this.selectedItem.isDragging
      || this.selectedItem.isAnimatingRotation
      || this.selectedItem.isBouncing) return;

    const item = this.selectedItem;
    item.rotationStartRotation = item.currentRotation;
    item.targetRotation += Math.PI / 4;
    item.isAnimatingRotation = true;
    item.rotationAnimationTime = 0;
    item.rotationIsReverting = false;
  }

  deleteSelected(): void {
    if (!this.selectedItem) return;
    
    this.deleteItem(this.selectedItem);
  }

  private deleteItem(item: FurnitureItem): void {
    const index = this.items.indexOf(item);
    if (index > -1) {
      this.items.splice(index, 1);
      if (this.dragItem === item) {
        item.isDragging = false;
        this.dragItem = null;
        this.removeDragHelpers();
      }
      this.scene.remove(item.group);
      
      const mesh = item.group.children[0] as THREE.Mesh;
      (mesh.material as THREE.Material).dispose();
      
      if (this.selectedItem === item) {
        this.selectItem(null);
      }
      this.refreshCollisionStates();
    }
  }

  private refreshCollisionStates(): void {
    const nextCollisions = new Set<string>();

    for (const item of this.items) {
      if (this.isOutsideRoom(item, item.group.position, item.currentRotation)) {
        nextCollisions.add(item.id);
      }
    }

    for (let i = 0; i < this.items.length; i += 1) {
      for (let j = i + 1; j < this.items.length; j += 1) {
        const a = this.items[i];
        const b = this.items[j];

        if (this.checkOBBCollision(
          a.group.position,
          a.currentRotation,
          a.data.width,
          a.data.depth,
          b.group.position,
          b.currentRotation,
          b.data.width,
          b.data.depth
        )) {
          nextCollisions.add(a.id);
          nextCollisions.add(b.id);
        }
      }
    }

    for (const item of this.items) {
      const isColliding = nextCollisions.has(item.id);
      if (isColliding !== item.isColliding) {
        item.isColliding = isColliding;
        this.updateItemVisual(item);
      }
    }

    this.updateGroundProjection();
  }

  private hasCollisionAt(
    item: FurnitureItem,
    position: THREE.Vector3,
    rotation: number
  ): boolean {
    if (this.isOutsideRoom(item, position, rotation)) return true;

    for (const other of this.items) {
      if (other.id === item.id) continue;

      if (this.checkOBBCollision(
        position,
        rotation,
        item.data.width,
        item.data.depth,
        other.group.position,
        other.currentRotation,
        other.data.width,
        other.data.depth
      )) {
        return true;
      }
    }

    return false;
  }

  private isOutsideRoom(
    item: FurnitureItem,
    position: THREE.Vector3,
    rotation: number
  ): boolean {
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    const halfX = item.data.width / 2 * cos + item.data.depth / 2 * sin;
    const halfZ = item.data.width / 2 * sin + item.data.depth / 2 * cos;

    return position.x - halfX < ROOM_BOUNDS.minX - CONTACT_EPSILON
      || position.x + halfX > ROOM_BOUNDS.maxX + CONTACT_EPSILON
      || position.z - halfZ < ROOM_BOUNDS.minZ - CONTACT_EPSILON
      || position.z + halfZ > ROOM_BOUNDS.maxZ + CONTACT_EPSILON;
  }

  private checkOBBCollision(
    centerA: THREE.Vector3,
    rotationA: number,
    widthA: number,
    depthA: number,
    centerB: THREE.Vector3,
    rotationB: number,
    widthB: number,
    depthB: number
  ): boolean {
    const deltaX = centerB.x - centerA.x;
    const deltaZ = centerB.z - centerA.z;
    const cosA = Math.cos(rotationA);
    const sinA = Math.sin(rotationA);
    const cosB = Math.cos(rotationB);
    const sinB = Math.sin(rotationB);
    const halfWidthA = widthA / 2;
    const halfDepthA = depthA / 2;
    const halfWidthB = widthB / 2;
    const halfDepthB = depthB / 2;

    const axes: Array<[number, number]> = [
      [cosA, -sinA],
      [sinA, cosA],
      [cosB, -sinB],
      [sinB, cosB]
    ];

    for (const [axisX, axisZ] of axes) {
      const extentA = halfWidthA * Math.abs(axisX * cosA - axisZ * sinA)
        + halfDepthA * Math.abs(axisX * sinA + axisZ * cosA);
      const extentB = halfWidthB * Math.abs(axisX * cosB - axisZ * sinB)
        + halfDepthB * Math.abs(axisX * sinB + axisZ * cosB);
      const overlap = Math.abs(deltaX * axisX + deltaZ * axisZ) - extentA - extentB;

      if (overlap > CONTACT_EPSILON) return false;
    }

    return true;
  }

  animate(delta: number): void {
    let transformChanged = false;

    for (const item of this.items) {
      if (item.isAnimatingRotation) {
        item.rotationAnimationTime += delta;
        const duration = 0.18;
        const invalidHoldDuration = 0.18;

        if (!item.rotationIsReverting) {
          const t = Math.min(item.rotationAnimationTime / duration, 1);
          const eased = easeOutCubic(t);
          item.currentRotation = item.rotationStartRotation
            + (item.targetRotation - item.rotationStartRotation) * eased;

          if (t >= 1) {
            item.currentRotation = item.targetRotation;

            if (this.hasCollisionAt(item, item.group.position, item.currentRotation)) {
              item.rotationIsReverting = true;
              item.rotationAnimationTime = 0;
            } else {
              item.isAnimatingRotation = false;
            }
          }
        } else {
          if (item.rotationAnimationTime >= invalidHoldDuration) {
            const revertTime = item.rotationAnimationTime - invalidHoldDuration;
            const t = Math.min(revertTime / duration, 1);
            const eased = easeOutCubic(t);
            item.currentRotation = item.targetRotation
              + (item.rotationStartRotation - item.targetRotation) * eased;

            if (t >= 1) {
              item.currentRotation = item.rotationStartRotation;
              item.targetRotation = item.rotationStartRotation;
              item.isAnimatingRotation = false;
              item.rotationIsReverting = false;
            }
          }
        }

        item.group.rotation.y = item.currentRotation;
        transformChanged = true;
      }
      
      if (item.isBouncing) {
        item.bounceAnimationTime += delta;
        const duration = 0.3;
        const t = Math.min(item.bounceAnimationTime / duration, 1);
        const eased = easeOutCubic(t);
        
        item.group.position.lerpVectors(
          item.bounceStartPosition,
          item.bounceEndPosition,
          eased
        );
        
        if (t >= 1) {
          item.isBouncing = false;
          item.group.position.copy(item.originalPosition);
        }
        transformChanged = true;
      }
      
    }

    if (transformChanged) this.refreshCollisionStates();

    for (const item of this.items) {
      if (item.isColliding) this.updateItemVisual(item);
    }
  }

  isDraggingActive(): boolean {
    return this.dragItem !== null;
  }

  getDragItem(): FurnitureItem | null {
    return this.dragItem;
  }

  dispose(): void {
    this.dragItem = null;
    this.removeDragHelpers();

    for (const item of this.items) {
      this.scene.remove(item.group);
      const mesh = item.group.children[0] as THREE.Mesh;
      (mesh.material as THREE.Material).dispose();
    }
    this.items = [];
    
    geometryCache.forEach((geo) => geo.dispose());
    geometryCache.clear();
    
    materialCache.forEach((mat) => mat.dispose());
    materialCache.clear();
    
    edgeMaterial.dispose();
  }
}
