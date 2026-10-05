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
  isBouncing: boolean;
  bounceStartPosition: THREE.Vector3;
  bounceEndPosition: THREE.Vector3;
  bounceAnimationTime: number;
  blinkTime: number;
  groupId: string | null;
  flashTime: number;
  isAnimatingGroupRotation: boolean;
  groupRotTime: number;
  groupRotDelta: number;
  groupRotStartPosition: THREE.Vector3;
  groupRotAnchor: THREE.Vector3;
  groupRotStartRotation: number;
}

export interface FurnitureGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export type SelectionInfo =
  | { kind: 'none' }
  | { kind: 'single'; item: FurnitureItem }
  | { kind: 'multi'; items: FurnitureItem[] }
  | { kind: 'group'; group: FurnitureGroup; items: FurnitureItem[] };

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
  private groups: Map<string, FurnitureGroup> = new Map();
  private groupCounter = 0;
  private groupLines: Map<string, THREE.LineSegments> = new Map();
  private selectedItems: FurnitureItem[] = [];
  private dragItem: FurnitureItem | null = null;
  private dragGroupMembers: FurnitureItem[] | null = null;
  private dragAnchor: THREE.Vector2 = new THREE.Vector2();
  private dragOffset: THREE.Vector2 = new THREE.Vector2();
  private groundPlane: THREE.Mesh;
  private raycaster: THREE.Raycaster;
  private onSelectChange: ((info: SelectionInfo) => void) | null = null;
  private dragLight: THREE.PointLight | null = null;
  private groundProjection: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, groundPlane: THREE.Mesh, raycaster: THREE.Raycaster) {
    this.scene = scene;
    this.groundPlane = groundPlane;
    this.raycaster = raycaster;
  }

  setOnSelectChange(callback: (info: SelectionInfo) => void): void {
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
      isBouncing: false,
      bounceStartPosition: new THREE.Vector3(),
      bounceEndPosition: new THREE.Vector3(),
      bounceAnimationTime: 0,
      blinkTime: 0,
      groupId: null,
      flashTime: 0,
      isAnimatingGroupRotation: false,
      groupRotTime: 0,
      groupRotDelta: 0,
      groupRotStartPosition: new THREE.Vector3(),
      groupRotAnchor: new THREE.Vector3(),
      groupRotStartRotation: 0
    };
    
    mesh.userData.furnitureItem = item;
    edgeLines.userData.furnitureItem = item;
    
    this.items.push(item);
    this.selectItem(item);
    
    return item;
  }

  selectItem(item: FurnitureItem | null, additive = false): void {
    if (additive && item) {
      const index = this.selectedItems.indexOf(item);
      if (index > -1) {
        this.selectedItems.splice(index, 1);
      } else {
        this.selectedItems.push(item);
      }
    } else if (item) {
      if (item.groupId && this.groups.has(item.groupId)) {
        const group = this.groups.get(item.groupId)!;
        this.selectedItems = group.memberIds
          .map((id) => this.items.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is FurnitureItem => candidate !== undefined);
      } else {
        this.selectedItems = [item];
      }
    } else {
      this.selectedItems = [];
    }

    for (const candidate of this.items) {
      const selected = this.selectedItems.indexOf(candidate) > -1;
      if (candidate.isSelected !== selected) {
        candidate.isSelected = selected;
        this.updateItemVisual(candidate);
      }
    }

    this.emitSelection();
  }

  private emitSelection(): void {
    if (!this.onSelectChange) return;

    if (this.selectedItems.length === 0) {
      this.onSelectChange({ kind: 'none' });
      return;
    }

    if (this.selectedItems.length === 1) {
      this.onSelectChange({ kind: 'single', item: this.selectedItems[0] });
      return;
    }

    const groupId = this.selectedItems[0].groupId;
    if (groupId && this.selectedItems.every((member) => member.groupId === groupId)) {
      const group = this.groups.get(groupId);
      if (group) {
        this.onSelectChange({ kind: 'group', group, items: [...this.selectedItems] });
        return;
      }
    }

    this.onSelectChange({ kind: 'multi', items: [...this.selectedItems] });
  }

  getSelectedItems(): FurnitureItem[] {
    return this.selectedItems;
  }

  getItems(): FurnitureItem[] {
    return this.items;
  }

  getGroups(): FurnitureGroup[] {
    return Array.from(this.groups.values());
  }

  getGroupMembers(group: FurnitureGroup): FurnitureItem[] {
    return group.memberIds
      .map((id) => this.items.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is FurnitureItem => candidate !== undefined);
  }

  private getGroupAnchor(group: FurnitureGroup): THREE.Vector2 {
    const members = this.getGroupMembers(group);
    let x = 0;
    let z = 0;
    for (const member of members) {
      x += member.group.position.x;
      z += member.group.position.z;
    }
    return new THREE.Vector2(x / members.length, z / members.length);
  }

  createGroupFromSelection(): FurnitureGroup | null {
    if (this.selectedItems.length < 2) return null;

    for (const member of [...this.selectedItems]) {
      if (member.groupId) {
        this.removeFromGroup(member);
      }
    }

    this.groupCounter += 1;
    const group: FurnitureGroup = {
      id: generateId(),
      name: `组合 ${this.groupCounter}`,
      memberIds: this.selectedItems.map((member) => member.id)
    };
    this.groups.set(group.id, group);

    for (const member of this.selectedItems) {
      member.groupId = group.id;
      this.updateItemVisual(member);
    }

    this.createGroupLines(group);
    this.emitSelection();
    return group;
  }

  ungroupSelected(): void {
    if (this.selectedItems.length === 0) return;
    const groupId = this.selectedItems[0].groupId;
    if (!groupId || !this.groups.has(groupId)) return;
    if (!this.selectedItems.every((member) => member.groupId === groupId)) return;
    this.dissolveGroup(groupId);
    this.emitSelection();
  }

  private dissolveGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    for (const member of this.getGroupMembers(group)) {
      member.groupId = null;
      this.updateItemVisual(member);
    }

    this.removeGroupLines(groupId);
    this.groups.delete(groupId);
  }

  private removeFromGroup(item: FurnitureItem): void {
    if (!item.groupId) return;
    const groupId = item.groupId;
    const group = this.groups.get(groupId);
    item.groupId = null;
    this.updateItemVisual(item);

    if (group) {
      group.memberIds = group.memberIds.filter((id) => id !== item.id);
      if (group.memberIds.length < 2) {
        this.dissolveGroup(groupId);
      } else {
        this.removeGroupLines(groupId);
        this.createGroupLines(group);
      }
    }
  }

  private createGroupLines(group: FurnitureGroup): void {
    const members = this.getGroupMembers(group);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(members.length * 6), 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xD4A574,
      transparent: true,
      opacity: 0.8
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    this.scene.add(lines);
    this.groupLines.set(group.id, lines);
    this.updateGroupLines(group);
  }

  private removeGroupLines(groupId: string): void {
    const lines = this.groupLines.get(groupId);
    if (!lines) return;
    this.scene.remove(lines);
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
    this.groupLines.delete(groupId);
  }

  private updateGroupLines(group: FurnitureGroup): void {
    const lines = this.groupLines.get(group.id);
    if (!lines) return;

    const members = this.getGroupMembers(group);
    const anchor = this.getGroupAnchor(group);
    const attribute = lines.geometry.getAttribute('position') as THREE.BufferAttribute;

    members.forEach((member, index) => {
      attribute.setXYZ(index * 2, anchor.x, 0.04, anchor.y);
      attribute.setXYZ(index * 2 + 1, member.group.position.x, 0.04, member.group.position.z);
    });

    attribute.needsUpdate = true;
    lines.geometry.setDrawRange(0, members.length * 2);
  }

  private updateItemVisual(item: FurnitureItem): void {
    const mesh = item.group.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;

    if (item.isColliding || item.flashTime > 0) {
      const blinkOn = Math.floor(item.blinkTime / 0.1) % 2 === 0;
      material.color.setHex(blinkOn ? 0xFF6B6B : item.data.color);
      material.emissive.setHex(0x000000);
      material.emissiveIntensity = 0;
    } else if (item.isSelected) {
      material.color.setHex(item.data.color);
      material.emissive.setHex(0xD4A574);
      material.emissiveIntensity = 0.15;
    } else if (item.groupId) {
      material.color.setHex(item.data.color);
      material.emissive.setHex(0xD4A574);
      material.emissiveIntensity = 0.05;
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

      if (item.groupId && this.groups.has(item.groupId)) {
        const group = this.groups.get(item.groupId)!;
        this.dragGroupMembers = this.getGroupMembers(group);
        const anchor = this.getGroupAnchor(group);
        this.dragAnchor.copy(anchor);
        this.dragOffset.set(anchor.x - point.x, anchor.y - point.z);

        for (const member of this.dragGroupMembers) {
          member.isDragging = true;
          member.originalPosition.copy(member.group.position);
        }
      } else {
        this.dragGroupMembers = null;
        item.originalPosition.copy(item.group.position);
        this.dragOffset.set(
          item.group.position.x - point.x,
          item.group.position.z - point.z
        );
      }

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

      if (this.dragGroupMembers) {
        this.updateGroupDrag(point);
        return;
      }

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
    const members = this.dragGroupMembers!;
    const desiredX = point.x + this.dragOffset.x;
    const desiredZ = point.z + this.dragOffset.y;
    const dx = desiredX - this.dragAnchor.x;
    const dz = desiredZ - this.dragAnchor.y;

    if (dx !== 0 && this.canMoveGroup(members, dx, 0)) {
      for (const member of members) {
        member.group.position.x += dx;
      }
      this.dragAnchor.x += dx;
    }

    if (dz !== 0 && this.canMoveGroup(members, 0, dz)) {
      for (const member of members) {
        member.group.position.z += dz;
      }
      this.dragAnchor.y += dz;
    }

    if (this.dragLight) {
      this.dragLight.position.x = this.dragAnchor.x;
      this.dragLight.position.z = this.dragAnchor.y;
    }

    if (this.groundProjection && this.dragItem) {
      this.groundProjection.position.x = this.dragItem.group.position.x;
      this.groundProjection.position.z = this.dragItem.group.position.z;
      this.groundProjection.rotation.y = this.dragItem.currentRotation;
    }
  }

  private canMoveGroup(members: FurnitureItem[], dx: number, dz: number): boolean {
    const memberIds = new Set(members.map((member) => member.id));
    const blocked: FurnitureItem[] = [];

    for (const member of members) {
      const nx = member.group.position.x + dx;
      const nz = member.group.position.z + dz;
      if (
        !this.isWithinBounds(member, nx, nz, member.currentRotation) ||
        this.collidesAt(member, nx, nz, member.currentRotation, memberIds)
      ) {
        blocked.push(member);
      }
    }

    if (blocked.length > 0) {
      for (const member of blocked) {
        member.flashTime = 0.2;
      }
      return false;
    }

    return true;
  }

  private isWithinBounds(item: FurnitureItem, x: number, z: number, rotation: number): boolean {
    const halfW = item.data.width / 2;
    const halfD = item.data.depth / 2;
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    const boundX = halfW * cos + halfD * sin;
    const boundZ = halfW * sin + halfD * cos;

    return (
      x >= ROOM_BOUNDS.minX + boundX &&
      x <= ROOM_BOUNDS.maxX - boundX &&
      z >= ROOM_BOUNDS.minZ + boundZ &&
      z <= ROOM_BOUNDS.maxZ - boundZ
    );
  }

  private collidesAt(
    item: FurnitureItem,
    x: number,
    z: number,
    rotation: number,
    ignoreIds: Set<string>
  ): boolean {
    for (const other of this.items) {
      if (other.id === item.id || ignoreIds.has(other.id)) continue;
      if (
        this.obbIntersect(
          x, z, rotation, item.data.width / 2, item.data.depth / 2,
          other.group.position.x, other.group.position.z, other.currentRotation,
          other.data.width / 2, other.data.depth / 2
        )
      ) {
        return true;
      }
    }
    return false;
  }

  endDrag(): void {
    if (this.dragItem) {
      if (this.dragGroupMembers) {
        for (const member of this.dragGroupMembers) {
          member.isDragging = false;
          member.isColliding = false;
          member.flashTime = 0;
          member.blinkTime = 0;
          member.originalPosition.copy(member.group.position);
          this.updateItemVisual(member);
        }
        this.dragGroupMembers = null;
      } else {
        if (this.dragItem.isColliding) {
          this.startBounce(this.dragItem);
        } else {
          this.dragItem.originalPosition.copy(this.dragItem.group.position);
        }

        this.dragItem.isDragging = false;
        this.dragItem.isColliding = false;
        this.dragItem.blinkTime = 0;
        this.updateItemVisual(this.dragItem);
      }
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
    if (this.selectedItems.length === 0) return;

    const first = this.selectedItems[0];
    const groupId = first.groupId;
    if (
      groupId &&
      this.groups.has(groupId) &&
      this.selectedItems.every((member) => member.groupId === groupId)
    ) {
      this.rotateGroup(this.groups.get(groupId)!);
      return;
    }

    for (const item of this.selectedItems) {
      if (item.isAnimatingRotation || item.isBouncing || item.isAnimatingGroupRotation) continue;
      item.targetRotation += Math.PI / 4;
      item.isAnimatingRotation = true;
      item.rotationAnimationTime = 0;
    }
  }

  private rotateGroup(group: FurnitureGroup): void {
    const members = this.getGroupMembers(group);
    if (
      members.length === 0 ||
      members.some(
        (member) => member.isAnimatingRotation || member.isBouncing || member.isAnimatingGroupRotation
      )
    ) {
      return;
    }

    const anchor = this.getGroupAnchor(group);
    const delta = Math.PI / 4;
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    const memberIds = new Set(members.map((member) => member.id));

    const targets = members.map((member) => {
      const relX = member.group.position.x - anchor.x;
      const relZ = member.group.position.z - anchor.y;
      return {
        member,
        x: anchor.x + relX * cos + relZ * sin,
        z: anchor.y - relX * sin + relZ * cos,
        rotation: member.currentRotation + delta
      };
    });

    const valid = targets.every(
      (target) =>
        this.isWithinBounds(target.member, target.x, target.z, target.rotation) &&
        !this.collidesAt(target.member, target.x, target.z, target.rotation, memberIds)
    );

    if (!valid) {
      for (const member of members) {
        member.flashTime = 0.6;
      }
      return;
    }

    for (const member of members) {
      member.isAnimatingGroupRotation = true;
      member.groupRotTime = 0;
      member.groupRotDelta = delta;
      member.groupRotStartPosition.copy(member.group.position);
      member.groupRotAnchor.set(anchor.x, 0, anchor.y);
      member.groupRotStartRotation = member.currentRotation;
      member.targetRotation = member.currentRotation + delta;
    }
  }

  deleteSelected(): void {
    if (this.selectedItems.length === 0) return;

    for (const item of [...this.selectedItems]) {
      this.deleteItem(item);
    }

    this.selectedItems = [];
    this.emitSelection();
  }

  private deleteItem(item: FurnitureItem): void {
    const index = this.items.indexOf(item);
    if (index > -1) {
      this.items.splice(index, 1);
      this.scene.remove(item.group);

      const mesh = item.group.children[0] as THREE.Mesh;
      (mesh.material as THREE.Material).dispose();

      const selectedIndex = this.selectedItems.indexOf(item);
      if (selectedIndex > -1) {
        this.selectedItems.splice(selectedIndex, 1);
      }

      if (item.groupId) {
        this.removeFromGroup(item);
      }
    }
  }

  private checkCollisions(item: FurnitureItem): void {
    let colliding = false;
    
    for (const other of this.items) {
      if (other.id === item.id) continue;
      
      if (this.checkOBBCollision(item, other)) {
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

  private checkOBBCollision(a: FurnitureItem, b: FurnitureItem): boolean {
    return this.obbIntersect(
      a.group.position.x, a.group.position.z, a.currentRotation,
      a.data.width / 2, a.data.depth / 2,
      b.group.position.x, b.group.position.z, b.currentRotation,
      b.data.width / 2, b.data.depth / 2
    );
  }

  private obbIntersect(
    ax: number, az: number, aRot: number, aHalfW: number, aHalfD: number,
    bx: number, bz: number, bRot: number, bHalfW: number, bHalfD: number
  ): boolean {
    const dx = bx - ax;
    const dz = bz - az;

    const cosA = Math.cos(aRot);
    const sinA = Math.sin(aRot);
    const cosB = Math.cos(bRot);
    const sinB = Math.sin(bRot);

    const axes: Array<[number, number]> = [
      [cosA, sinA],
      [-sinA, cosA],
      [cosB, sinB],
      [-sinB, cosB]
    ];

    for (const [axisX, axisZ] of axes) {
      const aExtent = aHalfW * Math.abs(axisX * cosA + axisZ * sinA) + aHalfD * Math.abs(-axisX * sinA + axisZ * cosA);
      const bExtent = bHalfW * Math.abs(axisX * cosB + axisZ * sinB) + bHalfD * Math.abs(-axisX * sinB + axisZ * cosB);
      const distance = Math.abs(dx * axisX + dz * axisZ);

      if (distance > aExtent + bExtent) {
        return false;
      }
    }

    return true;
  }

  animate(delta: number): void {
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
      
      if (item.isAnimatingGroupRotation) {
        item.groupRotTime += delta;
        const duration = 0.25;
        const t = Math.min(item.groupRotTime / duration, 1);
        const eased = easeOutCubic(t);
        const angle = item.groupRotDelta * eased;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const relX = item.groupRotStartPosition.x - item.groupRotAnchor.x;
        const relZ = item.groupRotStartPosition.z - item.groupRotAnchor.z;
        item.group.position.x = item.groupRotAnchor.x + relX * cos + relZ * sin;
        item.group.position.z = item.groupRotAnchor.z - relX * sin + relZ * cos;
        item.currentRotation = item.groupRotStartRotation + angle;
        item.group.rotation.y = item.currentRotation;

        if (t >= 1) {
          item.isAnimatingGroupRotation = false;
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

      if (item.isColliding || item.flashTime > 0) {
        if (item.flashTime > 0) {
          item.flashTime = Math.max(0, item.flashTime - delta);
        }
        item.blinkTime += delta;
        this.updateItemVisual(item);
        if (!item.isColliding && item.flashTime === 0) {
          this.updateItemVisual(item);
        }
      }
    }

    for (const group of this.groups.values()) {
      this.updateGroupLines(group);
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

    for (const groupId of Array.from(this.groupLines.keys())) {
      this.removeGroupLines(groupId);
    }
    this.groups.clear();
    
    geometryCache.forEach((geo) => geo.dispose());
    geometryCache.clear();
    
    materialCache.forEach((mat) => mat.dispose());
    materialCache.clear();
    
    edgeMaterial.dispose();
  }
}
