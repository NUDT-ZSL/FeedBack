import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CityBuilder, type BuildingData, type CityParams } from './cityBuilder';
import { ControlPanel, type ControlPanelConfig } from './controlPanel';

class CityApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private cityBuilder: CityBuilder;
  private controlPanel: ControlPanel;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private selectedBuilding: BuildingData | null = null;
  private infoPanel: HTMLElement;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;
  private frameCount: number = 0;
  private fps: number = 0;

  constructor() {
    const container = document.getElementById('app')!;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(35, 45, 55);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 200;
    this.controls.target.set(0, 15, 0);
    this.controls.maxPolarAngle = Math.PI / 2.1;

    this.setupLighting();

    const initialParams: Partial<CityParams> = {
      gridSize: 10,
      density: 0.7,
      buildingSpacing: 2.5,
      minHeight: 5,
      maxHeight: 50,
      heightDistribution: 'pyramid',
      colorTheme: 'sunset'
    };

    this.cityBuilder = new CityBuilder(this.scene, initialParams);

    const panelConfig: ControlPanelConfig = {
      density: 0.7,
      heightDistribution: 'pyramid',
      colorTheme: 'sunset',
      buildingSpacing: 2.5
    };

    this.controlPanel = new ControlPanel(container, panelConfig, {
      onParamsChange: (params) => this.handleParamsChange(params),
      onGenerate: () => this.handleGenerate()
    });

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.infoPanel = document.getElementById('infoPanel')!;

    this.setupEventListeners();

    this.cityBuilder.generateCity();

    this.animate();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0x404080, 0.6);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(50, 80, 40);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 200;
    mainLight.shadow.camera.left = -60;
    mainLight.shadow.camera.right = 60;
    mainLight.shadow.camera.top = 60;
    mainLight.shadow.camera.bottom = -60;
    mainLight.shadow.bias = -0.0001;
    this.scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x6666ff, 0.3);
    fillLight.position.set(-30, 40, -20);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xff6666, 0.2);
    rimLight.position.set(-20, 20, 40);
    this.scene.add(rimLight);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.handleResize());
    this.renderer.domElement.addEventListener('click', (e) => this.handleClick(e));
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.tp-dfwv') && !target.closest('canvas')) {
        this.hideInfoPanel();
      }
    });
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const buildingMeshes = this.cityBuilder.getBuildings().map(b => b.mesh);
    const intersects = this.raycaster.intersectObjects(buildingMeshes);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object as THREE.Mesh;
      const building = this.cityBuilder.getBuildings().find(b => b.mesh === clickedMesh);

      if (building) {
        if (this.selectedBuilding?.id === building.id) {
          this.hideInfoPanel();
        } else {
          this.selectBuilding(building);
        }
      }
    } else {
      this.hideInfoPanel();
    }
  }

  private selectBuilding(building: BuildingData): void {
    if (this.selectedBuilding) {
      this.cityBuilder.highlightBuilding(this.selectedBuilding, 0.1);
    }

    this.selectedBuilding = building;
    this.cityBuilder.highlightBuilding(building, 0.3);
    this.showInfoPanel(building);
  }

  private showInfoPanel(building: BuildingData): void {
    const heightEl = document.getElementById('infoHeight')!;
    const colorEl = document.getElementById('infoColor')!;
    const coordsEl = document.getElementById('infoCoords')!;

    const colorHex = '#' + building.color.getHexString();

    heightEl.textContent = building.height.toFixed(1) + ' 单位';
    colorEl.innerHTML = `<span class="color-preview" style="background-color: ${colorHex}; color: ${colorHex};"></span>${colorHex.toUpperCase()}`;
    coordsEl.textContent = `(${building.gridX}, ${building.gridZ})`;

    this.infoPanel.classList.add('visible');
  }

  private hideInfoPanel(): void {
    if (this.selectedBuilding) {
      this.selectedBuilding = null;
    }
    this.infoPanel.classList.remove('visible');
  }

  private handleParamsChange(params: Partial<CityParams>): void {
    if ('buildingSpacing' in params) {
      this.cityBuilder.clearCity();
      this.cityBuilder.updateParams(params);
      this.cityBuilder.generateCity();
    } else {
      this.cityBuilder.updateParams(params);
    }
  }

  private handleGenerate(): void {
    this.cityBuilder.generateCity();
    this.hideInfoPanel();
  }

  private animate(currentTime: number = 0): void {
    this.animationFrameId = requestAnimationFrame((t) => this.animate(t));

    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    this.frameCount++;
    if (deltaTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / deltaTime);
      this.frameCount = 0;
    }

    this.controls.update();

    this.renderer.render(this.scene, this.camera);
  }

  getFPS(): number {
    return this.fps;
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.controlPanel.dispose();
    this.cityBuilder.dispose();
    this.controls.dispose();
    this.renderer.dispose();

    window.removeEventListener('resize', () => this.handleResize());
  }
}

let app: CityApp | null = null;

document.addEventListener('DOMContentLoaded', () => {
  app = new CityApp();
});

window.addEventListener('beforeunload', () => {
  if (app) {
    app.dispose();
  }
});
