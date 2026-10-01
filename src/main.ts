import * as THREE from 'three';
import { EnvironmentManager } from './environment';
import { CoralManager } from './coral';
import { FishManager } from './fish';
import { GUIManager } from './gui';

class UnderwaterScene {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  public environment!: EnvironmentManager;
  public coralManager!: CoralManager;
  public fishManager!: FishManager;
  public guiManager!: GUIManager;

  public clock: THREE.Clock;
  public time: number = 0;

  public isDragging: boolean = false;
  public previousMousePosition: { x: number; y: number } = { x: 0, y: 0 };
  public cameraAngle: number = 0;
  public cameraHeight: number = 20;
  public cameraDistance: number = 40;
  public targetCameraAngle: number = 0;
  public targetCameraHeight: number = 20;
  public targetCameraDistance: number = 40;
  public autoRotatePhase: number = 0;
  public isUserInteracting: boolean = false;
  public lastInteractionTime: number = 0;

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
    this.updateCameraPosition();

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

  private updateCameraPosition(): void {
    const x = Math.sin(this.cameraAngle) * this.cameraDistance;
    const z = Math.cos(this.cameraAngle) * this.cameraDistance;
    this.camera.position.set(x, this.cameraHeight, z);
    this.camera.lookAt(0, 3, 0);
  }

  private setupControls(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.isUserInteracting = true;
      this.lastInteractionTime = this.time;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.lastInteractionTime = this.time;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const deltaX = e.clientX - this.previousMousePosition.x;
        const deltaY = e.clientY - this.previousMousePosition.y;
        this.targetCameraAngle -= deltaX * 0.005;
        this.targetCameraHeight = THREE.MathUtils.clamp(
          this.targetCameraHeight + deltaY * 0.1,
          2,
          30
        );
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
        this.lastInteractionTime = this.time;
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetCameraDistance = THREE.MathUtils.clamp(
        this.targetCameraDistance + e.deltaY * 0.05,
        10,
        80
      );
      this.isUserInteracting = true;
      this.lastInteractionTime = this.time;
    }, { passive: false });

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.isUserInteracting = true;
        this.lastInteractionTime = this.time;
        this.previousMousePosition = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    });

    canvas.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - this.previousMousePosition.x;
        const deltaY = e.touches[0].clientY - this.previousMousePosition.y;
        this.targetCameraAngle -= deltaX * 0.005;
        this.targetCameraHeight = THREE.MathUtils.clamp(
          this.targetCameraHeight + deltaY * 0.1,
          2,
          30
        );
        this.previousMousePosition = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        this.lastInteractionTime = this.time;
      }
    });

    canvas.addEventListener('touchend', () => {
      this.isDragging = false;
      this.lastInteractionTime = this.time;
    });
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
    this.cameraAngle = 0;
    this.targetCameraAngle = 0;
    this.cameraHeight = 20;
    this.targetCameraHeight = 20;
    this.cameraDistance = 40;
    this.targetCameraDistance = 40;
    this.autoRotatePhase = 0;
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

    if (this.time - this.lastInteractionTime > 5) {
      this.isUserInteracting = false;
    }

    if (!this.isUserInteracting && !this.isDragging) {
      this.autoRotatePhase += delta * (2 * Math.PI / 30);
      const autoAngle = Math.sin(this.autoRotatePhase) * (15 * Math.PI / 180);
      this.targetCameraAngle = autoAngle;
    }

    const damping = 0.1;
    this.cameraAngle += (this.targetCameraAngle - this.cameraAngle) * damping;
    this.cameraHeight += (this.targetCameraHeight - this.cameraHeight) * damping;

    const zoomSmooth = 1 - Math.pow(0.001, delta / 0.3);
    this.cameraDistance += (this.targetCameraDistance - this.cameraDistance) * zoomSmooth;

    this.updateCameraPosition();

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
