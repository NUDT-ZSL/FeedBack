import * as THREE from 'three';
import { EnvironmentManager } from './environment';
import { CoralManager } from './coral';
import { FishManager } from './fish';
import { GUIManager } from './gui';
import { CameraController } from './cameraController';

class UnderwaterScene {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  public cameraController!: CameraController;
  public environment!: EnvironmentManager;
  public coralManager!: CoralManager;
  public fishManager!: FishManager;
  public guiManager!: GUIManager;

  public clock: THREE.Clock;
  public time: number = 0;

  public fpsFrames: number = 0;
  public fpsTime: number = 0;
  public currentFps: number = 60;

  constructor() {
    this.clock = new THREE.Clock();
    this.init();
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
    this.cameraController = new CameraController(this.camera);

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

    this.cameraController.attach(this.renderer.domElement);

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

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private resetEnvironment(): void {
    this.coralManager.reset();
    const clusterCenters = this.coralManager.getClusterCenters();
    this.fishManager.reset(clusterCenters);
    this.guiManager.reset();
    this.cameraController.reset();
  }

  private updateHUD(): void {
    const fpsEl = document.getElementById('fps');
    const fishEl = document.getElementById('fish-count');
    const coralEl = document.getElementById('coral-count');
    if (fpsEl) fpsEl.textContent = Math.round(this.currentFps).toString();
    if (fishEl) fishEl.textContent = this.fishManager.fishCount.toString();
    if (coralEl) coralEl.textContent = this.coralManager.coralCount.toString();
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

    this.cameraController.update(delta, this.time);

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
