import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AudioAnalyzer } from './audioAnalyzer';
import { SculptureBuilder, VisualizationMode } from './sculptureBuilder';
import { UIController } from './uiController';
import { AppController } from './appController';
import { applyCameraFit } from './cameraFit';

class App {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private controls: OrbitControls;
  private clock: THREE.Clock;

  private audioAnalyzer: AudioAnalyzer;
  private sculptureBuilder: SculptureBuilder;
  private uiController: UIController;
  private appController: AppController;

  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fps: number = 0;

  constructor() {
    this.clock = new THREE.Clock();
    this.audioAnalyzer = new AudioAnalyzer();
    this.sculptureBuilder = new SculptureBuilder();
    this.uiController = new UIController();
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0515);
    this.scene.fog = new THREE.Fog(0x0a0515, 20, 80);
    
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 8, 18);
    this.camera.lookAt(0, 2, 0);
    
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    
    const container = document.getElementById('canvas-container');
    if (container) {
      container.appendChild(this.renderer.domElement);
    }
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.3;
    this.controls.target.set(0, 2, 0);
    
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);
    
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,
      0.4,
      0.85
    );
    this.composer.addPass(bloomPass);
    
    this.setupLighting();
    this.sculptureBuilder.init(this.scene);

    this.appController = new AppController(
      this.audioAnalyzer,
      this.sculptureBuilder,
      this.uiController,
      { frequencyBands: 16, waveformSamples: 128 }
    );
    this.uiController.setIntents({
      upload: (file) => this.appController.upload(file),
      togglePlayPause: () => this.appController.togglePlayPause(),
      seek: (time) => this.appController.seek(time),
      changeMode: (mode: VisualizationMode) => this.appController.changeMode(mode)
    });

    this.setupEventListeners();
    
    this.animate();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -15;
    mainLight.shadow.camera.right = 15;
    mainLight.shadow.camera.top = 15;
    mainLight.shadow.camera.bottom = -15;
    this.scene.add(mainLight);
    
    const fillLight = new THREE.DirectionalLight(0x00d4ff, 0.4);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);
    
    const rimLight = new THREE.PointLight(0xff6b35, 1, 30);
    rimLight.position.set(0, 5, -10);
    this.scene.add(rimLight);
    
    const topLight = new THREE.PointLight(0x00ff88, 0.6, 20);
    topLight.position.set(0, 15, 0);
    this.scene.add(topLight);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.onWindowResize());
    
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.appController.pausePlayback();
      }
    });
    
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.appController.hasAudio()) {
        e.preventDefault();
        this.appController.togglePlayPause();
      }
    });
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    
    applyCameraFit(this.camera, this.controls, width);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    
    const delta = Math.min(this.clock.getDelta(), 0.1);

    this.appController.tick(delta);
    
    this.controls.update();
    
    this.composer.render();
    
    this.calculateFPS();
  }

  private calculateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
      
      if (this.fps < 50) {
        console.warn(`FPS dropped below 50: ${this.fps}`);
      }
    }
  }

  getFPS(): number {
    return this.fps;
  }

  dispose(): void {
    this.audioAnalyzer.dispose();
    this.sculptureBuilder.dispose();
    this.uiController.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.composer.dispose();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  
  window.addEventListener('beforeunload', () => {
    app.dispose();
  });
});
