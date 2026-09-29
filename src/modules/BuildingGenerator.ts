import * as THREE from 'three';
import type { BuildingParams, ComponentInfo, ComponentType, BIMMeshUserData } from '@/types/bim';
import { ComponentTypeColor } from '@/types/bim';
import { SceneManager } from '@/core/SceneManager';
import { AnimationHelper } from '@/utils/AnimationHelper';

const FLOOR_LABEL_HEIGHT = 0.12;

export class BuildingGenerator {
  private sceneManager: SceneManager;
  private animHelper: AnimationHelper;
  private lastParams: BuildingParams | null = null;
  private lastComponents: ComponentInfo[] = [];

  private matCache: Partial<Record<ComponentType, THREE.MeshStandardMaterial>> = {};
  private geoCache: Map<string, THREE.BoxGeometry> = new Map();

  constructor(sceneManager: SceneManager, animHelper: AnimationHelper) {
    this.sceneManager = sceneManager;
    this.animHelper = animHelper;
  }

  getLastComponents(): ComponentInfo[] {
    return this.lastComponents.slice();
  }

  setParams(params: Partial<BuildingParams>): void {
    if (this.lastParams) {
      this.lastParams = { ...this.lastParams, ...params };
    }
  }

  async generate(params: BuildingParams): Promise<ComponentInfo[]> {
    this.lastParams = { ...params };
    this.sceneManager.clearBuilding();
    this.lastComponents = [];
    this.animHelper.clearAllBlinks();

    const floors = Math.max(1, Math.min(50, Math.floor(params.floors)));
    const fh = Math.max(2, params.floorHeight);
    const cx = Math.max(2, Math.min(20, Math.floor(params.columnsX)));
    const cz = Math.max(2, Math.min(20, Math.floor(params.columnsZ)));
    const sx = Math.max(2, params.columnSpacingX);
    const sz = Math.max(2, params.columnSpacingZ);

    const totalW = sx * (cx - 1);
    const totalD = sz * (cz - 1);
    const originX = -totalW / 2;
    const originZ = -totalD / 2;

    const floorGroups: Array<{ meshes: THREE.Mesh[]; floorIndex: number }> = [];

    for (let f = 0; f < floors; f++) {
      const floorMeshes: THREE.Mesh[] = [];
      const baseY = f * fh;

      for (let i = 0; i < cx; i++) {
        for (let j = 0; j < cz; j++) {
          const x = originX + i * sx;
          const z = originZ + j * sz;
          const y = baseY + fh / 2;
          const info: ComponentInfo = {
            id: `C-${String(f + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}${String(j + 1).padStart(2, '0')}`,
            type: 'column',
            width: 0.5,
            height: fh,
            length: 0.5,
            material: 'Q355钢筋混凝土',
            position: { x, y, z }
          };
          const mesh = this.createMesh(info);
          floorMeshes.push(mesh);
          this.lastComponents.push(info);
        }
      }

      const slabInfo: ComponentInfo = {
        id: `S-${String(f + 1).padStart(2, '0')}`,
        type: 'slab',
        width: totalW + 1.0,
        height: 0.18,
        length: totalD + 1.0,
        material: 'C30现浇混凝土板',
        position: { x: 0, y: baseY + fh + 0.09, z: 0 }
      };
      floorMeshes.push(this.createMesh(slabInfo));
      this.lastComponents.push(slabInfo);

      for (let i = 0; i < cx; i++) {
        const x = originX + i * sx;
        const y = baseY + fh - 0.25;
        const info: ComponentInfo = {
          id: `BX-${String(f + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
          type: 'beam',
          width: 0.4,
          height: 0.5,
          length: totalD + 0.6,
          material: 'C35混凝土梁',
          position: { x, y, z: 0 }
        };
        floorMeshes.push(this.createMesh(info));
        this.lastComponents.push(info);
      }
      for (let j = 1; j < cz - 1; j++) {
        const z = originZ + j * sz;
        const y = baseY + fh - 0.25;
        const info: ComponentInfo = {
          id: `BZ-${String(f + 1).padStart(2, '0')}-${String(j + 1).padStart(2, '0')}`,
          type: 'beam',
          width: totalW + 0.6,
          height: 0.5,
          length: 0.35,
          material: 'C35混凝土梁',
          position: { x: 0, y, z }
        };
        floorMeshes.push(this.createMesh(info));
        this.lastComponents.push(info);
      }

      const wallThickness = 0.24;
      const wallMaterialName = params.wallMaterial || '混凝土空心砖';

      const wallY = baseY + fh / 2;
      const wallH = fh - 0.3;
      const wallTopY = baseY + 0.15 + wallH / 2;

      const northWall: ComponentInfo = {
        id: `WN-${String(f + 1).padStart(2, '0')}`,
        type: 'wall',
        width: totalW + 1.0,
        height: wallH,
        length: wallThickness,
        material: wallMaterialName,
        position: { x: 0, y: wallTopY, z: originZ - wallThickness / 2 }
      };
      floorMeshes.push(this.createMesh(northWall));
      this.lastComponents.push(northWall);

      const southWall: ComponentInfo = {
        id: `WS-${String(f + 1).padStart(2, '0')}`,
        type: 'wall',
        width: totalW + 1.0,
        height: wallH,
        length: wallThickness,
        material: wallMaterialName,
        position: { x: 0, y: wallTopY, z: originZ + totalD + wallThickness / 2 }
      };
      floorMeshes.push(this.createMesh(southWall));
      this.lastComponents.push(southWall);

      const westWall: ComponentInfo = {
        id: `WW-${String(f + 1).padStart(2, '0')}`,
        type: 'wall',
        width: wallThickness,
        height: wallH,
        length: totalD + 1.0,
        material: wallMaterialName,
        position: { x: originX - wallThickness / 2, y: wallTopY, z: 0 }
      };
      floorMeshes.push(this.createMesh(westWall));
      this.lastComponents.push(westWall);

      const eastWall: ComponentInfo = {
        id: `WE-${String(f + 1).padStart(2, '0')}`,
        type: 'wall',
        width: wallThickness,
        height: wallH,
        length: totalD + 1.0,
        material: wallMaterialName,
        position: { x: originX + totalW + wallThickness / 2, y: wallTopY, z: 0 }
      };
      floorMeshes.push(this.createMesh(eastWall));
      this.lastComponents.push(eastWall);

      const labelMesh = this.createFloorLabel(f + 1, baseY + fh / 2, originX - 1.4, originZ - 1.4);
      floorMeshes.push(labelMesh);
      void FLOOR_LABEL_HEIGHT;

      floorGroups.push({ meshes: floorMeshes, floorIndex: f });
    }

    floorGroups.forEach((fg, idx) => {
      fg.meshes.forEach((mesh) => {
        this.animHelper.bounceIn(mesh, idx * 300, 0.08);
      });
    });

    const allMeshes: THREE.Mesh[] = [];
    floorGroups.forEach((fg) => allMeshes.push(...fg.meshes));
    this.sceneManager.addBuildingMeshes(allMeshes);

    return this.lastComponents.slice();
  }

  private getOrCreateGeo(key: string, w: number, h: number, d: number): THREE.BoxGeometry {
    let geo = this.geoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      this.geoCache.set(key, geo);
    }
    return geo;
  }

  private getOrCreateMaterial(type: ComponentType): THREE.MeshStandardMaterial {
    if (this.matCache[type]) return this.matCache[type]!;
    const color = ComponentTypeColor[type];
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: type === 'slab' ? 0.85 : 0.7,
      metalness: type === 'column' || type === 'beam' ? 0.05 : 0.0,
      transparent: type === 'slab' || type === 'wall',
      opacity: type === 'slab' ? 0.55 : type === 'wall' ? 0.45 : 1.0,
      side: THREE.DoubleSide,
      emissive: 0x000000,
      emissiveIntensity: 0
    });
    this.matCache[type] = mat;
    return mat;
  }

  private createMesh(info: ComponentInfo): THREE.Mesh {
    const key = `${info.type}:${info.width}:${info.height}:${info.length}`;
    const geo = this.getOrCreateGeo(key, info.width, info.height, info.length);
    const mat = this.getOrCreateMaterial(info.type);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(info.position.x, info.position.y, info.position.z);
    mesh.castShadow = info.type !== 'slab';
    mesh.receiveShadow = true;
    const ud: BIMMeshUserData = {
      componentInfo: info,
      originalColor: ComponentTypeColor[info.type],
      originalEmissive: 0x000000,
      originalEmissiveIntensity: 0
    };
    mesh.userData = ud;
    return mesh;
  }

  private createFloorLabel(
    floorNum: number,
    yPos: number,
    xPos: number,
    zPos: number
  ): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(79,195,247,0.92)');
    grad.addColorStop(1, 'rgba(126,87,194,0.92)');
    ctx.fillStyle = grad;
    roundRect(ctx, 8, 24, 240, 80, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.fillText(`F${floorNum}`, canvas.width / 2, canvas.height / 2 + 4);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false
    });
    const geo = new THREE.PlaneGeometry(3.2, 1.6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = Math.PI / 4;
    mesh.position.set(xPos, yPos, zPos);
    mesh.renderOrder = 999;
    (mesh.userData as BIMMeshUserData).componentInfo = {
      id: `LBL-F${floorNum}`,
      type: 'slab',
      width: 0,
      height: 0,
      length: 0,
      material: '标签',
      position: { x: xPos, y: yPos, z: zPos }
    };
    return mesh;
  }

  getMeshByComponentId(id: string): THREE.Mesh | null {
    const group = this.sceneManager.buildingGroup;
    for (const child of group.children) {
      if ((child as any).isMesh) {
        const mesh = child as THREE.Mesh;
        const ud = mesh.userData as BIMMeshUserData | undefined;
        if (ud?.componentInfo?.id === id) return mesh;
      }
    }
    return null;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
