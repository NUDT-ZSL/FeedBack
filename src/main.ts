import * as THREE from 'three';
import {
  generateTerrain,
  getHeightAt,
  type TerrainData
} from './terrain';
import { RouteStore, type RoutePointInfo } from './route';
import { InteractionManager } from './interaction';
import { UIManager } from './ui';

class HikingSimulator {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private appElement: HTMLElement;

  private terrainData!: TerrainData;
  private terrainMesh!: THREE.Mesh;
  private routeStore!: RouteStore;
  private pathPointMeshes: THREE.Mesh[] = [];
  private pathLineMesh: THREE.Line | null = null;
  private highlightedPointMesh: THREE.Mesh | null = null;
  private selectedControlIndex: number = -1;
  private clickedPoint: THREE.Vector3 | null = null;
  private clickedPointInfo: RoutePointInfo | null = null;

  private interactionManager!: InteractionManager;
  private uiManager!: UIManager;

  private clock: THREE.Clock;
  private animationFrameId: number = 0;

  constructor() {
    this.appElement = document.getElementById('app') || document.body;
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1a1a2e');
    this.scene.fog = new THREE.Fog('#1a1a2e', 600, 1500);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      5000
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.appElement.appendChild(this.renderer.domElement);

    this.init();
  }

  private init(): void {
    this.setupLights();
    this.createTerrain();
    this.setupManagers();
    this.addSamplePath();
    this.bindWindowEvents();
    this.animate();
  }

  private setupLights(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(300, 500, 200);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 1500;
    sunLight.shadow.camera.left = -400;
    sunLight.shadow.camera.right = 400;
    sunLight.shadow.camera.top = 400;
    sunLight.shadow.camera.bottom = -400;
    this.scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-200, 200, -200);
    this.scene.add(fillLight);

