import * as THREE from 'three';
import { BarMeshGroup } from './types';

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach(m => m.dispose());
  } else {
    material.dispose();
  }
}

function disposeObjectDeep(root: THREE.Object3D) {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) disposeMaterial(mesh.material);
  });
}

/**
 * Owns the kline group node and the live bar list.
 * Responsible for attaching bars to the scene graph and fully
 * releasing geometries/materials when bars are removed.
 */
export class BarCollection {
  readonly group = new THREE.Group();
  private bars: BarMeshGroup[] = [];

  get all(): readonly BarMeshGroup[] {
    return this.bars;
  }

  get count(): number {
    return this.bars.length;
  }

  replace(next: BarMeshGroup[]) {
    this.clear();
    next.forEach(bar => {
      this.group.add(bar.body);
      this.group.add(bar.wickTop);
      this.group.add(bar.wickBottom);
      this.group.add(bar.volumeMesh);
    });
    this.bars = next;
  }

  fadeOutAll() {
    this.bars.forEach(bar => {
      bar.targetOpacity = 0;
    });
  }

  clear() {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      disposeObjectDeep(child);
    }
    this.bars = [];
  }

  dispose() {
    this.clear();
  }
}
