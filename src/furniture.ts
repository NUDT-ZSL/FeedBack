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
  groupId: string | null;
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
  isBouncing: boolean;
  bounceStartPosition: THREE.Vector3;
  bounceEndPosition: THREE.Vector3;
  bounceAnimationTime: number;
  blinkTime: number;
}

export interface FurnitureGroup {
  id: string;
  name: string;
  memberIds: Set<string>;
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
  private selectedItems: FurnitureItem[] = [];
  private groups: Map<string, FurnitureGroup> = new Map();
  private groupLines: Map<string, THREE.LineSegments> = new Map();
  private groupNameCounter = 0;
  private dragItem: FurnitureItem | null = null;
  private dragGroupMembers: Array<{ item: FurnitureItem; offsetX: number; offsetZ: number }> | null = null;
  private dragAnchor: THREE.Vector2 = new THREE.Vector2();
  private dragOffset: THREE.Vector2 = new THREE.Vector2();
  private groundPlane: THREE.Mesh;
  private raycaster: THREE.Raycaster;
  private onSelectChange: ((items: FurnitureItem[]) => void) | null = null;
  private dragLight: THREE.PointLight | null = null;
  private groundProjection: THREE.Mesh | null = null;
  private groupRotationAnim: {
    anchorX: number;
    anchorZ: number;
    angle: number;
    time: number;
    members: Array<{ item: FurnitureItem; offsetX: number; offsetZ: number; startRot: number }>;
  } | null = null;
  private flashItems: FurnitureItem[] = [];
  private flashTime = 0;

  constructor(scene: THREE.Scene, groundPlane: THREE.Mesh, raycaster: THREE.Raycaster) {
    this.scene = scene;
    this.groundPlane = groundPlane;
    this.raycaster = raycaster;
  }

  setOnSelectChange(callback: (items: FurnitureItem[]) => void): void {
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
      groupId: null,
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

  selectItem(item: FurnitureItem | null, additive: boolean = false): void {
    if (additive && item) {
      const next = this.selectedItems.slice();
      const index = next.indexOf(item);
      if (index > -1) {
        next.splice(index, 1);
      } else {
        next.push(item);
      }
      this.setSelection(next);
      return;
    }

    if (item && item.groupId && this.groups.has(item.groupId)) {
      this.setSelection(this.items.filter((i) => i.groupId === item.groupId));
      return;
    }

    this.setSelection(item ? [item] : []);
  }

  private setSelection(items: FurnitureItem[]): void {
    for (const prev of this.selectedItems) {
      if (!items.includes(prev)) {
        prev.isSelected = false;
        this.updateItemVisual(prev);
      }
    }

    this.selectedItems = items.slice();

    for (const item of this.selectedItems) {
      if (!item.isSelected) {
        item.isSelected = true;
        this.updateItemVisual(item);
      }
    }

    if (this.onSelectChange) {
      this.onSelectChange(this.selectedItems);
    }
  }

  getSelectedItems(): FurnitureItem[] {
    return this.selectedItems;
  }

  getSelectedGroup(): FurnitureGroup | null {
    if (this.selectedItems.length < 2) return null;

    const groupId = this.selectedItems[0].groupId;
    if (!groupId) return null;

    const group = this.groups.get(groupId);
    if (!group || group.memberIds.size !== this.selectedItems.length) return null;

    for (const item of this.selectedItems) {
      if (item.groupId !== groupId) return null;
    }

    return group;
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
    } else if (item.isSelected) {
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
      item.originalPosition.copy(item.group.position);

      const group = item.groupId ? this.groups.get(item.groupId) : undefined;
      if (group) {
        const members = this.items.filter((i) => i.groupId === group.id);
        let anchorX = 0;
        let anchorZ = 0;
        for (const member of members) {
          anchorX += member.group.position.x;
          anchorZ += member.group.position.z;
        }
        anchorX /= members.length;
        anchorZ /= members.length;

        this.dragAnchor.set(anchorX, anchorZ);
        this.dragGroupMembers = members.map((member) => ({
          item: member,
          offsetX: member.group.position.x - anchorX,
          offsetZ: member.group.position.z - anchorZ
        }));
        for (const member of members) {
          member.isDragging = true;
          member.originalPosition.copy(member.group.position);
        }
        this.dragOffset.set(anchorX - point.x, anchorZ - point.z);
      } else {
        this.dragGroupMembers = null;
        this.dragOffset.set(
          item.group.position.x - point.x,
          item.group.position.z - point.z
        );
        this.createGroundProjection(item);
      }

      this.createDragLight(point);
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
    
    if (intersects.length === 0) return;
    const point = intersects[0].point;

    if (this.dragGroupMembers) {
      this.updateGroupDrag(point);
      return;
    }

    {
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
      
      this.checkCollisions(this.dragItem);
    }
  }

  private updateGroupDrag(point: THREE.Vector3): void {
    if (!this.dragGroupMembers) return;

    const desiredX = point.x + this.dragOffset.x;
    const desiredZ = point.z + this.dragOffset.y;

    const memberIds = new Set(this.dragGroupMembers.map((m) => m.item.id));

    const dx = desiredX - this.dragAnchor.x;
    if (dx !== 0) {
      const t = this.maxValidStep(dx, 0, memberIds);
      this.dragAnchor.x += dx * t;
      for (const m of this.dragGroupMembers) {
        m.item.group.position.x = this.dragAnchor.x + m.offsetX;
      }
    }

    const dz = desiredZ - this.dragAnchor.y;
    if (dz !== 0) {
      const t = this.maxValidStep(0, dz, memberIds);
      this.dragAnchor.y += dz * t;
      for (const m of this.dragGroupMembers) {
        m.item.group.position.z = this.dragAnchor.y + m.offsetZ;
      }
    }

    for (const m of this.dragGroupMembers) {
      const blocked = !this.isPlacementValid(
        m.item,
        desiredX + m.offsetX,
        desiredZ + m.offsetZ,
        m.item.currentRotation,
        memberIds
      );
      if (blocked !== m.item.isColliding) {
        m.item.isColliding = blocked;
        m.item.blinkTime = 0;
        this.updateItemVisual(m.item);
      }
    }

    if (this.dragLight) {
      this.dragLight.position.x = this.dragAnchor.x;
      this.dragLight.position.z = this.dragAnchor.y;
    }
  }

  private maxValidStep(dx: number, dz: number, memberIds: Set<string>): number {
    const distance = Math.hypot(dx, dz);
    if (distance === 0) return 1;

    const stepSize = 0.05;
    const steps = Math.ceil(distance / stepSize);
    let valid = 0;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.canMoveGroup(dx * t, dz * t, memberIds)) {
        valid = t;
      } else {
        break;
      }
    }

