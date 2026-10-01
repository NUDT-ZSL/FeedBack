import * as THREE from 'three';

export type ElementType = 'C' | 'N' | 'O' | 'H' | 'S';
export type BondType = 1 | 2 | 3;

export const ELEMENT_COLORS: Record<ElementType, number> = {
  C: 0x808080,
  N: 0x3050F8,
  O: 0xFF0D0D,
  H: 0xFFFFFF,
  S: 0xFFFF30
};

export const ELEMENT_RADII: Record<ElementType, number> = {
  C: 0.7,
  N: 0.65,
  O: 0.6,
  H: 0.5,
  S: 0.85
};

export const ELEMENT_NUMBERS: Record<ElementType, number> = {
  C: 6,
  N: 7,
  O: 8,
  H: 1,
  S: 16
};

export const ELEMENT_NAMES: Record<ElementType, string> = {
  C: '碳',
  N: '氮',
  O: '氧',
  H: '氢',
  S: '硫'
};

export interface Atom {
  id: number;
  position: THREE.Vector3;
  element: ElementType;
  selected: boolean;
  hovered: boolean;
  scale: number;
  animating: boolean;
  animStart: number;
  animDuration: number;
  animType: 'spawn' | 'delete' | null;
}

export interface Bond {
  id: number;
  atom1: number;
  atom2: number;
  bondType: BondType;
  color: THREE.Color;
  animating: boolean;
  animStart: number;
  animDuration: number;
}

export interface MoleculeSettings {
  globalScale: number;
  showHydrogen: boolean;
  atomOpacity: number;
}

const MAX_ATOMS = 500;
const MAX_BONDS = 800;

export class Molecule {
  public atoms: Atom[] = [];
  public bonds: Bond[] = [];
  public group: THREE.Group;
  public atomMesh!: THREE.InstancedMesh;
  public bondMesh!: THREE.InstancedMesh;
  public glowMaterials: THREE.MeshStandardMaterial[] = [];
  public atomGeometries: Map<ElementType, THREE.SphereGeometry> = new Map();
  
  private dummy = new THREE.Object3D();
  private atomIdCounter = 0;
  private bondIdCounter = 0;
  private tempColor = new THREE.Color();
  
