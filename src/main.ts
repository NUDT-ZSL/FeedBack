import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { SolarSystem } from './SolarSystem';
import { UIController } from './UIController';

class App {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private solarSystem: SolarSystem;
  private uiController: UIController;
  private clock: THREE.Clock;
  private container: HTMLElement;

  constructor() {
    this.container = document.getElementById('canvas-container')!;
    this.clock = new THREE.Clock();

    this.scene = this.createScene();
    this.camera = this.createCamera();
    this.renderer = this.createRenderer();
    this.container.appendChild(this.renderer.domElement);

    this.solarSystem = new SolarSystem(this.scene);
    this.uiController = new UIController(this.camera, this.renderer, this.solarSystem);

    this.animate = this.animate.bind(this);
    this.animate();
  }

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    return scene;
  }

  private createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 30, 50);
    camera.lookAt(0, 0, 0);
    return camera;
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    return renderer;
  }

  private animate(): void {
    requestAnimationFrame(this.animate);

    const deltaTime = Math.min(this.clock.getDelta(), 0.1);

    TWEEN.update();
    this.solarSystem.update(deltaTime);
    this.uiController.update();

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
