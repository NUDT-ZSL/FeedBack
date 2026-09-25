import * as THREE from 'three';

/**
 * 资源释放层：递归释放对象树上的几何体、材质与材质引用的纹理。
 * 原实现只释放 klineGroup 直接子节点的几何体/材质，
 * 挂在柱体上的边线（LineSegments 子节点）会泄漏，这里统一递归处理。
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse(obj => {
    const maybeMesh = obj as THREE.Mesh;
    if (maybeMesh.geometry) {
      maybeMesh.geometry.dispose();
    }
    const material = (maybeMesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  for (const key of Object.keys(material)) {
    const value = (material as unknown as Record<string, unknown>)[key];
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

export function disposeTexture(texture: THREE.Texture | null | undefined): void {
  if (texture) texture.dispose();
}
