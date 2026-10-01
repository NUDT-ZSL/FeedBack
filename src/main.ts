import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneManager } from './sceneManager';
import { UIManager } from './uiManager';
import { getMoleculeById, type MoleculeData } from './moleculeData';

class MoleculeViewerApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private sceneManager: SceneManager;
  private uiManager: UIManager;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private selectedAtom: THREE.Mesh | null = null;
  private hoveredAtom: THREE.Mesh | null = null;
  private currentMoleculeData: MoleculeData | null = null;
  private isViewTweening: boolean = false;
  private tweenStartPos: THREE.Vector3 = new THREE.Vector3();
  private tweenEndPos: THREE.Vector3 = new THREE.Vector3();
  private tweenStartTarget: THREE.Vector3 = new THREE.Vector3();
  private tweenEndTarget: THREE.Vector3 = new THREE.Vector3();
  private tweenProgress: number = 0;
  private tweenDuration: number = 2000;
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

    this.uiManager = new UIManager({
      onMoleculeSelect: (id) => this.handleMoleculeSelect(id),
      onBack: () => this.handleBack(),
      onToggleView: () => this.handleToggleView()
    });

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

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
  }

  private handleClick(event: MouseEvent): void {
    if (!this.currentMoleculeData) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const atomMeshes = this.sceneManager.getAtomMeshes();
    const intersects = this.raycaster.intersectObjects(atomMeshes, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const atomData = this.sceneManager.getAtomData(mesh);
      const atomIndex = mesh.userData.atomIndex;

      if (atomData) {
        if (this.selectedAtom === mesh) {
          this.selectedAtom = null;
          this.sceneManager.highlightAtom(null);
          this.uiManager.hideAtomLabel();
        } else {
          this.selectedAtom = mesh;
          this.sceneManager.highlightAtom(mesh);
          const pos = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
          const screenPos = this.uiManager.getScreenPosition(pos, this.camera, this.renderer);
          this.uiManager.showAtomLabel(atomData, screenPos.x, screenPos.y, atomIndex);
        }
      }
    } else {
      if (this.selectedAtom) {
        this.selectedAtom = null;
        this.sceneManager.highlightAtom(null);
        this.uiManager.hideAtomLabel();
      }
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.currentMoleculeData) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const atomMeshes = this.sceneManager.getAtomMeshes();
    const intersects = this.raycaster.intersectObjects(atomMeshes, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      if (this.hoveredAtom !== mesh) {
        this.hoveredAtom = mesh;
        this.renderer.domElement.style.cursor = 'pointer';
      }
    } else {
      if (this.hoveredAtom) {
        this.hoveredAtom = null;
        this.renderer.domElement.style.cursor = 'default';
      }
    }

    if (this.selectedAtom) {
      const pos = new THREE.Vector3().setFromMatrixPosition(this.selectedAtom.matrixWorld);
      const screenPos = this.uiManager.getScreenPosition(pos, this.camera, this.renderer);
      this.uiManager.updateAtomLabelPosition(screenPos.x, screenPos.y);
    }
  }

  private async handleMoleculeSelect(moleculeId: string): Promise<void> {
    const moleculeData = getMoleculeById(moleculeId);
    if (!moleculeData) return;

    this.currentMoleculeData = moleculeData;
    this.uiManager.showMoleculeView(moleculeData);

    await this.sceneManager.loadMolecule(moleculeData);

    this.camera.position.set(0, 0, 8);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.selectedAtom = null;
    this.hoveredAtom = null;
  }

  private async handleBack(): Promise<void> {
    this.uiManager.hideMoleculeView();
    this.selectedAtom = null;
    this.hoveredAtom = null;
    this.currentMoleculeData = null;
    await this.sceneManager.unloadMolecule();
  }

  private handleToggleView(): void {
    if (!this.currentMoleculeData || this.isViewTweening) return;

    const bestAngle = this.currentMoleculeData.bestViewAngle;
    this.tweenStartPos.copy(this.camera.position);
    this.tweenEndPos.set(bestAngle[0], bestAngle[1], bestAngle[2]);
    this.tweenStartTarget.copy(this.controls.target);
    this.tweenEndTarget.set(0, 0, 0);
    this.tweenProgress = 0;
    this.isViewTweening = true;
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private updateViewTween(deltaTime: number): void {
    if (!this.isViewTweening) return;

    this.tweenProgress += deltaTime;
    const t = Math.min(this.tweenProgress / this.tweenDuration, 1);
    const eased = this.easeInOutCubic(t);

    this.camera.position.lerpVectors(this.tweenStartPos, this.tweenEndPos, eased);
    this.controls.target.lerpVectors(this.tweenStartTarget, this.tweenEndTarget, eased);
    this.controls.update();

    if (t >= 1) {
      this.isViewTweening = false;
    }
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

    if (!this.isViewTweening) {
      this.controls.update();
    }

    this.updateViewTween(deltaTime);

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
