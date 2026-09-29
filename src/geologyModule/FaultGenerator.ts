import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

export type FaultType = 'normal' | 'reverse' | 'strike-slip';

export interface FaultParams {
  type: FaultType;
  dip: number;
  strike: number;
  displacement: number;
}

export interface FaultMeshData {
  mesh: THREE.Group;
  params: FaultParams;
}

const FAULT_COLORS: Record<FaultType, number> = {
  normal: 0xff3355,
  reverse: 0x3366ff,
  'strike-slip': 0x33dd66
};

const FAULT_SIZE = 120;
const FAULT_DEPTH = 80;

export class FaultGenerator {
  private currentMesh: THREE.Group | null = null;
  private currentParams: FaultParams;

  constructor() {
    this.currentParams = {
      type: 'normal',
      dip: 60,
      strike: 0,
      displacement: 60
    };
  }

  public generate(params: FaultParams): FaultMeshData {
    const group = new THREE.Group();

    const faultPlane = this.createFaultPlane(params);
    const upperBlock = this.createBlock(params, true);
    const lowerBlock = this.createBlock(params, false);

    group.add(faultPlane);
    group.add(upperBlock);
    group.add(lowerBlock);

    this.applyStrikeRotation(group, params.strike);

    this.currentMesh = group;
    this.currentParams = { ...params };

    return { mesh: group, params: { ...params } };
  }

  private createFaultPlane(params: FaultParams): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(FAULT_SIZE, FAULT_DEPTH, 20, 20);
    const color = FAULT_COLORS[params.type];

    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const t = (y + FAULT_DEPTH / 2) / FAULT_DEPTH;
      const c = new THREE.Color(color);
      c.offsetHSL(0, 0, (t - 0.5) * 0.3);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = THREE.MathUtils.degToRad(90 - params.dip);
    mesh.position.y = -FAULT_DEPTH / 2;

    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6
    });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    wireframe.rotation.x = mesh.rotation.x;
    wireframe.position.y = mesh.position.y;
    mesh.add(wireframe);

    return mesh;
  }

  private createBlock(params: FaultParams, isUpper: boolean): THREE.Mesh {
    const thickness = 10;
    const geometry = new THREE.BoxGeometry(FAULT_SIZE * 0.9, FAULT_DEPTH * 0.9, thickness);

    const color = FAULT_COLORS[params.type];
    const blockColor = new THREE.Color(color);
    blockColor.offsetHSL(0, 0, isUpper ? -0.15 : 0.15);

    const material = new THREE.MeshStandardMaterial({
      color: blockColor,
      transparent: true,
      opacity: 0.55,
      roughness: 0.85,
      metalness: 0.05
    });

    const mesh = new THREE.Mesh(geometry, material);

    const dipRad = THREE.MathUtils.degToRad(params.dip);
    let offsetX = 0;
    let offsetY = 0;
    let offsetZ = 0;

    const halfDisp = params.displacement / 2;

    switch (params.type) {
      case 'normal':
        offsetY = isUpper ? -halfDisp : halfDisp;
        offsetX = isUpper ? Math.cos(dipRad) * halfDisp * 0.5 : -Math.cos(dipRad) * halfDisp * 0.5;
        offsetZ = isUpper ? -thickness / 2 - 2 : thickness / 2 + 2;
        break;
      case 'reverse':
        offsetY = isUpper ? halfDisp : -halfDisp;
        offsetX = isUpper ? -Math.cos(dipRad) * halfDisp * 0.5 : Math.cos(dipRad) * halfDisp * 0.5;
        offsetZ = isUpper ? -thickness / 2 - 2 : thickness / 2 + 2;
        break;
      case 'strike-slip':
        offsetX = isUpper ? halfDisp : -halfDisp;
        offsetZ = isUpper ? -thickness / 2 - 2 : thickness / 2 + 2;
        offsetY = -FAULT_DEPTH / 2;
        break;
    }

    mesh.position.set(offsetX, offsetY - FAULT_DEPTH / 4, offsetZ);
    mesh.rotation.x = THREE.MathUtils.degToRad(90 - params.dip);

    return mesh;
  }

  private applyStrikeRotation(group: THREE.Group, strike: number): void {
    group.rotation.y = THREE.MathUtils.degToRad(strike);
  }

  public animateTransition(newParams: FaultParams, scene: THREE.Scene): THREE.Group {
    const oldMesh = this.currentMesh;
    const { mesh: newMesh } = this.generate(newParams);

    newMesh.rotation.y = THREE.MathUtils.degToRad(newParams.strike) - Math.PI * 2;
    newMesh.scale.setScalar(0.1);
    scene.add(newMesh);

    if (oldMesh) {
      new TWEEN.Tween(oldMesh.scale)
        .to({ x: 0.1, y: 0.1, z: 0.1 }, 500)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onComplete(() => {
          scene.remove(oldMesh);
          this.disposeGroup(oldMesh);
        })
        .start();
    }

    new TWEEN.Tween(newMesh.rotation)
      .to({ y: THREE.MathUtils.degToRad(newParams.strike) }, 500)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .start();

    new TWEEN.Tween(newMesh.scale)
      .to({ x: 1, y: 1, z: 1 }, 500)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .start();

    this.currentMesh = newMesh;
    this.currentParams = { ...newParams };

    return newMesh;
  }

  public animateParamsUpdate(newParams: FaultParams, scene: THREE.Scene): THREE.Group {
    if (newParams.type !== this.currentParams.type) {
      return this.animateTransition(newParams, scene);
    }

    const oldMesh = this.currentMesh;
    const { mesh: newMesh } = this.generate(newParams);
    newMesh.scale.setScalar(0.95);
    scene.add(newMesh);

    new TWEEN.Tween(newMesh.scale)
      .to({ x: 1, y: 1, z: 1 }, 300)
      .easing(TWEEN.Easing.Quadratic.Out)
      .start();

    if (oldMesh) {
      new TWEEN.Tween(oldMesh.scale)
        .to({ x: 0.95, y: 0.95, z: 0.95 }, 300)
        .easing(TWEEN.Easing.Quadratic.Out)
        .onComplete(() => {
          scene.remove(oldMesh);
          this.disposeGroup(oldMesh);
        })
        .start();
    }

    this.currentMesh = newMesh;
    this.currentParams = { ...newParams };

    return newMesh;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      } else if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }

  public getCurrentMesh(): THREE.Group | null {
    return this.currentMesh;
  }

  public getCurrentParams(): FaultParams {
    return { ...this.currentParams };
  }

  public static getColor(type: FaultType): THREE.Color {
    return new THREE.Color(FAULT_COLORS[type]);
  }
}
