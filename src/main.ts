import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as TWEEN from '@tweenjs/tween.js';

import { FaultGenerator, type FaultType, type FaultParams } from './geologyModule/FaultGenerator';
import { TerrainGenerator } from './geologyModule/TerrainGenerator';
import { WaveSimulator, type EarthquakeParams } from './seismicModule/WaveSimulator';
import { WaveRenderer } from './seismicModule/WaveRenderer';
import { UIControls } from './controls/UIControls';

class App {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private faultGenerator: FaultGenerator;
  private terrainGenerator: TerrainGenerator;
  private waveSimulator: WaveSimulator;
  private waveRenderer: WaveRenderer;
  private uiControls: UIControls;

  private faultMesh: THREE.Group | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private pickingMode: boolean = false;
  private clock: THREE.Clock;
  private clipPlanes: { x: THREE.Plane | null; z: THREE.Plane | null } = { x: null, z: null };

  constructor() {
    this.container = document.getElementById('scene-container')!;
    this.clock = new THREE.Clock();

    this.renderer = this.createRenderer();
    this.scene = this.createScene();
    this.camera = this.createCamera();
    this.controls = this.createControls();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.faultGenerator = new FaultGenerator();
    this.terrainGenerator = new TerrainGenerator(400, 200);
    this.waveSimulator = new WaveSimulator();
    this.waveRenderer = new WaveRenderer();

    this.uiControls = new UIControls({
      onFaultTypeChange: this.handleFaultTypeChange.bind(this),
      onFaultParamChange: this.handleFaultParamChange.bind(this),
      onPickSource: this.handlePickSource.bind(this),
      onIntensityChange: this.handleIntensityChange.bind(this),
      onReset: this.handleReset.bind(this),
      onTerrainOpacity: this.handleTerrainOpacity.bind(this),
      onTerrainAmplitude: this.handleTerrainAmplitude.bind(this),
      onClipAxis: this.handleClipAxis.bind(this),
      onClipPosition: this.handleClipPosition.bind(this)
    });

    this.init();
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    renderer.setClearColor(0x0a0e27, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    this.container.appendChild(renderer.domElement);
    return renderer;
  }

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e27);
    scene.fog = new THREE.FogExp2(0x0a0e27, 0.0025);
    return scene;
  }

  private createCamera(): THREE.PerspectiveCamera {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
    camera.position.set(180, 150, 220);
    return camera;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 30;
    controls.maxDistance = 800;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(0, 0, 0);
    return controls;
  }

  private addLights(): void {
    const ambient = new THREE.AmbientLight(0x405080, 0.55);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(120, 180, 100);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -250;
    dir.shadow.camera.right = 250;
    dir.shadow.camera.top = 250;
    dir.shadow.camera.bottom = -250;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 600;
    this.scene.add(dir);

    const rim = new THREE.DirectionalLight(0x00d4ff, 0.25);
    rim.position.set(-100, 60, -120);
    this.scene.add(rim);

    const pink = new THREE.PointLight(0xff00aa, 0.4, 400);
    pink.position.set(-50, 40, 80);
    this.scene.add(pink);
  }

  private addHelpers(): void {
    const grid = new THREE.GridHelper(400, 40, 0x1a2550, 0x141a3a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = -0.05;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(30);
    axes.position.y = 0.02;
    this.scene.add(axes);
  }

  private init(): void {
    this.addLights();
    this.addHelpers();

    const terrain = this.terrainGenerator.generate({
      amplitude: this.uiControls.getTerrainAmplitude(),
      opacity: this.uiControls.getTerrainOpacity()
    });
    this.scene.add(terrain);
    this.terrainMesh = terrain;

    const params = this.uiControls.getFaultParams();
    const { mesh } = this.faultGenerator.generate(params);
    this.scene.add(mesh);
    this.faultMesh = mesh;

    this.waveRenderer.init(this.scene);
    this.uiControls.bindAllEvents();

    this.bindInteraction();
    window.addEventListener('resize', this.onResize.bind(this));

    this.animate();
  }

  private bindInteraction(): void {
    this.renderer.domElement.addEventListener('click', this.onCanvasClick.bind(this));
  }

  private onCanvasClick(event: MouseEvent): void {
    if (!this.pickingMode || !this.terrainMesh) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.terrainMesh, false);

    if (intersects.length > 0) {
      const point = intersects[0].point.clone();
      this.triggerEarthquake(point);
      this.pickingMode = false;
      this.uiControls.setPickMode(false);
    }
  }

  private triggerEarthquake(position: THREE.Vector3): void {
    const intensity = this.uiControls.getIntensity();
    const params: EarthquakeParams = {
      intensity,
      frequency: 2.0,
      attenuation: 0.03
    };

    this.waveRenderer.addPulseRing(position, this.scene);
    const sourceId = this.waveSimulator.addSource(position, params);

    const activeSources = this.waveSimulator.getActiveSources();
    const currentSource = activeSources.find((s) => s.id === sourceId);
    if (currentSource) {
      this.waveRenderer.addWaveRings(currentSource, this.scene);
    }
  }

  private handleFaultTypeChange(type: FaultType): void {
    const current = this.faultGenerator.getCurrentParams();
    const newParams: FaultParams = { ...current, type };
    const mesh = this.faultGenerator.animateTransition(newParams, this.scene);
    this.faultMesh = mesh;
  }

  private handleFaultParamChange(partial: Partial<FaultParams>): void {
    const current = this.faultGenerator.getCurrentParams();
    const newParams: FaultParams = { ...current, ...partial };
    const mesh = this.faultGenerator.animateParamsUpdate(newParams, this.scene);
    this.faultMesh = mesh;
  }

  private handlePickSource(): void {
    this.pickingMode = !this.pickingMode;
    this.uiControls.setPickMode(this.pickingMode);
    this.renderer.domElement.style.cursor = this.pickingMode ? 'crosshair' : 'default';
  }

  private handleIntensityChange(intensity: number): void {
    this.waveSimulator.updateIntensity(intensity);
    this.waveRenderer.fadeInUpdate(200);
  }

  private handleReset(): void {
    this.waveSimulator.clearAll();

    if (this.faultMesh) {
      this.scene.remove(this.faultMesh);
    }
    const params = this.uiControls.getFaultParams();
    const { mesh } = this.faultGenerator.generate(params);
    this.scene.add(mesh);
    this.faultMesh = mesh;

    this.camera.position.set(180, 150, 220);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private handleTerrainOpacity(opacity: number): void {
    this.terrainGenerator.updateOpacity(opacity);
  }

  private handleTerrainAmplitude(amplitude: number): void {
    this.terrainGenerator.updateAmplitude(amplitude);
  }

  private handleClipAxis(axis: 'x' | 'z' | null): void {
    this.clipPlanes = { x: null, z: null };
    this.terrainGenerator.setClipping(axis, this.uiControls.getTerrainOpacity());
    if (axis) {
      this.updateFaultClipping();
    } else {
      this.clearFaultClipping();
    }
  }

  private handleClipPosition(position: number): void {
    this.terrainGenerator.setClipping(
      this.clipPlanes.x ? 'x' : this.clipPlanes.z ? 'z' : null,
      position
    );
    this.updateFaultClipping();
  }

  private updateFaultClipping(): void {
    if (!this.faultMesh) return;

    this.faultMesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
            const axis = this.clipPlanes.x ? 'x' : this.clipPlanes.z ? 'z' : null;
            if (axis) {
              const normal = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
              mat.clippingPlanes = [new THREE.Plane(normal, 0)];
              mat.clipShadows = true;
            }
          }
        });
      }
    });
  }

  private clearFaultClipping(): void {
    if (!this.faultMesh) return;
    this.faultMesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if ('clippingPlanes' in mat) {
            (mat as THREE.MeshStandardMaterial).clippingPlanes = [];
          }
        });
      }
    });
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));
    const delta = this.clock.getDelta();
    TWEEN.update();
    this.controls.update(delta);

    const particleData = this.waveSimulator.getParticlesData();
    this.waveRenderer.update(particleData);

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