    return valid;
  }

  endDrag(): void {
    if (this.dragGroupMembers) {
      for (const m of this.dragGroupMembers) {
        m.item.isDragging = false;
        m.item.isColliding = false;
        m.item.blinkTime = 0;
        m.item.originalPosition.copy(m.item.group.position);
        this.updateItemVisual(m.item);
      }
      this.dragGroupMembers = null;
      this.dragItem = null;
    } else
    if (this.dragItem) {
      if (this.dragItem.isColliding) {
        this.startBounce(this.dragItem);
      } else {
        this.dragItem.originalPosition.copy(this.dragItem.group.position);
      }
      
      this.dragItem.isDragging = false;
      this.dragItem.isColliding = false;
      this.dragItem.blinkTime = 0;
      this.updateItemVisual(this.dragItem);
      this.dragItem = null;
    }
    
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
    const group = this.getSelectedGroup();
    if (group) {
      this.rotateGroup(group);
      return;
    }

    for (const item of this.selectedItems) {
      if (item.isAnimatingRotation || item.isBouncing) continue;
      item.targetRotation += Math.PI / 4;
      item.isAnimatingRotation = true;
      item.rotationAnimationTime = 0;
    }
  }

  private rotateGroup(group: FurnitureGroup): void {
    if (this.groupRotationAnim) return;

    const members = this.items.filter((i) => i.groupId === group.id);
    if (members.length < 2) return;
    if (members.some((m) => m.isAnimatingRotation || m.isBouncing || m.isDragging)) return;

    let anchorX = 0;
    let anchorZ = 0;
    for (const member of members) {
      anchorX += member.group.position.x;
      anchorZ += member.group.position.z;
    }
    anchorX /= members.length;
    anchorZ /= members.length;

    const angle = Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const memberIds = new Set(members.map((m) => m.id));

    const targets = members.map((member) => {
      const offsetX = member.group.position.x - anchorX;
      const offsetZ = member.group.position.z - anchorZ;
      return {
        item: member,
        offsetX,
        offsetZ,
        startRot: member.currentRotation,
        targetX: anchorX + offsetX * cos - offsetZ * sin,
        targetZ: anchorZ + offsetX * sin + offsetZ * cos,
        targetRot: member.currentRotation + angle
      };
    });

    for (const t of targets) {
      if (!this.isPlacementValid(t.item, t.targetX, t.targetZ, t.targetRot, memberIds)) {
        this.flashInvalid(members);
        return;
      }
    }

    for (const t of targets) {
      t.item.targetRotation = t.targetRot;
    }

    this.groupRotationAnim = {
      anchorX,
      anchorZ,
      angle,
      time: 0,
      members: targets.map((t) => ({
        item: t.item,
        offsetX: t.offsetX,
        offsetZ: t.offsetZ,
        startRot: t.startRot
      }))
    };
  }

  private flashInvalid(items: FurnitureItem[]): void {
    for (const item of this.flashItems) {
      item.isColliding = false;
      this.updateItemVisual(item);
    }
    this.flashItems = items.slice();
    this.flashTime = 0.6;
    for (const item of items) {
      item.isColliding = true;
      item.blinkTime = 0;
      this.updateItemVisual(item);
    }
  }

  deleteSelected(): void {
    const toDelete = this.selectedItems.slice();
    for (const item of toDelete) {
      this.deleteItem(item);
    }
    this.setSelection([]);
  }

  private deleteItem(item: FurnitureItem): void {
    const index = this.items.indexOf(item);
    if (index === -1) return;

    this.items.splice(index, 1);
    this.scene.remove(item.group);

    const mesh = item.group.children[0] as THREE.Mesh;
    (mesh.material as THREE.Material).dispose();

    this.removeFromGroup(item);

    const selIndex = this.selectedItems.indexOf(item);
    if (selIndex > -1) this.selectedItems.splice(selIndex, 1);

    if (this.dragItem === item) this.dragItem = null;
    if (this.dragGroupMembers) {
      this.dragGroupMembers = this.dragGroupMembers.filter((m) => m.item !== item);
      if (this.dragGroupMembers.length === 0) this.dragGroupMembers = null;
    }
    if (this.groupRotationAnim && this.groupRotationAnim.members.some((m) => m.item === item)) {
      this.groupRotationAnim = null;
    }
    const flashIndex = this.flashItems.indexOf(item);
    if (flashIndex > -1) this.flashItems.splice(flashIndex, 1);
  }

  groupSelected(): void {
    if (this.selectedItems.length < 2) return;

    const members = this.selectedItems.slice();
    for (const member of members) {
      this.removeFromGroup(member);
    }

    this.groupNameCounter += 1;
    const group: FurnitureGroup = {
      id: generateId(),
      name: `组合 ${this.groupNameCounter}`,
      memberIds: new Set()
    };

    for (const member of members) {
      member.groupId = group.id;
      group.memberIds.add(member.id);
    }

    this.groups.set(group.id, group);
    this.createGroupLines(group);
    this.setSelection(members);
  }

  ungroupSelected(): void {
    const groupIds = new Set<string>();
    for (const item of this.selectedItems) {
      if (item.groupId) groupIds.add(item.groupId);
    }
    for (const groupId of groupIds) {
      this.ungroup(groupId);
    }
    this.setSelection(this.selectedItems.slice());
  }

  private ungroup(groupId: string): void {
    if (!this.groups.has(groupId)) return;

    for (const item of this.items) {
      if (item.groupId === groupId) {
        item.groupId = null;
      }
    }

    this.removeGroupLines(groupId);
    this.groups.delete(groupId);
  }

  private removeFromGroup(item: FurnitureItem): void {
    if (!item.groupId) return;

    const groupId = item.groupId;
    const group = this.groups.get(groupId);
    item.groupId = null;

    if (!group) return;

    group.memberIds.delete(item.id);

    if (group.memberIds.size < 2) {
      this.ungroup(groupId);
    } else {
      this.rebuildGroupLines(group);
    }
  }

  private createGroupLines(group: FurnitureGroup): void {
    const positions = new Float32Array(group.memberIds.size * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x6A8EAE,
      transparent: true,
      opacity: 0.7
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    this.scene.add(lines);
    this.groupLines.set(group.id, lines);
    this.updateGroupLines(group.id);
  }

  private rebuildGroupLines(group: FurnitureGroup): void {
    this.removeGroupLines(group.id);
    this.createGroupLines(group);
  }

  private removeGroupLines(groupId: string): void {
    const lines = this.groupLines.get(groupId);
    if (!lines) return;

    this.scene.remove(lines);
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
    this.groupLines.delete(groupId);
  }

  private updateGroupLines(groupId: string): void {
    const lines = this.groupLines.get(groupId);
    const group = this.groups.get(groupId);
    if (!lines || !group) return;

    const members = this.items.filter((i) => i.groupId === groupId);
    if (members.length === 0) return;

    let anchorX = 0;
    let anchorZ = 0;
    for (const member of members) {
      anchorX += member.group.position.x;
      anchorZ += member.group.position.z;
    }
    anchorX /= members.length;
    anchorZ /= members.length;

    const attribute = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let cursor = 0;
    for (const member of members) {
      attribute.setXYZ(cursor, anchorX, 0.03, anchorZ);
      cursor += 1;
      attribute.setXYZ(cursor, member.group.position.x, 0.03, member.group.position.z);
      cursor += 1;
    }
    attribute.needsUpdate = true;
  }

  private checkCollisions(item: FurnitureItem): void {
    let colliding = false;
    
    for (const other of this.items) {
      if (other.id === item.id) continue;
      
      if (this.obbIntersect(
        item.group.position.x, item.group.position.z, item.currentRotation, item.data,
        other.group.position.x, other.group.position.z, other.currentRotation, other.data
      )) {
        colliding = true;
        break;
      }
    }
    
    if (colliding !== item.isColliding) {
      item.isColliding = colliding;
      item.blinkTime = 0;
      this.updateItemVisual(item);
    }
  }

  private obbIntersect(
    ax: number, az: number, aRot: number, aData: FurnitureData,
    bx: number, bz: number, bRot: number, bData: FurnitureData
  ): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    
    const cosA = Math.cos(aRot);
    const sinA = Math.sin(aRot);
    const cosB = Math.cos(bRot);
    const sinB = Math.sin(bRot);
    
    const aHalfW = aData.width / 2;
    const aHalfD = aData.depth / 2;
    const bHalfW = bData.width / 2;
    const bHalfD = bData.depth / 2;
    
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

  private isWithinBounds(x: number, z: number, rotation: number, data: FurnitureData): boolean {
    const halfW = data.width / 2;
    const halfD = data.depth / 2;
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    const boundX = halfW * cos + halfD * sin;
    const boundZ = halfW * sin + halfD * cos;
    const epsilon = 1e-6;

    return (
      x >= ROOM_BOUNDS.minX + boundX - epsilon &&
      x <= ROOM_BOUNDS.maxX - boundX + epsilon &&
      z >= ROOM_BOUNDS.minZ + boundZ - epsilon &&
      z <= ROOM_BOUNDS.maxZ - boundZ + epsilon
    );
  }

  private isPlacementValid(
    item: FurnitureItem,
    x: number,
    z: number,
    rotation: number,
    ignoreIds: Set<string>
  ): boolean {
    if (!this.isWithinBounds(x, z, rotation, item.data)) return false;

    for (const other of this.items) {
      if (other.id === item.id || ignoreIds.has(other.id)) continue;
      if (this.obbIntersect(
        x, z, rotation, item.data,
        other.group.position.x, other.group.position.z, other.currentRotation, other.data
      )) {
        return false;
      }
    }

    return true;
  }

  private canMoveGroup(dx: number, dz: number, memberIds: Set<string>): boolean {
    if (!this.dragGroupMembers) return false;

    for (const m of this.dragGroupMembers) {
      const item = m.item;
      if (!this.isPlacementValid(
        item,
        item.group.position.x + dx,
        item.group.position.z + dz,
        item.currentRotation,
        memberIds
      )) {
        return false;
      }
    }

    return true;
  }

  animate(delta: number): void {
    if (this.flashTime > 0) {
      this.flashTime -= delta;
      if (this.flashTime <= 0) {
        for (const item of this.flashItems) {
          item.isColliding = false;
          item.blinkTime = 0;
          this.updateItemVisual(item);
        }
        this.flashItems = [];
      }
    }

    if (this.groupRotationAnim) {
      const anim = this.groupRotationAnim;
      anim.time += delta;
      const duration = 0.25;
      const t = Math.min(anim.time / duration, 1);
      const eased = easeOutCubic(t);
      const theta = anim.angle * eased;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      for (const m of anim.members) {
        m.item.group.position.x = anim.anchorX + m.offsetX * cos - m.offsetZ * sin;
        m.item.group.position.z = anim.anchorZ + m.offsetX * sin + m.offsetZ * cos;
        m.item.currentRotation = m.startRot + theta;
        m.item.group.rotation.y = m.item.currentRotation;
      }

      if (t >= 1) {
        for (const m of anim.members) {
          m.item.currentRotation = m.item.targetRotation;
          m.item.group.rotation.y = m.item.currentRotation;
          m.item.originalPosition.copy(m.item.group.position);
        }
        this.groupRotationAnim = null;
      }
    }

    for (const item of this.items) {
      if (item.isAnimatingRotation) {
        item.rotationAnimationTime += delta;
        const duration = 0.2;
        const t = Math.min(item.rotationAnimationTime / duration, 1);
        const eased = easeOutCubic(t);
        
        const startRot = item.currentRotation - (Math.PI / 4);
        item.currentRotation = startRot + (Math.PI / 4) * eased;
        item.group.rotation.y = item.currentRotation;
        
        if (t >= 1) {
          item.isAnimatingRotation = false;
          item.currentRotation = item.targetRotation;
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

    for (const groupId of this.groupLines.keys()) {
      this.updateGroupLines(groupId);
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

    this.groupLines.forEach((lines) => {
      this.scene.remove(lines);
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    });
    this.groupLines.clear();
    this.groups.clear();
  }
}