    const hemisphereLight = new THREE.HemisphereLight(0x88aaff, 0x445533, 0.3);
    this.scene.add(hemisphereLight);
  }

  private createTerrain(): void {
    this.terrainData = generateTerrain({
      size: 400,
      segments: 128,
      maxHeight: 500,
      minHeight: 100,
      seed: 42
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.terrainData.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.terrainData.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.terrainData.indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: false
    });

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    const wireframeGeometry = new THREE.BufferGeometry();
    wireframeGeometry.setAttribute('position', new THREE.BufferAttribute(this.terrainData.positions, 3));
    wireframeGeometry.setIndex(new THREE.BufferAttribute(this.terrainData.indices, 1));
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.05
    });
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    this.scene.add(wireframe);
  }

  private setupManagers(): void {
    this.interactionManager = new InteractionManager(
      this.camera,
      this.renderer,
      this.terrainMesh,
      this.terrainData,
      {
        onTerrainClick: this.onTerrainClick.bind(this),
        onPathPointClick: this.onPathPointClick.bind(this),
        onMouseMove: this.onMouseMove.bind(this)
      }
    );

    this.uiManager = new UIManager(
      this.appElement,
      this.terrainData,
      this.onModeChange.bind(this),
      this.onChartHover.bind(this),
      this.onRoamSpeedChange.bind(this)
    );
  }

  private addSamplePath(): void {
    const samplePoints = [
      new THREE.Vector3(-150, 0, -120),
      new THREE.Vector3(-80, 0, -60),
      new THREE.Vector3(-20, 0, -100),
      new THREE.Vector3(30, 0, -40),
      new THREE.Vector3(60, 0, 20),
      new THREE.Vector3(20, 0, 60),
      new THREE.Vector3(-40, 0, 80),
      new THREE.Vector3(-10, 0, 130),
      new THREE.Vector3(50, 0, 140),
      new THREE.Vector3(100, 0, 100),
      new THREE.Vector3(130, 0, 40),
      new THREE.Vector3(80, 0, -20)
    ];

    for (const point of samplePoints) {
      point.y = getHeightAt(point.x, point.z, this.terrainData);
    }

    this.routeStore = new RouteStore(this.terrainData, samplePoints);
    this.refreshRoute();
  }

  private bindWindowEvents(): void {
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onTerrainClick(point: THREE.Vector3): void {
    if (!this.uiManager.isEditMode()) return;

    const existingIndex = this.routeStore.findNearbyControlPoint(point);
    if (existingIndex >= 0) {
      this.routeStore.removeControlPointAt(existingIndex);
      if (this.selectedControlIndex === existingIndex) {
        this.selectedControlIndex = -1;
      } else if (this.selectedControlIndex > existingIndex) {
        this.selectedControlIndex -= 1;
      }
    } else {
      this.routeStore.addControlPoint(point);
      this.selectedControlIndex = this.routeStore.getSnapshot().controlPoints.length - 1;
    }

    this.refreshRoute();
  }

  private onPathPointClick(index: number): void {
    this.selectedControlIndex = index;
    this.updateSelectedInfo();
  }

  private onMouseMove(point: THREE.Vector3 | null): void {
    this.uiManager.updateElevation(point);
  }

  private onModeChange(mode: 'roam' | 'edit'): void {
    this.uiManager.setMode(mode);
    const snapshot = this.routeStore.getSnapshot();
    this.interactionManager.setMode(mode, snapshot.smoothedPath);
  }

  private onRoamSpeedChange(speed: number): void {
    this.interactionManager.setRoamSpeed(speed);
  }

  private onChartHover(pathIndex: number): void {
    if (this.highlightedPointMesh) {
      this.scene.remove(this.highlightedPointMesh);
      this.highlightedPointMesh.geometry.dispose();
      (this.highlightedPointMesh.material as THREE.Material).dispose();
      this.highlightedPointMesh = null;
    }

    const smoothedPath = this.routeStore.getSnapshot().smoothedPath;
    if (pathIndex >= 0 && smoothedPath[pathIndex]) {
      const point = smoothedPath[pathIndex];
      const geometry = new THREE.SphereGeometry(6, 16, 16);
      const material = new THREE.MeshBasicMaterial({
        color: 0xff6f00,
        transparent: true,
        opacity: 0.9
      });
      this.highlightedPointMesh = new THREE.Mesh(geometry, material);
      this.highlightedPointMesh.position.copy(point);
      this.highlightedPointMesh.position.y += 3;
      this.scene.add(this.highlightedPointMesh);
    }
  }

  private refreshRoute(): void {
    const snapshot = this.routeStore.getSnapshot();

    this.rebuildControlPointMeshes(snapshot.controlPoints);
    this.rebuildPathLine(snapshot.smoothedPath);
    this.uiManager.renderRoute(snapshot);

    if (this.interactionManager.isRoamMode()) {
      this.interactionManager.setRoamPath(snapshot.smoothedPath);
    }

    this.updateSelectedInfo();
  }

  private updateSelectedInfo(): void {
    const snapshot = this.routeStore.getSnapshot();

    if (this.selectedControlIndex < 0 || this.selectedControlIndex >= snapshot.controlPoints.length) {
      this.selectedControlIndex = -1;
      this.clickedPoint = null;
      this.clickedPointInfo = null;
      return;
    }

    const controlPoint = snapshot.controlPoints[this.selectedControlIndex];
    this.clickedPoint = controlPoint.clone();
    this.clickedPointInfo = this.routeStore.getPointInfoAt(controlPoint);
  }

  private rebuildControlPointMeshes(points: THREE.Vector3[]): void {
    for (const mesh of this.pathPointMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.pathPointMeshes = [];

    for (let i = 0; i < points.length; i++) {
      const isStart = i === 0;
      const isEnd = i === points.length - 1;
      const geometry = new THREE.SphereGeometry(isStart || isEnd ? 7 : 5, 16, 16);
      const material = new THREE.MeshStandardMaterial({
        color: isStart ? 0x4caf50 : isEnd ? 0xff3333 : 0xff6f00,
        emissive: isStart ? 0x1a3a1a : isEnd ? 0x3a1a1a : 0x3a1a00,
        emissiveIntensity: 0.3,
        roughness: 0.4,
        metalness: 0.1
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(points[i]);
      mesh.position.y += 5;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.pathPointMeshes.push(mesh);
    }

    this.interactionManager.setPathPointMeshes(this.pathPointMeshes);
  }

  private rebuildPathLine(smoothedPath: THREE.Vector3[]): void {
    if (this.pathLineMesh) {
      this.scene.remove(this.pathLineMesh);
      this.pathLineMesh.geometry.dispose();
      (this.pathLineMesh.material as THREE.Material).dispose();
      this.pathLineMesh = null;
    }

    if (smoothedPath.length < 2) return;

    const positions = new Float32Array(smoothedPath.length * 3);
    const colors = new Float32Array(smoothedPath.length * 3);
    const baseColor = new THREE.Color('#ff6f00');
    const highColor = new THREE.Color('#ffcc00');

    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of smoothedPath) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const yRange = maxY - minY || 1;

    for (let i = 0; i < smoothedPath.length; i++) {
      const point = smoothedPath[i];
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y + 1.5;
      positions[i * 3 + 2] = point.z;

      const t = (point.y - minY) / yRange;
      const color = baseColor.clone().lerp(highColor, t);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    });

    this.pathLineMesh = new THREE.Line(geometry, material);
    this.scene.add(this.pathLineMesh);
  }

  private updateClickedMarker(): void {
    if (!this.clickedPoint) {
      this.uiManager.hideElevationMarker();
      return;
    }

    const screenPos = this.uiManager.getScreenPosition(
      new THREE.Vector3(this.clickedPoint.x, this.clickedPoint.y + 5, this.clickedPoint.z),
      this.camera,
      window.innerWidth,
      window.innerHeight
    );

    if (screenPos.visible) {
      this.uiManager.showElevationMarker(
        screenPos.x,
        screenPos.y,
        this.clickedPoint.y,
        this.clickedPointInfo?.distance,
        this.clickedPointInfo?.slope
      );
    } else {
      this.uiManager.hideElevationMarker();
    }
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    this.interactionManager.update(delta);
    this.updateClickedMarker();
    this.uiManager.updateFPS();

    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.interactionManager.dispose();
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.dispose();
  }
}

let simulator: HikingSimulator | null = null;

function bootstrap(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      simulator = new HikingSimulator();
    });
  } else {
    simulator = new HikingSimulator();
  }
}

bootstrap();

export { HikingSimulator };
export default HikingSimulator;
