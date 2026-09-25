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
  rotationStartAngle: number;
  isRevertingRotation: boolean;
  revertFromRotation: number;
  revertToRotation: number;
  revertAnimationTime: number;
  isBouncing: boolean;
  bounceStartPosition: THREE.Vector3;
  bounceEndPosition: THREE.Vector3;
  bounceAnimationTime: number;
  blinkTime: number;
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

function easeOutElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

export class FurnitureManager {
  private scene: THREE.Scene;
  private items: FurnitureItem[] = [];
  private selectedItem: FurnitureItem | null = null;
  private dragItem: FurnitureItem | null = null;
  private dragOffset: THREE.Vector2 = new THREE.Vector2();
  private groundPlane: THREE.Mesh;
  private raycaster: THREE.Raycaster;
  private onSelectChange: ((item: FurnitureItem | null) => void) | null = null;
  private dragLight: THREE.PointLight | null = null;
  private groundProjection: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, groundPlane: THREE.Mesh, raycaster: THREE.Raycaster) {
    this.scene = scene;
    this.groundPlane = groundPlane;
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
    group.position.set(posX, data.height / 2, posZ);
    
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
      rotationStartAngle: 0,
      isRevertingRotation: false,
      revertFromRotation: 0,
      revertToRotation: 0,
      revertAnimationTime: 0,
      isBouncing: false,
      bounceStartPosition: new THREE.Vector3(),
      bounceEndPosition: new THREE.Vector3(),
      bounceAnimationTime: 0,
      blinkTime: 0
    };
    
    mesh.userData.furnitureItem = item;
    edgeLines.userData.furnitureItem = item;
    
    this.items.push(item);
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

  private updateItemVisual(item: FurnitureItem): void {
    const mesh = item.group.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    
    if (item.isColliding) {
      const blinkOn = Math.floor(item.blinkTime / 0.1) % 2 === 0;
      material.color.setHex(blinkOn ? 0xFF6B6B : item.data.color);
      material.emissive.setHex(blinkOn ? 0xFF2222 : 0x000000);
      material.emissiveIntensity = blinkOn ? 0.4 : 0;
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
    const intersects = this.raycaster.intersectObject(this.groundPlane);
    
    if (intersects.length > 0) {
      const point = intersects[0].point;
      this.dragItem = item;
      item.isDragging = true;
      item.isBouncing = false;
      item.originalPosition.copy(item.group.position);
      this.dragOffset.set(
        item.group.position.x - point.x,
        item.group.position.z - point.z
      );
      
      this.createDragLight(point);
      this.createGroundProjection(item);
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
    this.groundProjection.position.set(
      item.group.position.x,
      0.01,
      item.group.position.z
    );
    this.groundProjection.rotation.y = item.currentRotation;
    this.scene.add(this.groundProjection);
  }

  updateDrag(mouse: THREE.Vector2, camera: THREE.Camera): void {
    if (!this.dragItem) return;
    
    this.raycaster.setFromCamera(mouse, camera);
    const intersects = this.raycaster.intersectObject(this.groundPlane);
    
    if (intersects.length > 0) {
      const point = intersects[0].point;
      
      let newX = point.x + this.dragOffset.x;
      let newZ = point.z + this.dragOffset.y;
      
      const halfW = this.dragItem.data.width / 2;
      const halfD = this.dragItem.data.depth / 2;
      
      const cos = Math.abs(Math.cos(this.dragItem.currentRotation));
      const sin = Math.abs(Math.sin(this.dragItem.currentRotation));
      const boundX = halfW * cos + halfD * sin;
      const boundZ = halfW * sin + halfD * cos;
      
      newX = Math.max(ROOM_BOUNDS.minX + boundX, Math.min(ROOM_BOUNDS.maxX - boundX, newX));
      newZ = Math.max(ROOM_BOUNDS.minZ + boundZ, Math.min(ROOM_BOUNDS.maxZ - boundZ, newZ));
      
      this.dragItem.group.position.x = newX;
      this.dragItem.group.position.z = newZ;
      
      if (this.dragLight) {
        this.dragLight.position.x = newX;
        this.dragLight.position.z = newZ;
      }
      
      if (this.groundProjection) {
        this.groundProjection.position.x = newX;
        this.groundProjection.position.z = newZ;
        this.groundProjection.rotation.y = this.dragItem.currentRotation;
      }
      
      this.updateAllCollisions();
      this.updateGroundProjectionStyle();
    }
  }

  private updateGroundProjectionStyle(): void {
    if (!this.groundProjection || !this.dragItem) return;
    const material = this.groundProjection.material as THREE.MeshBasicMaterial;
    if (this.dragItem.isColliding) {
      material.color.setHex(0xFF6B6B);
      material.opacity = 0.45;
    } else {
      material.color.setHex(0xD4A574);
      material.opacity = 0.25;
    }
  }

  endDrag(): void {
    if (this.dragItem) {
      const item = this.dragItem;
      item.isDragging = false;
      
      this.updateAllCollisions();
      
      if (item.isColliding) {
        this.startBounce(item);
      } else {
        item.originalPosition.copy(item.group.position);
      }
      
      this.dragItem = null;
    }
    
    this.cleanupDragHelpers();
  }

  private cleanupDragHelpers(): void {
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

  private startBounce(item: FurnitureItem): void {
    item.isBouncing = true;
    item.bounceStartPosition.copy(item.group.position);
    item.bounceEndPosition.copy(item.originalPosition);
    item.bounceAnimationTime = 0;
  }

  rotateSelected(): void {
    if (!this.selectedItem) return;
    const item = this.selectedItem;
    if (item.isAnimatingRotation || item.isRevertingRotation || item.isBouncing || item.isDragging) return;
    
    item.rotationStartAngle = item.targetRotation;
    item.targetRotation += Math.PI / 4;
    item.isAnimatingRotation = true;
    item.rotationAnimationTime = 0;
  }

  deleteSelected(): void {
    if (!this.selectedItem) return;
    
    this.deleteItem(this.selectedItem);
  }

  private deleteItem(item: FurnitureItem): void {
    if (this.dragItem === item) {
      this.dragItem = null;
      this.cleanupDragHelpers();
    }
    
    const index = this.items.indexOf(item);
    if (index > -1) {
      this.items.splice(index, 1);
      this.scene.remove(item.group);
      
      const mesh = item.group.children[0] as THREE.Mesh;
      (mesh.material as THREE.Material).dispose();
      
      if (this.selectedItem === item) {
        this.selectItem(null);
      }
      
      this.updateAllCollisions();
    }
  }

  private updateAllCollisions(): void {
    const collidingIds = new Set<string>();
    
    for (let i = 0; i < this.items.length; i++) {
      for (let j = i + 1; j < this.items.length; j++) {
        if (this.checkOBBCollision(this.items[i], this.items[j])) {
          collidingIds.add(this.items[i].id);
          collidingIds.add(this.items[j].id);
        }
      }
    }
    
    for (const item of this.items) {
      const colliding = collidingIds.has(item.id);
      if (colliding !== item.isColliding) {
        item.isColliding = colliding;
        if (colliding) {
          item.blinkTime = 0;
        }
        this.updateItemVisual(item);
      }
    }
  }

  private checkOBBCollision(a: FurnitureItem, b: FurnitureItem): boolean {
    const aCenter = a.group.position;
    const bCenter = b.group.position;
    
    const dx = bCenter.x - aCenter.x;
    const dz = bCenter.z - aCenter.z;
    
    const cosA = Math.cos(a.currentRotation);
    const sinA = Math.sin(a.currentRotation);
    const cosB = Math.cos(b.currentRotation);
    const sinB = Math.sin(b.currentRotation);
    
    const aHalfW = a.data.width / 2;
    const aHalfD = a.data.depth / 2;
    const bHalfW = b.data.width / 2;
    const bHalfD = b.data.depth / 2;
    
    const axes: Array<[number, number]> = [
      [cosA, sinA],
      [-sinA, cosA],
      [cosB, sinB],
      [-sinB, cosB]
    ];
    
    for (const [ax, az] of axes) {
      const aExtent = aHalfW * Math.abs(ax * cosA + az * sinA) + aHalfD * Math.abs(-ax * sinA + az * cosA);
      const bExtent = bHalfW * Math.abs(ax * cosB + az * sinB) + bHalfD * Math.abs(-ax * sinB + az * cosB);
      const distance = Math.abs(dx * ax + dz * az);
      
      if (distance > aExtent + bExtent) {
        return false;
      }
    }
    
    return true;
  }

  animate(delta: number): void {
    let collisionUpdateNeeded = false;
    
    for (const item of this.items) {
      if (item.isAnimatingRotation) {
        item.rotationAnimationTime += delta;
        const duration = 0.2;
        const t = Math.min(item.rotationAnimationTime / duration, 1);
        const eased = easeOutCubic(t);
        
        item.currentRotation = item.rotationStartAngle + (item.targetRotation - item.rotationStartAngle) * eased;
        item.group.rotation.y = item.currentRotation;
        collisionUpdateNeeded = true;
        
        if (t >= 1) {
          item.isAnimatingRotation = false;
          item.currentRotation = item.targetRotation;
          item.group.rotation.y = item.currentRotation;
          
          this.updateAllCollisions();
          if (item.isColliding) {
            item.isRevertingRotation = true;
            item.revertFromRotation = item.currentRotation;
            item.revertToRotation = item.rotationStartAngle;
            item.revertAnimationTime = 0;
          }
        }
      }
      
      if (item.isRevertingRotation) {
        item.revertAnimationTime += delta;
        const duration = 0.25;
        const t = Math.min(item.revertAnimationTime / duration, 1);
        const eased = easeOutCubic(t);
        
        item.currentRotation = item.revertFromRotation + (item.revertToRotation - item.revertFromRotation) * eased;
        item.group.rotation.y = item.currentRotation;
        collisionUpdateNeeded = true;
        
        if (t >= 1) {
          item.isRevertingRotation = false;
          item.currentRotation = item.revertToRotation;
          item.targetRotation = item.revertToRotation;
          item.group.rotation.y = item.currentRotation;
        }
      }
      
      if (item.isBouncing) {
        item.bounceAnimationTime += delta;
        const duration = 0.3;
        const t = Math.min(item.bounceAnimationTime / duration, 1);
        const eased = easeOutElastic(t);
        
        item.group.position.lerpVectors(
          item.bounceStartPosition,
          item.bounceEndPosition,
          eased
        );
        collisionUpdateNeeded = true;
        
        if (t >= 1) {
          item.isBouncing = false;
          item.group.position.copy(item.originalPosition);
        }
      }
      
      if (item.isColliding) {
        item.blinkTime += delta;
        this.updateItemVisual(item);
      }
    }
    
    if (collisionUpdateNeeded) {
      this.updateAllCollisions();
    }
  }

  isDraggingActive(): boolean {
    return this.dragItem !== null;
  }

  getDragItem(): FurnitureItem | null {
    return this.dragItem;
  }

  dispose(): void {
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
