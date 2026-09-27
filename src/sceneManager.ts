import * as THREE from 'three';
import type { MoleculeData, AtomData } from './moleculeData';

export interface MoleculeObject {
  group: THREE.Group;
  atoms: THREE.Mesh[];
  atomDataMap: Map<THREE.Mesh, AtomData>;
  bonds: THREE.Mesh[];
  electronClouds: THREE.Points[];
}

export class SceneManager {
  private scene: THREE.Scene;
  private currentMolecule: MoleculeObject | null = null;
  private targetMolecule: MoleculeObject | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  createAtomMesh(atom: AtomData): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(atom.radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(atom.color),
      metalness: 0.3,
      roughness: 0.4,
      emissive: new THREE.Color(atom.color).multiplyScalar(0.1)
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...atom.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  createElectronCloud(atom: AtomData): THREE.Points {
    const particleCount = 60;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const cloudColor = new THREE.Color(atom.color);
    const cloudRadius = atom.radius * 1.8;

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = cloudRadius * (0.6 + Math.random() * 0.4);
      const i3 = i * 3;

      positions[i3] = atom.position[0] + r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = atom.position[1] + r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = atom.position[2] + r * Math.cos(phi);

      colors[i3] = cloudColor.r;
      colors[i3 + 1] = cloudColor.g;
      colors[i3 + 2] = cloudColor.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    return points;
  }

  createBondMesh(pos1: [number, number, number], pos2: [number, number, number]): THREE.Mesh {
    const start = new THREE.Vector3(...pos1);
    const end = new THREE.Vector3(...pos2);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    const geometry = new THREE.CylinderGeometry(0.08, 0.08, length, 16);
    geometry.translate(0, length / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      metalness: 0.2,
      roughness: 0.6
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );
    return mesh;
  }

  buildMolecule(moleculeData: MoleculeData): MoleculeObject {
    const group = new THREE.Group();
    const atoms: THREE.Mesh[] = [];
    const bonds: THREE.Mesh[] = [];
    const electronClouds: THREE.Points[] = [];
    const atomDataMap = new Map<THREE.Mesh, AtomData>();

    moleculeData.atoms.forEach((atomData, index) => {
      const atomMesh = this.createAtomMesh(atomData);
      atomMesh.userData.atomIndex = index;
      atoms.push(atomMesh);
      atomDataMap.set(atomMesh, atomData);
      group.add(atomMesh);

      const cloud = this.createElectronCloud(atomData);
      electronClouds.push(cloud);
      group.add(cloud);
    });

    moleculeData.bonds.forEach(bond => {
      const atom1 = moleculeData.atoms[bond.atom1];
      const atom2 = moleculeData.atoms[bond.atom2];
      const bondMesh = this.createBondMesh(atom1.position, atom2.position);
      bonds.push(bondMesh);
      group.add(bondMesh);
    });

    group.scale.set(0, 0, 0);
    group.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        const anyObj = obj as any;
        if (anyObj.material && 'opacity' in anyObj.material) {
          anyObj.material.opacity = 0;
          anyObj.material.transparent = true;
        }
      }
    });

    return { group, atoms, bonds, electronClouds, atomDataMap };
  }

  async loadMolecule(moleculeData: MoleculeData): Promise<void> {
    return new Promise((resolve) => {
      this.targetMolecule = this.buildMolecule(moleculeData);
      this.scene.add(this.targetMolecule.group);

      const startTime = performance.now();
      const duration = 400;

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);

        if (this.currentMolecule) {
          const outScale = 1 - eased;
          this.currentMolecule.group.scale.set(outScale, outScale, outScale);
          this.currentMolecule.group.traverse(obj => {
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
              const anyObj = obj as any;
              if (anyObj.material && 'opacity' in anyObj.material) {
                anyObj.material.opacity = (obj instanceof THREE.Points ? 0.5 : 1) * (1 - eased);
              }
            }
          });
        }

        if (this.targetMolecule) {
          const inScale = eased;
          this.targetMolecule.group.scale.set(inScale, inScale, inScale);
          this.targetMolecule.group.traverse(obj => {
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
              const anyObj = obj as any;
              if (anyObj.material && 'opacity' in anyObj.material) {
                const targetOpacity = obj instanceof THREE.Points ? 0.5 :
                  (obj.geometry instanceof THREE.CylinderGeometry ? 0.7 : 1);
                anyObj.material.opacity = targetOpacity * eased;
              }
            }
          });
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          if (this.currentMolecule) {
            this.disposeMolecule(this.currentMolecule);
          }
          this.currentMolecule = this.targetMolecule;
          this.targetMolecule = null;
          resolve();
        }
      };

      animate();
    });
  }

  async unloadMolecule(): Promise<void> {
    if (!this.currentMolecule) return;

    return new Promise((resolve) => {
      const startTime = performance.now();
      const duration = 400;
      const molecule = this.currentMolecule;

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);

        if (molecule) {
          const scale = 1 - eased;
          molecule.group.scale.set(scale, scale, scale);
          molecule.group.traverse(obj => {
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
              const anyObj = obj as any;
              if (anyObj.material && 'opacity' in anyObj.material) {
                const targetOpacity = obj instanceof THREE.Points ? 0.5 :
                  (obj.geometry instanceof THREE.CylinderGeometry ? 0.7 : 1);
                anyObj.material.opacity = targetOpacity * (1 - eased);
              }
            }
          });
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          if (molecule) {
            this.disposeMolecule(molecule);
          }
          this.currentMolecule = null;
          resolve();
        }
      };

      animate();
    });
  }

  private disposeMolecule(molecule: MoleculeObject): void {
    this.scene.remove(molecule.group);
    molecule.atoms.forEach(mesh => {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    });
    molecule.bonds.forEach(mesh => {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    });
    molecule.electronClouds.forEach(points => {
      points.geometry.dispose();
      if (points.material instanceof THREE.Material) {
        points.material.dispose();
      }
    });
  }

  getCurrentMolecule(): MoleculeObject | null {
    return this.currentMolecule;
  }

  getAtomMeshes(): THREE.Mesh[] {
    return this.currentMolecule?.atoms || [];
  }

  getAtomData(mesh: THREE.Mesh): AtomData | undefined {
    return this.currentMolecule?.atomDataMap.get(mesh);
  }

  animateElectronClouds(time: number): void {
    if (!this.currentMolecule) return;

    this.currentMolecule.electronClouds.forEach((cloud, idx) => {
      const offset = idx * 0.7;
      cloud.rotation.y = time * 0.15 + offset;
      cloud.rotation.x = Math.sin(time * 0.1 + offset) * 0.15;
      cloud.rotation.z = Math.cos(time * 0.08 + offset) * 0.1;

      const pulse = 1 + Math.sin(time * 1.5 + offset) * 0.05;
      cloud.scale.setScalar(pulse);
    });
  }

  highlightAtom(mesh: THREE.Mesh | null): void {
    if (!this.currentMolecule) return;

    this.currentMolecule.atoms.forEach(atom => {
      const material = atom.material as THREE.MeshStandardMaterial;
      const data = this.currentMolecule!.atomDataMap.get(atom);
      if (data) {
        if (atom === mesh) {
          material.emissive = new THREE.Color(data.color).multiplyScalar(0.5);
          material.emissiveIntensity = 0.8;
        } else {
          material.emissive = new THREE.Color(data.color).multiplyScalar(0.1);
          material.emissiveIntensity = 1;
        }
      }
    });
  }
}
