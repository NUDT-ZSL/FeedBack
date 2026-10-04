import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneManager } from './sceneManager';
import { UIManager } from './uiManager';
import { getMoleculeById } from './moleculeData';
import { ViewerCore } from './core/viewerState';
import type { Vec3 } from './core/math3';

class MoleculeViewerApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private sceneManager: SceneManager;
  private uiManager: UIManager;
  private core: ViewerCore;
  private selectedAtom: THREE.Mesh | null = null;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fpsUpdateTime: number = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f18);

    const canvasContainer = document.getElementById('canvas-container')!;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(0, 0, 8);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    canvasContainer.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.6;
    this.controls.enablePan = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    this.controls.minDistance = 2;
    this.controls.maxDistance = 30;

    this.setupLights();

    this.sceneManager = new SceneManager(this.scene);

    this.core = new ViewerCore(width, height);

    this.uiManager = new UIManager({
      onMoleculeSelect: (id) => this.handleMoleculeSelect(id),
      onBack: () => this.handleBack(),
      onToggleView: () => this.handleToggleView()
    });

    this.bindEvents();
  }

  private setupLights(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 8, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    this.scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x88aaff, 0.4);
    fillLight.position.set(-5, -3, -5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffaa88, 0.3);
    rimLight.position.set(0, 5, -8);
    this.scene.add(rimLight);
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.handleResize());
    this.renderer.domElement.addEventListener('click', (e) => this.handleClick(e));
    this.renderer.domElement.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.core.resize(width, height);
  }

  private syncCoreViewport(): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.core.setViewportRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
  }

  private syncCoreCamera(): void {
    const p = this.camera.position;
    const t = this.controls.target;
    this.core.syncCamera([p.x, p.y, p.z], [t.x, t.y, t.z]);
  }

  private selectedAtomWorldPos(): Vec3 | undefined {
    if (!this.selectedAtom) return undefined;
    const pos = new THREE.Vector3().setFromMatrixPosition(this.selectedAtom.matrixWorld);
    return [pos.x, pos.y, pos.z];
  }

  private handleClick(event: MouseEvent): void {
    if (!this.core.moleculeData) return;

    this.syncCoreViewport();
    const result = this.core.clickAt(event.clientX, event.clientY);

    if (result.action === 'select') {
      const mesh = this.sceneManager.getAtomMeshes()[result.hitIndex] ?? null;
      const atomData = mesh ? this.sceneManager.getAtomData(mesh) : undefined;
      if (mesh && atomData) {
        this.selectedAtom = mesh;
        this.sceneManager.highlightAtom(mesh);
        const label = this.core.getLabelState(this.selectedAtomWorldPos());
        if (label) {
          this.uiManager.showAtomLabel(
            atomData,
            label.screen.x,
            label.screen.y,
            result.hitIndex
          );
        }
      }
    } else if (result.action === 'deselect') {
      this.selectedAtom = null;
      this.sceneManager.highlightAtom(null);
      this.uiManager.hideAtomLabel();
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.core.moleculeData) return;

    this.syncCoreViewport();
    this.core.pointerMove(event.clientX, event.clientY);
    this.renderer.domElement.style.cursor = this.core.cursor;

    if (this.selectedAtom) {
      const label = this.core.getLabelState(this.selectedAtomWorldPos());
      if (label) {
        this.uiManager.updateAtomLabelPosition(label.screen.x, label.screen.y);
      }
    }
  }

  private async handleMoleculeSelect(moleculeId: string): Promise<void> {
    const moleculeData = getMoleculeById(moleculeId);
    if (!moleculeData) return;

    this.core.selectMolecule(moleculeData);
    this.uiManager.showMoleculeView(moleculeData);

    await this.sceneManager.loadMolecule(moleculeData);

    this.camera.position.set(...this.core.camera.position);
    this.controls.target.set(...this.core.camera.target);
    this.controls.update();

    this.selectedAtom = null;
  }

  private async handleBack(): Promise<void> {
    this.core.back();
    this.uiManager.hideMoleculeView();
    this.selectedAtom = null;
    await this.sceneManager.unloadMolecule();
  }

  private handleToggleView(): void {
    this.core.toggleBestView();
  }

  private updateFPS(deltaTime: number): void {
    this.frameCount++;
    this.fpsUpdateTime += deltaTime;
    if (this.fpsUpdateTime >= 500) {
      const fps = (this.frameCount / this.fpsUpdateTime) * 1000;
      this.uiManager.updateFPS(fps);
      this.frameCount = 0;
      this.fpsUpdateTime = 0;
    }
  }

  public animate(): void {
    requestAnimationFrame(() => this.animate());

    const currentTime = performance.now();
    const deltaTime = this.lastFrameTime > 0 ? currentTime - this.lastFrameTime : 16;
    this.lastFrameTime = currentTime;

    if (!this.core.tweening) {
      this.controls.update();
      this.syncCoreCamera();
    }

    const tweenSample = this.core.update(deltaTime);
    if (tweenSample) {
      this.camera.position.set(...tweenSample.position);
      this.controls.target.set(...tweenSample.target);
      this.controls.update();
    }

    const time = currentTime * 0.001;
    this.sceneManager.animateElectronClouds(time);

    this.renderer.render(this.scene, this.camera);
    this.updateFPS(deltaTime);
  }

  public start(): void {
    this.lastFrameTime = performance.now();
    this.animate();
  }
}

const app = new MoleculeViewerApp();
app.start();
