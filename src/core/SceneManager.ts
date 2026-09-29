import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ComponentInfo, BIMMeshUserData } from '@/types/bim';

export type InteractionMode = 'orbit' | 'pan' | 'zoom';
type PickCallback = (info: ComponentInfo | null, mesh: THREE.Mesh | null) => void;
type FrameCallback = (dt: number) => void;

export class SceneManager {
  private static _instance: SceneManager | null = null;

  private _container: HTMLElement | null = null;
  private _scene!: THREE.Scene;
  private _camera!: THREE.PerspectiveCamera;
  private _renderer!: THREE.WebGLRenderer;
  private _controls!: OrbitControls;
  private _buildingGroup!: THREE.Group;
  private _gridGroup!: THREE.Group;
  private _raycaster!: THREE.Raycaster;
  private _mouseNDC!: THREE.Vector2;

  private _pickCallbacks: Set<PickCallback> = new Set();
  private _frameCallbacks: Set<FrameCallback> = new Set();

  private _animFrameId: number = 0;
  private _lastTime: number = 0;
  private _fpsCounter: { frames: number; lastTime: number; current: number } = { frames: 0, lastTime: 0, current: 0 };
  private _isRunning: boolean = false;
  private _defaultCameraPos = new THREE.Vector3(25, 22, 35);
  private _defaultTarget = new THREE.Vector3(0, 8, 0);

  private constructor() {}

  static getInstance(): SceneManager {
    if (!SceneManager._instance) SceneManager._instance = new SceneManager();
    return SceneManager._instance;
  }

  get scene(): THREE.Scene { return this._scene; }
  get camera(): THREE.PerspectiveCamera { return this._camera; }
  get renderer(): THREE.WebGLRenderer { return this._renderer; }
  get controls(): OrbitControls { return this._controls; }
  get buildingGroup(): THREE.Group { return this._buildingGroup; }
  get fps(): number { return this._fpsCounter.current; }

  async init(
    container: HTMLElement,
    onProgress?: (p: number) => void
  ): Promise<void> {
    this._container = container;
    const canvas = container.querySelector<HTMLCanvasElement>('#scene-canvas')!;
    onProgress?.(5);

    this._initScene();
    onProgress?.(20);
    this._initCamera(canvas);
    onProgress?.(35);
    this._initRenderer(canvas);
    onProgress?.(55);
    this._initControls();
    onProgress?.(70);
    this._initLightingAndGround();
    onProgress?.(85);
    this._initGrid();
    onProgress?.(95);

    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Line.threshold = 0.1;
    this._mouseNDC = new THREE.Vector2();

    this._bindResize();
    this._bindEvents();

    this.resize();
    this._resetCameraInternal();
    onProgress?.(100);
  }

  private _initScene(): void {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1A1A2E);
    this._scene.fog = new THREE.Fog(0x1A1A2E, 60, 220);

    this._buildingGroup = new THREE.Group();
    this._buildingGroup.name = 'BuildingRoot';
    this._scene.add(this._buildingGroup);

