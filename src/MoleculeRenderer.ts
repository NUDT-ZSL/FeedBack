import * as THREE from 'three';
import { ELEMENT_RADIUS, ELEMENT_COLORS, ELEMENT_NAMES } from './Molecule';

export interface Measurement {
  id: number;
  type: 'distance' | 'angle';
  atomIndices: number[];
  value: number;
  line?: THREE.Line;
  textSprite?: THREE.Sprite;
}

export class MoleculeRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private highlightedAtom: THREE.Mesh | null = null;
  private originalMaterials: Map<THREE.Mesh, THREE.Material> = new Map();
  private measurements: Measurement[] = [];
  private measurementIdCounter = 0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    container: HTMLElement
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.container = container;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  public createAtom(element: string, position: THREE.Vector3, index: number): THREE.Mesh {
    const radius = ELEMENT_RADIUS[element] || 0.35;
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const color = ELEMENT_COLORS[element] || 0xffffff;
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.4,
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    sphere.userData = { atomIndex: index, element };
    return sphere;
  }

  public createBond(
    start: THREE.Vector3,
    end: THREE.Vector3,
    order: number
  ): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    if (order === 1) {
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
      meshes.push(cylinder);
    } else if (order === 2) {
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
        meshes.push(cylinder);
      }
    }

    return meshes;
  }

  public updateMouse(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  public getIntersectedAtom(atomMeshes: THREE.Mesh[]): THREE.Mesh | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(atomMeshes);
    if (intersects.length > 0) {
      return intersects[0].object as THREE.Mesh;
    }
    return null;
  }

  public highlightAtom(atomMesh: THREE.Mesh | null): void {
    if (this.highlightedAtom === atomMesh) return;

    if (this.highlightedAtom) {
      const originalMat = this.originalMaterials.get(this.highlightedAtom);
      if (originalMat) {
        this.highlightedAtom.material = originalMat;
      }
      this.originalMaterials.delete(this.highlightedAtom);
    }

    this.highlightedAtom = atomMesh;

    if (atomMesh) {
      this.originalMaterials.set(atomMesh, atomMesh.material as THREE.Material);
      const highlightMat = new THREE.MeshStandardMaterial({
        color: 0x64b5f6,
        emissive: 0x64b5f6,
        emissiveIntensity: 0.4,
        metalness: 0.3,
        roughness: 0.4,
      });
      atomMesh.material = highlightMat;
    }
  }

  public addDistanceMeasurement(
    atom1WorldPos: THREE.Vector3,
    atom2WorldPos: THREE.Vector3,
    value: number
  ): Measurement {
    const points = [atom1WorldPos.clone(), atom2WorldPos.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    const material = new THREE.LineDashedMaterial({
      color: 0x64b5f6,
      dashSize: 0.1,
      gapSize: 0.05,
      linewidth: 2,
    });
    
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.scene.add(line);

    const midpoint = new THREE.Vector3()
      .addVectors(atom1WorldPos, atom2WorldPos)
      .multiplyScalar(0.5);
    
    const textSprite = this.createTextSprite(
      `${value.toFixed(2)} Å`,
      midpoint
    );

    const measurement: Measurement = {
      id: ++this.measurementIdCounter,
      type: 'distance',
      atomIndices: [],
      value,
      line,
      textSprite,
    };

    this.measurements.push(measurement);
    return measurement;
  }

  public addAngleMeasurement(
    atom1Pos: THREE.Vector3,
    centerPos: THREE.Vector3,
    atom2Pos: THREE.Vector3,
    angleValue: number,
    distance1: number,
    distance2: number
  ): Measurement {
    const points1 = [atom1Pos.clone(), centerPos.clone()];
    const points2 = [centerPos.clone(), atom2Pos.clone()];
    
    const geometry1 = new THREE.BufferGeometry().setFromPoints(points1);
    const geometry2 = new THREE.BufferGeometry().setFromPoints(points2);
    
    const material = new THREE.LineDashedMaterial({
      color: 0xff9800,
      dashSize: 0.1,
      gapSize: 0.05,
    });
    
    const line1 = new THREE.Line(geometry1, material);
    const line2 = new THREE.Line(geometry2, material);
    line1.computeLineDistances();
    line2.computeLineDistances();
    
    const group = new THREE.Group();
    group.add(line1);
    group.add(line2);
    this.scene.add(group);

    const midpoint = centerPos.clone();
    const v1 = new THREE.Vector3().subVectors(atom1Pos, centerPos).normalize();
    const v2 = new THREE.Vector3().subVectors(atom2Pos, centerPos).normalize();
    const bisector = new THREE.Vector3().addVectors(v1, v2).normalize();
    const labelPos = centerPos.clone().add(bisector.multiplyScalar(0.5));
    
    const textSprite = this.createTextSprite(
      `${angleValue.toFixed(2)}°`,
      labelPos
    );

    const measurement: Measurement = {
      id: ++this.measurementIdCounter,
      type: 'angle',
      atomIndices: [],
      value: angleValue,
      line: line1,
      textSprite,
    };

    this.measurements.push(measurement);
    return measurement;
  }

  private createTextSprite(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 128;
    
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    context.font = 'bold 32px Arial';
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.8, 0.4, 1);
    sprite.position.copy(position);
    this.scene.add(sprite);
    
    return sprite;
  }

  public removeMeasurement(id: number): void {
    const index = this.measurements.findIndex((m) => m.id === id);
    if (index !== -1) {
      const measurement = this.measurements[index];
      if (measurement.line) {
        this.scene.remove(measurement.line);
        measurement.line.geometry.dispose();
        (measurement.line.material as THREE.Material).dispose();
      }
      if (measurement.textSprite) {
        this.scene.remove(measurement.textSprite);
        (measurement.textSprite.material as THREE.Material).dispose();
      }
      this.measurements.splice(index, 1);
    }
  }

  public clearMeasurements(): void {
    this.measurements.forEach((m) => {
      if (m.line) {
        this.scene.remove(m.line);
        m.line.geometry.dispose();
        (m.line.material as THREE.Material).dispose();
      }
      if (m.textSprite) {
        this.scene.remove(m.textSprite);
        (m.textSprite.material as THREE.Material).dispose();
      }
    });
    this.measurements = [];
    this.measurementIdCounter = 0;
  }

  public getMeasurements(): Measurement[] {
    return this.measurements;
  }

  public updateHighlightPosition(atomMesh: THREE.Mesh): void {
  }
}
