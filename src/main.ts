import * as THREE from 'three';
import { EnvironmentManager } from './environment';
import { CoralManager } from './coral';
import { FishManager } from './fish';
import { GUIManager } from './gui';
import { CameraRig } from './cameraRig';
import { updateHUD } from './hud';
import { resetReef } from './reefReset';

class UnderwaterScene {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  public environment!: EnvironmentManager;
  public coralManager!: CoralManager;
  public fishManager!: FishManager;
  public guiManager!: GUIManager;
  public cameraRig: CameraRig = new CameraRig();

  public clock: THREE.Clock;
  public time: number = 0;

  public fpsFrames: number = 0;
  public fpsTime: number = 0;
  public currentFps: number = 60;

  constructor() {
    this.clock = new THREE.Clock();
    this.init();
    this.setupControls();
    this.animate();
  }

  private init(): void {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.cameraRig.applyToCamera(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const app = document.getElementById('app');
    if (app) {
      app.appendChild(this.renderer.domElement);
    }

    (window as any)._camera = this.camera;

    this.environment = new EnvironmentManager(this.scene);
    this.coralManager = new CoralManager(this.scene);
    const clusterCenters = this.coralManager.getClusterCenters();
    this.fishManager = new FishManager(this.scene, clusterCenters);

    const guiContainer = document.getElementById('gui-container')!;
    this.guiManager = new GUIManager(
      guiContainer,
      this.environment,
      this.coralManager,
      this.fishManager,
      {
        onReset: () => this.resetEnvironment(),
        onToggleSchool: () => this.fishManager.toggleSchoolSize(),
      }
    );

    this.updateHUD();
    window.addEventListener('resize', () => this.onResize());
  }

  private setupControls(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
      this.cameraRig.beginDrag(e.clientX, e.clientY, this.time);
    });

    window.addEventListener('mouseup', () => {
      this.cameraRig.endDrag(this.time);
    });

    window.addEventListener('mousemove', (e) => {
      this.cameraRig.dragTo(e.clientX, e.clientY, this.time);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraRig.zoom(e.deltaY, this.time);
    }, { passive: false });

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.cameraRig.beginDrag(e.touches[0].clientX, e.touches[0].clientY, this.time);
      }
    });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        this.cameraRig.dragTo(e.touches[0].clientX, e.touches[0].clientY, this.time);
      }
    });

    canvas.addEventListener('touchend', () => {
      this.cameraRig.endDrag(this.time);
    });
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private resetEnvironment(): void {
    resetReef(
      this.environment,
      this.coralManager,
      this.fishManager,
      this.cameraRig,
      document
    );
    this.guiManager.reset();
  }

  private updateHUD(): void {
    updateHUD(document, {
      fps: this.currentFps,
      fishCount: this.fishManager.fishCount,
      coralCount: this.coralManager.coralCount,
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.time += delta;

    this.fpsFrames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.currentFps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.updateHUD();
    }

    this.cameraRig.update(delta, this.time);
    this.cameraRig.applyToCamera(this.camera);

    this.environment.update(delta, this.time);
    this.environment.checkJellyfishHover(this.camera);

    this.coralManager.update(
      delta,
      this.time,
      this.environment.params.lightIntensity,
      this.environment.params.temperature
    );

    this.fishManager.update(
      delta,
      this.time,
      this.environment.params.temperature,
      this.environment.params.turbidity,
      this.environment.params.lightIntensity,
      this.currentFps
    );

    this.renderer.render(this.scene, this.camera);
  };
}

window.addEventListener('DOMContentLoaded', () => {
  new UnderwaterScene();
});