    this._gridGroup = new THREE.Group();
    this._gridGroup.name = 'GridRoot';
    this._scene.add(this._gridGroup);
  }

  private _initCamera(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  }

  private _initRenderer(canvas: HTMLCanvasElement): void {
    this._renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.1;
  }

  private _initControls(): void {
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.rotateSpeed = 0.15;
    this._controls.zoomSpeed = 0.9;
    this._controls.panSpeed = 1.0;
    this._controls.minDistance = 8;
    this._controls.maxDistance = 120;
    this._controls.maxPolarAngle = Math.PI * 0.49;
    this._controls.minPolarAngle = Math.PI * 0.05;
    this._controls.screenSpacePanning = true;
  }

  private _initLightingAndGround(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    this._scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.88);
    dir.position.set(28, 42, 20);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -60;
    dir.shadow.camera.right = 60;
    dir.shadow.camera.top = 60;
    dir.shadow.camera.bottom = -60;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 180;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 0.02;
    this._scene.add(dir);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.32);
    fill.position.set(-22, 18, -16);
    this._scene.add(fill);

    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0f1426,
      roughness: 0.95,
      metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this._scene.add(ground);
  }

  private _initGrid(): void {
    const size = 180;
    const div = 36;
    const gridHelper = new THREE.GridHelper(size, div, 0x3a4766, 0x26324a);
    (gridHelper.material as THREE.Material).opacity = 0.55;
    (gridHelper.material as THREE.Material).transparent = true;
    this._gridGroup.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(4);
    axesHelper.position.y = 0.01;
    this._gridGroup.add(axesHelper);

    const dotGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x4FC3F7, transparent: true, opacity: 0.35 });
    const step = size / div;
    const half = size / 2;
    const dots: THREE.InstancedMesh | null = null;
    void dots;
    for (let i = 0; i <= div; i++) {
      for (let j = 0; j <= div; j++) {
        if (i % 2 !== 0 || j % 2 !== 0) continue;
        const x = -half + i * step;
        const z = -half + j * step;
        if (Math.abs(x) < 0.01 && Math.abs(z) < 0.01) continue;
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(x, 0.02, z);
        this._gridGroup.add(dot);
      }
    }
    dotGeo.dispose();
  }

  private _bindResize(): void {
    window.addEventListener('resize', () => this.resize());
  }

  private _bindEvents(): void {
    const canvas = this._renderer.domElement;
    canvas.addEventListener('click', (e) => this._handleClick(e));
    canvas.addEventListener('pointermove', (e) => this._handlePointerMove(e));
  }

  private _handleClick(e: MouseEvent): void {
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const result = this._doPick();
    this._pickCallbacks.forEach((cb) => cb(result.info, result.mesh));
  }

  private _handlePointerMove(e: MouseEvent): void {
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._mouseNDC, this._camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    this._raycaster.ray.intersectPlane(plane, hit);
    (window as any).__BIMCursor = hit;
  }

  private _doPick(): { info: ComponentInfo | null; mesh: THREE.Mesh | null } {
    this._raycaster.setFromCamera(this._mouseNDC, this._camera);
    const intersects = this._raycaster.intersectObjects(
      this._buildingGroup.children,
      true
    );
    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !(obj as any).isMesh) obj = obj.parent;
      const mesh = obj as THREE.Mesh | null;
      const ud = mesh?.userData as BIMMeshUserData | undefined;
      if (mesh && ud?.componentInfo) {
        return { info: ud.componentInfo, mesh };
      }
    }
    return { info: null, mesh: null };
  }

  raycast(screenX: number, screenY: number): THREE.Intersection[] {
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._mouseNDC.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this._mouseNDC.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouseNDC, this._camera);
    return this._raycaster.intersectObjects(this._buildingGroup.children, true);
  }

  getBuildingMeshesInRect(
    left: number, top: number, right: number, bottom: number
  ): THREE.Mesh[] {
    const rect = this._renderer.domElement.getBoundingClientRect();
    const ndc = (sx: number, sy: number) => new THREE.Vector2(
      ((sx - rect.left) / rect.width) * 2 - 1,
      -((sy - rect.top) / rect.height) * 2 + 1
    );

    const result: THREE.Mesh[] = [];
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();

    const corners = [
      ndc(left, top),
      ndc(right, top),
      ndc(right, bottom),
      ndc(left, bottom)
    ];

    const minX = Math.min(...corners.map(c => c.x));
    const maxX = Math.max(...corners.map(c => c.x));
    const minY = Math.min(...corners.map(c => c.y));
    const maxY = Math.max(...corners.map(c => c.y));

    void minX; void maxX;

    this._buildingGroup.updateMatrixWorld(true);
    const tmpBox = new THREE.Box3();
    const center = new THREE.Vector3();
    const projPt = new THREE.Vector3();

    this._buildingGroup.traverse((obj) => {
      if (!(obj as any).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const ud = mesh.userData as BIMMeshUserData | undefined;
      if (!ud?.componentInfo) return;

      tmpBox.setFromObject(mesh);
      tmpBox.getCenter(center);
      projPt.copy(center).project(this._camera);

      if (
        projPt.x >= minX && projPt.x <= maxX &&
        projPt.y >= minY && projPt.y <= maxY &&
        projPt.z >= -1 && projPt.z <= 1
      ) {
        result.push(mesh);
      }
    });

    if (result.length === 0) {
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      const hits = this.raycast(midX, midY);
      for (const h of hits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj && !(obj as any).isMesh) obj = obj.parent;
        const mesh = obj as THREE.Mesh | null;
        if (mesh && (mesh.userData as BIMMeshUserData)?.componentInfo) {
          if (!result.includes(mesh)) result.push(mesh);
          break;
        }
      }
    }

    void frustum; void projScreenMatrix;
    return result;
  }

  setInteractionMode(mode: InteractionMode): void {
    switch (mode) {
      case 'orbit':
        this._controls.enableRotate = true;
        this._controls.enablePan = false;
        this._controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        break;
      case 'pan':
        this._controls.enablePan = true;
        this._controls.enableRotate = false;
        this._controls.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        break;
      case 'zoom':
        this._controls.enableRotate = true;
        this._controls.enablePan = true;
        this._controls.mouseButtons = {
          LEFT: THREE.MOUSE.DOLLY,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        };
        break;
    }
  }

  addBuildingMeshes(meshes: THREE.Mesh[]): void {
    meshes.forEach((m) => this._buildingGroup.add(m));
    this._updateCameraTarget();
  }

  clearBuilding(): void {
    const toRemove: THREE.Object3D[] = [];
    this._buildingGroup.traverse((obj) => {
      if (obj !== this._buildingGroup && obj.parent === this._buildingGroup) {
        toRemove.push(obj);
      }
    });
    toRemove.forEach((obj) => {
      this._buildingGroup.remove(obj);
      if ((obj as any).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      }
    });
  }

  private _updateCameraTarget(): void {
    if (this._buildingGroup.children.length === 0) return;
    const box = new THREE.Box3().setFromObject(this._buildingGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.4;
    const dir = new THREE.Vector3(1, 0.75, 1.4).normalize();

    this._defaultCameraPos.copy(dir).multiplyScalar(dist).add(center);
    this._defaultTarget.copy(center).setY(center.y + size.y * 0.3);

    const fit = Math.max(28, dist);
    this._controls.minDistance = Math.max(6, fit * 0.25);
    this._controls.maxDistance = Math.max(120, fit * 5);
  }

  resetCamera(): void {
    this._resetCameraInternal();
  }

  private _resetCameraInternal(): void {
    this._camera.position.copy(this._defaultCameraPos);
    this._controls.target.copy(this._defaultTarget);
    this._controls.update();
  }

  onPick(callback: PickCallback): () => void {
    this._pickCallbacks.add(callback);
    return () => this._pickCallbacks.delete(callback);
  }

  onFrame(callback: FrameCallback): () => void {
    this._frameCallbacks.add(callback);
    return () => this._frameCallbacks.delete(callback);
  }

  startLoop(): void {
    if (this._isRunning) return;
    this._isRunning = true;
    this._lastTime = performance.now();
    this._fpsCounter.lastTime = this._lastTime;
    const tick = () => {
      if (!this._isRunning) return;
      this._animFrameId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - this._lastTime) / 1000;
      this._lastTime = now;

      this._fpsCounter.frames++;
      if (now - this._fpsCounter.lastTime >= 500) {
        this._fpsCounter.current = Math.round(
          (this._fpsCounter.frames * 1000) / (now - this._fpsCounter.lastTime)
        );
        this._fpsCounter.frames = 0;
        this._fpsCounter.lastTime = now;
      }

      this._frameCallbacks.forEach((cb) => cb(dt));
      this._controls.update();
      this._renderer.render(this._scene, this._camera);
    };
    tick();
  }

  stopLoop(): void {
    this._isRunning = false;
    cancelAnimationFrame(this._animFrameId);
  }

  render(): void {
    this._renderer.render(this._scene, this._camera);
  }

  resize(): void {
    if (!this._container) return;
    const canvas = this._renderer.domElement;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stopLoop();
    this._controls.dispose();
    this.clearBuilding();
    this._renderer.dispose();
    this._pickCallbacks.clear();
    this._frameCallbacks.clear();
    SceneManager._instance = null;
  }
}
