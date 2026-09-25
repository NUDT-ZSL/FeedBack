import * as THREE from 'three';
import { BarMeshGroup } from './types';
import { disposeObject3D } from './resourceDisposer';

/**
 * 柱体生命周期层：唯一持有当前柱体列表与 klineGroup 场景组。
 * 负责把柱体网格挂入/移出场景，并在替换或销毁时释放全部 GPU 资源。
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

  /** 射线检测目标（柱体主体网格）。 */
  raycastTargets(): THREE.Mesh[] {
    return this.bars.map(b => b.body);
  }

  findByBody(mesh: THREE.Object3D): BarMeshGroup | undefined {
    return this.bars.find(b => b.body === mesh);
  }

  /** 用一批新柱体替换现有柱体，旧柱体资源被完整释放。 */
  replace(bars: BarMeshGroup[]): void {
    this.clear();
    this.bars = bars;
    for (const bar of bars) {
      this.group.add(bar.body);
      this.group.add(bar.wickTop);
      this.group.add(bar.wickBottom);
      this.group.add(bar.volumeMesh);
    }
  }

  /** 移除并释放当前所有柱体（含边线等子节点的几何体/材质）。 */
  clear(): void {
    for (const bar of this.bars) {
      disposeObject3D(bar.body);
      disposeObject3D(bar.wickTop);
      disposeObject3D(bar.wickBottom);
      disposeObject3D(bar.volumeMesh);
    }
    this.group.clear();
    this.bars = [];
  }
}
