import * as THREE from 'three';
import type { ComponentInfo, CollisionResult, BIMMeshUserData } from '@/types/bim';
import { SceneManager } from '@/core/SceneManager';
import { AnimationHelper } from '@/utils/AnimationHelper';

export class CollisionDetector {
  private sceneManager: SceneManager;
  private animHelper: AnimationHelper;
  private tmpBoxA = new THREE.Box3();
  private tmpBoxB = new THREE.Box3();
  private tmpSize = new THREE.Vector3();
  private results: CollisionResult[] = [];

  private onResultCallbacks: Set<(r: CollisionResult) => void> = new Set();

  constructor(sceneManager: SceneManager, animHelper: AnimationHelper) {
    this.sceneManager = sceneManager;
    this.animHelper = animHelper;
  }

  getResults(): CollisionResult[] {
    return this.results.slice();
  }

  onResult(callback: (r: CollisionResult) => void): () => void {
    this.onResultCallbacks.add(callback);
    return () => this.onResultCallbacks.delete(callback);
  }

  clearResults(): void {
    this.results = [];
    this.animHelper.clearAllBlinks();
  }

  detect(a: THREE.Mesh, b: THREE.Mesh): CollisionResult {
    const t0 = performance.now();

    a.updateMatrixWorld(true);
    b.updateMatrixWorld(true);

    this.tmpBoxA.setFromObject(a);
    this.tmpBoxB.setFromObject(b);

    const intersects = this.tmpBoxA.intersectsBox(this.tmpBoxB);
    let overlapPct = 0;
    let overlapVol = 0;

    if (intersects) {
      overlapVol = this._overlapVolume(this.tmpBoxA, this.tmpBoxB);
      this.tmpSize.copy(this.tmpBoxA.max).sub(this.tmpBoxA.min);
      const volA = Math.max(1e-6, this.tmpSize.x * this.tmpSize.y * this.tmpSize.z);
      this.tmpSize.copy(this.tmpBoxB.max).sub(this.tmpBoxB.min);
      const volB = Math.max(1e-6, this.tmpSize.x * this.tmpSize.y * this.tmpSize.z);
      overlapPct = (overlapVol / Math.min(volA, volB)) * 100;
    }

    const udA = a.userData as BIMMeshUserData;
    const udB = b.userData as BIMMeshUserData;

    const thumbA = this._renderThumbnail(a);
    const thumbB = this._renderThumbnail(b);

    const result: CollisionResult = {
      id: `COL-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
      componentA: udA.componentInfo,
      componentB: udB.componentInfo,
      isColliding: intersects,
      overlapVolumePercent: Number(overlapPct.toFixed(2)),
      thumbnailA: thumbA,
      thumbnailB: thumbB,
      timestamp: Date.now()
    };

    this.results.unshift(result);
    if (this.results.length > 50) this.results.length = 50;

    if (intersects) {
      this.highlightCollision(a, b);
    } else {
      this.highlightSafe(a, b);
    }

    void t0;
    this.onResultCallbacks.forEach((cb) => cb(result));
    return result;
  }

  batchDetect(pairs: Array<[THREE.Mesh, THREE.Mesh]>): CollisionResult[] {
    return pairs.map(([a, b]) => this.detect(a, b));
  }

  private _overlapVolume(a: THREE.Box3, b: THREE.Box3): number {
    const minX = Math.max(a.min.x, b.min.x);
    const maxX = Math.min(a.max.x, b.max.x);
    const minY = Math.max(a.min.y, b.min.y);
    const maxY = Math.min(a.max.y, b.max.y);
    const minZ = Math.max(a.min.z, b.min.z);
    const maxZ = Math.min(a.max.z, b.max.z);

    const dx = Math.max(0, maxX - minX);
    const dy = Math.max(0, maxY - minY);
    const dz = Math.max(0, maxZ - minZ);
    return dx * dy * dz;
  }

  computeAABB(mesh: THREE.Mesh): THREE.Box3 {
    mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(mesh);
  }

  highlightCollision(
    a: THREE.Mesh,
    b: THREE.Mesh,
    durationMs: number = 2500
  ): void {
    this.animHelper.blinkRed(a, durationMs);
    this.animHelper.blinkRed(b, durationMs);
  }

  highlightSafe(a: THREE.Mesh, b: THREE.Mesh): void {
    this.animHelper.safeFlash(a, 900);
    this.animHelper.safeFlash(b, 900);
  }

  clearHighlights(): void {
    this.animHelper.clearAllBlinks();
  }

  focusComponent(component: ComponentInfo): THREE.Mesh | null {
    const group = this.sceneManager.buildingGroup;
    for (const child of group.children) {
      if (!(child as any).isMesh) continue;
      const mesh = child as THREE.Mesh;
      const ud = mesh.userData as BIMMeshUserData | undefined;
      if (ud?.componentInfo?.id === component.id) {
        this.animHelper.highlightPulse(mesh);
        const camera = this.sceneManager.camera;
        const ctrl = this.sceneManager.controls;
        const target = new THREE.Vector3(
          component.position.x,
          component.position.y,
          component.position.z
        );
        const dir = new THREE.Vector3().subVectors(camera.position, ctrl.target);
        const newPos = target.clone().add(dir);
        camera.position.copy(newPos);
        ctrl.target.copy(target);
        ctrl.update();
        return mesh;
      }
    }
    return null;
  }

  private _renderThumbnail(mesh: THREE.Mesh): string {
    try {
      const origScene = this.sceneManager.scene;
      const camera = this.sceneManager.camera;

      const miniScene = new THREE.Scene();
      miniScene.background = new THREE.Color(0x16213E);

      const cloneMat = (mesh.material as THREE.MeshStandardMaterial).clone();
      cloneMat.emissive = new THREE.Color(0x4FC3F7);
      cloneMat.emissiveIntensity = 0.35;
      cloneMat.transparent = false;
      cloneMat.opacity = 1;
      const cloneGeo = (mesh.geometry as THREE.BoxGeometry).clone();
      const clone = new THREE.Mesh(cloneGeo, cloneMat);
      clone.position.copy(mesh.position);
      clone.scale.copy(mesh.scale);
      clone.quaternion.copy(mesh.quaternion);

      const box = new THREE.Box3().setFromObject(clone);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);

      clone.position.sub(center);

      const borderGeo = new THREE.BoxGeometry(size.x * 1.12, size.y * 1.12, size.z * 1.12);
      const borderEdges = new THREE.EdgesGeometry(borderGeo);
      const borderLine = new THREE.LineSegments(
        borderEdges,
        new THREE.LineBasicMaterial({ color: 0x4FC3F7, transparent: true, opacity: 0.8 })
      );
      miniScene.add(clone);
      miniScene.add(borderLine);

      const miniCam = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
      const camDist = maxDim * 2.6;
      miniCam.position.set(camDist * 0.75, camDist * 0.6, camDist * 0.9);
      miniCam.lookAt(0, 0, 0);

      const amb = new THREE.AmbientLight(0xffffff, 0.6);
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 8, 6);
      miniScene.add(amb, dir);

      const renderer = this.sceneManager.renderer;
      const vp = renderer.getViewport(new THREE.Vector4());
      const origSize = new THREE.Vector2();
      renderer.getSize(origSize);
      const thumbSize = 96;

      const rt = new THREE.WebGLRenderTarget(thumbSize, thumbSize, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace
      });
      renderer.setRenderTarget(rt);
      renderer.setViewport(0, 0, thumbSize, thumbSize);
      renderer.clear();
      renderer.render(miniScene, miniCam);
      renderer.setRenderTarget(null);
      renderer.setViewport(vp);
      renderer.setSize(origSize.x, origSize.y, false);

      const pixelBuffer = new Uint8Array(thumbSize * thumbSize * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, thumbSize, thumbSize, pixelBuffer);

      const cvs = document.createElement('canvas');
      cvs.width = thumbSize;
      cvs.height = thumbSize;
      const cctx = cvs.getContext('2d')!;
      const imgData = cctx.createImageData(thumbSize, thumbSize);
      for (let i = 0; i < pixelBuffer.length; i += 4) {
        const y = Math.floor(i / 4 / thumbSize);
        const dst = (thumbSize - 1 - y) * thumbSize * 4 + (i % (thumbSize * 4));
        imgData.data[dst] = pixelBuffer[i];
        imgData.data[dst + 1] = pixelBuffer[i + 1];
        imgData.data[dst + 2] = pixelBuffer[i + 2];
        imgData.data[dst + 3] = 255;
      }
      cctx.putImageData(imgData, 0, 0);

      rt.dispose();
      cloneGeo.dispose();
      cloneMat.dispose();
      borderGeo.dispose();
      borderEdges.dispose();
      (borderLine.material as THREE.Material).dispose();

      void origScene; void camera;
      return cvs.toDataURL('image/png');
    } catch (e) {
      return this._fallbackThumbnail(mesh);
    }
  }

  private _fallbackThumbnail(mesh: THREE.Mesh): string {
    const ud = mesh.userData as BIMMeshUserData;
    const info = ud.componentInfo;
    const cvs = document.createElement('canvas');
    cvs.width = 96;
    cvs.height = 96;
    const ctx = cvs.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 96, 96);
    grad.addColorStop(0, '#0F3460');
    grad.addColorStop(1, '#16213E');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 96, 96);
    ctx.strokeStyle = '#4FC3F7';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 18, 72, 60);
    ctx.fillStyle = '#4FC3F7';
    ctx.globalAlpha = 0.35;
    ctx.fillRect(12, 18, 72, 60);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(info.id.slice(0, 8), 48, 56);
    return cvs.toDataURL('image/png');
  }
}
