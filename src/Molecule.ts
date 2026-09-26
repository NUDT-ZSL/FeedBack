import * as THREE from 'three';

export interface AtomData {
  element: string;
  position: THREE.Vector3;
  index: number;
}

export interface BondData {
  atom1Index: number;
  atom2Index: number;
  order: number;
}

export interface MoleculeData {
  name: string;
  formula: string;
  atoms: AtomData[];
  bonds: BondData[];
}

export const ELEMENT_COLORS: Record<string, number> = {
  H: 0xffffff,
  C: 0x808080,
  O: 0xff4444,
  N: 0x4444ff,
  S: 0xffff44,
  P: 0xff8800,
};

export const ELEMENT_NAMES: Record<string, string> = {
  H: '氢',
  C: '碳',
  O: '氧',
  N: '氮',
  S: '硫',
  P: '磷',
};

export const ELEMENT_RADIUS: Record<string, number> = {
  H: 0.3,
  C: 0.4,
  O: 0.35,
  N: 0.35,
  S: 0.45,
  P: 0.45,
};

export const MOLECULE_DATA: Record<string, MoleculeData> = {
  water: {
    name: '水',
    formula: 'H₂O',
    atoms: [
      { element: 'O', position: new THREE.Vector3(0, 0, 0), index: 0 },
      { element: 'H', position: new THREE.Vector3(0.757, 0.586, 0), index: 1 },
      { element: 'H', position: new THREE.Vector3(-0.757, 0.586, 0), index: 2 },
    ],
    bonds: [
      { atom1Index: 0, atom2Index: 1, order: 1 },
      { atom1Index: 0, atom2Index: 2, order: 1 },
    ],
  },
  methane: {
    name: '甲烷',
    formula: 'CH₄',
    atoms: [
      { element: 'C', position: new THREE.Vector3(0, 0, 0), index: 0 },
      { element: 'H', position: new THREE.Vector3(0.63, 0.63, 0.63), index: 1 },
      { element: 'H', position: new THREE.Vector3(-0.63, -0.63, 0.63), index: 2 },
      { element: 'H', position: new THREE.Vector3(0.63, -0.63, -0.63), index: 3 },
      { element: 'H', position: new THREE.Vector3(-0.63, 0.63, -0.63), index: 4 },
    ],
    bonds: [
      { atom1Index: 0, atom2Index: 1, order: 1 },
      { atom1Index: 0, atom2Index: 2, order: 1 },
      { atom1Index: 0, atom2Index: 3, order: 1 },
      { atom1Index: 0, atom2Index: 4, order: 1 },
    ],
  },
  co2: {
    name: '二氧化碳',
    formula: 'CO₂',
    atoms: [
      { element: 'C', position: new THREE.Vector3(0, 0, 0), index: 0 },
      { element: 'O', position: new THREE.Vector3(1.16, 0, 0), index: 1 },
      { element: 'O', position: new THREE.Vector3(-1.16, 0, 0), index: 2 },
    ],
    bonds: [
      { atom1Index: 0, atom2Index: 1, order: 2 },
      { atom1Index: 0, atom2Index: 2, order: 2 },
    ],
  },
};

export class Molecule {
  public data: MoleculeData;
  public group: THREE.Group;
  private atomMeshes: THREE.Mesh[] = [];
  private bondMeshes: THREE.Mesh[] = [];

  constructor(data: MoleculeData) {
    this.data = data;
    this.group = new THREE.Group();
    this.build();
  }

  private build(): void {
    this.data.atoms.forEach((atom, index) => {
      const radius = ELEMENT_RADIUS[atom.element] || 0.35;
      const geometry = new THREE.SphereGeometry(radius, 48, 48);
      const color = ELEMENT_COLORS[atom.element] || 0xffffff;
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.15,
        roughness: 0.25,
        emissive: color,
        emissiveIntensity: 0.05,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(atom.position);
      sphere.userData = { atomIndex: index, element: atom.element };
      this.atomMeshes.push(sphere);
      this.group.add(sphere);
    });

    this.data.bonds.forEach((bond) => {
      this.createBond(bond);
    });
  }

  private createBond(bond: BondData): void {
    const atom1 = this.data.atoms[bond.atom1Index];
    const atom2 = this.data.atoms[bond.atom2Index];
    const start = atom1.position;
    const end = atom2.position;
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    if (bond.order === 1) {
      const radius = 0.05;
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 16);
      geometry.translate(0, length / 2, 0);
      geometry.rotateX(Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.5,
        roughness: 0.3,
        transparent: true,
        opacity: 0.8,
      });
      const cylinder = new THREE.Mesh(geometry, material);
      cylinder.position.copy(start);
      cylinder.lookAt(end);
      cylinder.userData = { bond };
      this.bondMeshes.push(cylinder);
      this.group.add(cylinder);
    } else if (bond.order === 2) {
      const radius = 0.08;
      const offset = 0.12;
      const perpDir = new THREE.Vector3(direction.y, -direction.x, 0).normalize();
      if (perpDir.length() < 0.01) {
        perpDir.set(0, 0, 1);
      }

      for (let i = -1; i <= 1; i += 2) {
        const offsetVec = perpDir.clone().multiplyScalar(offset * i);
        const offsetStart = start.clone().add(offsetVec);
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 16);
        geometry.translate(0, length / 2, 0);
        geometry.rotateX(Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          metalness: 0.5,
          roughness: 0.3,
          transparent: true,
          opacity: 0.8,
        });
        const cylinder = new THREE.Mesh(geometry, material);
        cylinder.position.copy(offsetStart);
        cylinder.lookAt(end.clone().add(offsetVec));
        cylinder.userData = { bond };
        this.bondMeshes.push(cylinder);
        this.group.add(cylinder);
      }
    }
  }

  public getAtomPosition(index: number): THREE.Vector3 {
    return this.data.atoms[index].position.clone();
  }

  public getAtomWorldPosition(index: number): THREE.Vector3 {
    const pos = this.getAtomPosition(index);
    this.group.localToWorld(pos);
    return pos;
  }

  public getAtomElement(index: number): string {
    return this.data.atoms[index].element;
  }

  public getAtomMeshes(): THREE.Mesh[] {
    return this.atomMeshes;
  }

  public getBondedAtoms(atomIndex: number): number[] {
    const bonded: number[] = [];
    this.data.bonds.forEach((bond) => {
      if (bond.atom1Index === atomIndex) {
        bonded.push(bond.atom2Index);
      } else if (bond.atom2Index === atomIndex) {
        bonded.push(bond.atom1Index);
      }
    });
    return bonded;
  }

  public getDistance(atom1Index: number, atom2Index: number): number {
    const pos1 = this.data.atoms[atom1Index].position;
    const pos2 = this.data.atoms[atom2Index].position;
    return pos1.distanceTo(pos2);
  }

  public getBondAngle(atom1Index: number, centerIndex: number, atom2Index: number): number {
    const pos1 = this.data.atoms[atom1Index].position;
    const center = this.data.atoms[centerIndex].position;
    const pos2 = this.data.atoms[atom2Index].position;

    const v1 = new THREE.Vector3().subVectors(pos1, center).normalize();
    const v2 = new THREE.Vector3().subVectors(pos2, center).normalize();

    const dot = v1.dot(v2);
    const clampedDot = Math.max(-1, Math.min(1, dot));
    return Math.acos(clampedDot) * (180 / Math.PI);
  }

  public dispose(): void {
    this.atomMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.bondMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.atomMeshes = [];
    this.bondMeshes = [];
  }
}