  public settings: MoleculeSettings = {
    globalScale: 1.0,
    showHydrogen: true,
    atomOpacity: 1.0
  };

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.setupGeometries();
    this.setupInstancedMeshes();
    this.loadCaffeine();
  }

  private setupGeometries(): void {
    (['C', 'N', 'O', 'H', 'S'] as ElementType[]).forEach(el => {
      this.atomGeometries.set(el, new THREE.SphereGeometry(ELEMENT_RADII[el], 32, 32));
    });
  }

  private setupInstancedMeshes(): void {
    const atomGeo = new THREE.SphereGeometry(1, 32, 32);
    const atomMat = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 1.0
    });
    this.atomMesh = new THREE.InstancedMesh(atomGeo, atomMat, MAX_ATOMS);
    this.atomMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.atomMesh.count = 0;
    this.group.add(this.atomMesh);

    const bondGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 12);
    bondGeo.translate(0, 0.5, 0);
    const bondMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.5,
      metalness: 0.1
    });
    this.bondMesh = new THREE.InstancedMesh(bondGeo, bondMat, MAX_BONDS * 3);
    this.bondMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bondMesh.count = 0;
    this.group.add(this.bondMesh);
  }

  public addAtom(position: THREE.Vector3, element: ElementType, animate: boolean = true): number {
    const id = this.atomIdCounter++;
    const atom: Atom = {
      id,
      position: position.clone(),
      element,
      selected: false,
      hovered: false,
      scale: animate ? 0 : 1,
      animating: animate,
      animStart: animate ? performance.now() : 0,
      animDuration: 300,
      animType: animate ? 'spawn' : null
    };
    this.atoms.push(atom);
    this.update();
    return id;
  }

  public removeAtom(id: number): void {
    const atom = this.atoms.find(a => a.id === id);
    if (!atom) return;
    
    const bondsToRemove = this.bonds.filter(b => b.atom1 === id || b.atom2 === id);
    bondsToRemove.forEach(b => this.removeBond(b.id));

    atom.animating = true;
    atom.animStart = performance.now();
    atom.animDuration = 200;
    atom.animType = 'delete';

    setTimeout(() => {
      this.atoms = this.atoms.filter(a => a.id !== id);
      this.update();
    }, 200);
  }

  public addBond(atom1Id: number, atom2Id: number, bondType: BondType = 1, animate: boolean = true): number | null {
    if (atom1Id === atom2Id) return null;
    const exists = this.bonds.some(b => 
      (b.atom1 === atom1Id && b.atom2 === atom2Id) || 
      (b.atom1 === atom2Id && b.atom2 === atom1Id)
    );
    if (exists) return null;

    const id = this.bondIdCounter++;
    const bond: Bond = {
      id,
      atom1: atom1Id,
      atom2: atom2Id,
      bondType,
      color: new THREE.Color(0xffffff),
      animating: animate,
      animStart: animate ? performance.now() : 0,
      animDuration: animate ? 400 : 0
    };
    
    if (animate) {
      const elapsed = performance.now();
      const animateColor = () => {
        const now = performance.now();
        const t = Math.min((now - elapsed) / 300, 1);
        if (t < 0.5) {
          bond.color.lerpColors(new THREE.Color(0xffffff), new THREE.Color(0xffff00), t * 2);
        } else {
          bond.color.lerpColors(new THREE.Color(0xffff00), new THREE.Color(0x666666), (t - 0.5) * 2);
        }
        if (t < 1) {
          requestAnimationFrame(animateColor);
        }
      };
      animateColor();
    } else {
      bond.color.setHex(0x666666);
    }

    this.bonds.push(bond);
    this.update();
    return id;
  }

  public removeBond(id: number): void {
    this.bonds = this.bonds.filter(b => b.id !== id);
  }

  public toggleBondType(bondId: number): void {
    const bond = this.bonds.find(b => b.id === bondId);
    if (!bond) return;
    
    bond.bondType = ((bond.bondType % 3) + 1) as BondType;
    
    const start = performance.now();
    const animateColor = () => {
      const now = performance.now();
      const t = Math.min((now - start) / 300, 1);
      const targetColor = bond.bondType === 1 ? new THREE.Color(0x666666) :
                          bond.bondType === 2 ? new THREE.Color(0xffff00) :
                          new THREE.Color(0xff0000);
      if (t < 0.5) {
        bond.color.lerpColors(new THREE.Color(0xffffff), new THREE.Color(0xffff00), t * 2);
      } else {
        bond.color.lerpColors(new THREE.Color(0xffff00), targetColor, (t - 0.5) * 2);
      }
      if (t < 1) {
        requestAnimationFrame(animateColor);
      }
      this.update();
    };
    animateColor();
    
    this.update();
  }

  public getAtomAtScreenPosition(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): Atom | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObject(this.atomMesh);
    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId !== undefined) {
        const visibleAtoms = this.getVisibleAtoms();
        return visibleAtoms[instanceId] || null;
      }
    }
    return null;
  }

  public getBondAtScreenPosition(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): Bond | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObject(this.bondMesh);
    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId !== undefined) {
        return this.getBondFromInstance(instanceId);
      }
    }
    return null;
  }

  private getVisibleAtoms(): Atom[] {
    return this.atoms.filter(a => this.settings.showHydrogen || a.element !== 'H');
  }

  private getBondFromInstance(instanceId: number): Bond | null {
    let count = 0;
    for (const bond of this.bonds) {
      count += bond.bondType;
      if (instanceId < count) {
        return bond;
      }
    }
    return null;
  }

  public selectAtom(id: number | null): void {
    this.atoms.forEach(a => {
      a.selected = a.id === id;
    });
    this.update();
  }

  public getSelectedAtom(): Atom | null {
    return this.atoms.find(a => a.selected) || null;
  }

  public setHoveredAtom(id: number | null): void {
    this.atoms.forEach(a => {
      a.hovered = a.id === id;
    });
    this.update();
  }

  public getHoveredAtom(): Atom | null {
    return this.atoms.find(a => a.hovered) || null;
  }

  public screenPositionFromWorld(
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): { x: number; y: number; visible: boolean } {
    const pos = worldPos.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: (pos.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-pos.y * 0.5 + 0.5) * rect.height + rect.top,
      visible: pos.z < 1 && pos.z > -1
    };
  }

  public worldPositionFromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    distance: number = 5
  ): THREE.Vector3 {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );
    const vector = new THREE.Vector3(mouse.x, mouse.y, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();
    return camera.position.clone().add(dir.multiplyScalar(distance));
  }

  public update(): void {
    const now = performance.now();
    const visibleAtoms = this.getVisibleAtoms();
    
    this.atomMesh.count = visibleAtoms.length;
    (this.atomMesh.material as THREE.MeshStandardMaterial).opacity = this.settings.atomOpacity;

    for (let i = 0; i < visibleAtoms.length; i++) {
      const atom = visibleAtoms[i];
      
      if (atom.animating && atom.animType) {
        const t = Math.min((now - atom.animStart) / atom.animDuration, 1);
        if (atom.animType === 'spawn') {
          atom.scale = t * t * (3 - 2 * t);
        } else if (atom.animType === 'delete') {
          atom.scale = 1 - t;
        }
        if (t >= 1) {
          atom.animating = false;
          atom.animType = null;
        }
      }

      const radius = ELEMENT_RADII[atom.element] * this.settings.globalScale * atom.scale;
      
      this.dummy.position.copy(atom.position);
      this.dummy.scale.set(radius, radius, radius);
      this.dummy.updateMatrix();
      this.atomMesh.setMatrixAt(i, this.dummy.matrix);

      let color: number;
      if (atom.selected) {
        color = 0x00FF00;
      } else {
        color = ELEMENT_COLORS[atom.element];
      }
      
      this.tempColor.setHex(color);
      if (atom.hovered && !atom.selected) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.004 * Math.PI);
        this.tempColor.multiplyScalar(1 + pulse * 0.3);
      }
      if (atom.selected) {
        this.tempColor.multiplyScalar(1.2);
      }
      
      this.atomMesh.setColorAt(i, this.tempColor);
    }
    
    this.atomMesh.instanceMatrix.needsUpdate = true;
    if (this.atomMesh.instanceColor) {
      this.atomMesh.instanceColor.needsUpdate = true;
    }

    this.updateBonds();
  }

  private updateBonds(): void {
    let instanceIndex = 0;
    
    for (const bond of this.bonds) {
      const atom1 = this.atoms.find(a => a.id === bond.atom1);
      const atom2 = this.atoms.find(a => a.id === bond.atom2);
      if (!atom1 || !atom2) continue;
      if (!this.settings.showHydrogen && (atom1.element === 'H' || atom2.element === 'H')) continue;

      const p1 = atom1.position.clone();
      const p2 = atom2.position.clone();
      const direction = new THREE.Vector3().subVectors(p2, p1);
      const length = direction.length();
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

      const offsets = this.getBondOffsets(bond.bondType, direction);
      const bondLength = length * this.settings.globalScale;

      for (let j = 0; j < bond.bondType; j++) {
        if (instanceIndex >= MAX_BONDS * 3) break;

        this.dummy.position.copy(mid).add(offsets[j]);
        this.dummy.position.lerp(p1, 0.02);
        this.dummy.position.lerp(p2, 0.98);
        this.dummy.position.sub(direction.clone().normalize().multiplyScalar(length * 0.48));
        
        this.dummy.scale.set(1, bondLength, 1);
        this.dummy.lookAt(p2);
        this.dummy.rotateX(Math.PI / 2);
        this.dummy.updateMatrix();
        
        this.bondMesh.setMatrixAt(instanceIndex, this.dummy.matrix);
        this.bondMesh.setColorAt(instanceIndex, bond.color);
        instanceIndex++;
      }
    }

    this.bondMesh.count = instanceIndex;
    this.bondMesh.instanceMatrix.needsUpdate = true;
    if (this.bondMesh.instanceColor) {
      this.bondMesh.instanceColor.needsUpdate = true;
    }
  }

  private getBondOffsets(bondType: BondType, direction: THREE.Vector3): THREE.Vector3[] {
    if (bondType === 1) {
      return [new THREE.Vector3(0, 0, 0)];
    }

    const perp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(direction.dot(perp)) > 0.9) {
      perp.set(1, 0, 0);
    }
    
    const tangent = new THREE.Vector3().crossVectors(direction, perp).normalize();
    const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
    const spacing = 0.1 * this.settings.globalScale;

    if (bondType === 2) {
      return [
        tangent.clone().multiplyScalar(-spacing / 2),
        tangent.clone().multiplyScalar(spacing / 2)
      ];
    }

    const r = spacing / Math.sqrt(3);
    return [
      tangent.clone().multiplyScalar(r),
      tangent.clone().multiplyScalar(-r * 0.5).add(bitangent.clone().multiplyScalar(r * Math.sqrt(3) / 2)),
      tangent.clone().multiplyScalar(-r * 0.5).add(bitangent.clone().multiplyScalar(-r * Math.sqrt(3) / 2))
    ];
  }

  private loadCaffeine(): void {
    const atoms: Array<{ element: ElementType; pos: [number, number, number] }> = [
      { element: 'N', pos: [-1.21, 0.58, 0.00] },
      { element: 'C', pos: [0.00, 0.00, 0.00] },
      { element: 'N', pos: [1.21, 0.58, 0.00] },
      { element: 'C', pos: [1.21, 1.95, 0.00] },
      { element: 'N', pos: [0.00, 2.53, 0.00] },
      { element: 'C', pos: [-1.21, 1.95, 0.00] },
      { element: 'C', pos: [0.00, -1.50, 0.00] },
      { element: 'O', pos: [0.00, -2.70, 0.00] },
      { element: 'C', pos: [-2.43, -0.00, 0.00] },
      { element: 'O', pos: [-3.63, -0.00, 0.00] },
      { element: 'C', pos: [2.43, -0.00, 0.00] },
      { element: 'C', pos: [0.00, 4.00, 0.00] },
      { element: 'H', pos: [2.43, -0.57, -0.90] },
      { element: 'H', pos: [2.43, -0.57, 0.90] },
      { element: 'H', pos: [2.43, 1.05, 0.00] },
      { element: 'H', pos: [0.00, 4.58, -0.90] },
      { element: 'H', pos: [0.00, 4.58, 0.90] },
      { element: 'H', pos: [-0.90, 4.30, 0.00] },
      { element: 'H', pos: [0.90, 4.30, 0.00] },
      { element: 'H', pos: [2.15, 2.40, 0.00] },
      { element: 'H', pos: [-2.15, 2.40, 0.00] },
      { element: 'H', pos: [-2.15, -0.60, 0.00] },
      { element: 'H', pos: [1.40, 0.20, 0.00] },
      { element: 'H', pos: [-1.40, 0.20, 0.00] }
    ];

    const bondList: Array<[number, number, BondType]> = [
      [0, 1, 1],
      [1, 2, 1],
      [2, 3, 2],
      [3, 4, 1],
      [4, 5, 2],
      [5, 0, 1],
      [1, 6, 1],
      [6, 7, 2],
      [0, 8, 1],
      [8, 9, 2],
      [2, 10, 1],
      [4, 11, 1],
      [10, 12, 1],
      [10, 13, 1],
      [10, 14, 1],
      [11, 15, 1],
      [11, 16, 1],
      [11, 17, 1],
      [11, 18, 1],
      [3, 19, 1],
      [5, 20, 1],
      [8, 21, 1],
      [0, 22, 1],
      [2, 23, 1]
    ];

    const ids: number[] = [];
    atoms.forEach(a => {
      const id = this.addAtom(new THREE.Vector3(...a.pos), a.element, false);
      ids.push(id);
    });

    bondList.forEach(([a, b, type]) => {
      if (ids[a] !== undefined && ids[b] !== undefined) {
        this.addBond(ids[a], ids[b], type, false);
      }
    });
  }

  public dispose(): void {
    this.atomMesh.geometry.dispose();
    (this.atomMesh.material as THREE.Material).dispose();
    this.bondMesh.geometry.dispose();
    (this.bondMesh.material as THREE.Material).dispose();
    this.atomGeometries.forEach(g => g.dispose());
  }
}
