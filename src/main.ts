import * as THREE from 'three';
import {
  generateTerrain,
  getHeightAt,
  generateSmoothPath,
  calculatePathMetrics,
  type TerrainData
} from './terrain';
import { InteractionManager } from './interaction';
import { UIManager } from './ui';

class HikingSimulator {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private appElement: HTMLElement;

  private terrainData!: TerrainData;
  private terrainMesh!: THREE.Mesh;
  private pathPoints: THREE.Vector3[] = [];
  private pathPointMeshes: THREE.Mesh[] = [];
  private smoothedPath: THREE.Vector3[] = [];
  private pathLineMesh!: THREE.Line | null;
  private highlightedPointMesh: THREE.Mesh | null = null;
  private clickedPoint: THREE.Vector3 | null = null;
  private clickedPointInfo: { distance?: number; slope?: number } | null = null;

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
      this.onChartHover.bind(this)
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

    this.pathPoints = samplePoints;
    this.createPathPointMeshes();
    this.updatePath();
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
    if (this.uiManager['state'].mode !== 'edit') return;

    const existingIndex = this.findNearbyPathPoint(point);
    if (existingIndex >= 0) {
      this.removePathPoint(existingIndex);
      return;
    }

    this.pathPoints.push(point.clone());
    this.createPathPointMeshes();
    this.updatePath();

    this.clickedPoint = point.clone();
    this.clickedPointInfo = null;
  }

  private onPathPointClick(index: number, point: THREE.Vector3): void {
    if (this.smoothedPath.length < 2) {
      this.clickedPoint = point.clone();
      this.clickedPointInfo = null;
      return;
    }

    const metrics = calculatePathMetrics(this.smoothedPath);
    const controlPointIndex = Math.min(
      Math.floor((index / Math.max(1, this.pathPointMeshes.length - 1)) * (this.smoothedPath.length - 1)),
      this.smoothedPath.length - 1
    );

    this.clickedPoint = point.clone();
    this.clickedPointInfo = {
      distance: metrics.distances[controlPointIndex],
      slope: metrics.slopes[controlPointIndex]
    };
  }

  private onMouseMove(point: THREE.Vector3 | null): void {
    this.uiManager.updateElevation(point);
  }

  private onModeChange(mode: 'roam' | 'edit'): void {
    this.uiManager.setMode(mode);
    if (mode === 'roam' && this.smoothedPath.length > 1) {
      this.interactionManager.setMode('roam', this.smoothedPath);
    } else {
      this.interactionManager.setMode('edit');
    }
  }

  private onChartHover(pathIndex: number): void {
    if (this.highlightedPointMesh) {
      this.scene.remove(this.highlightedPointMesh);
      this.highlightedPointMesh = null;
    }

    if (pathIndex >= 0 && this.smoothedPath[pathIndex]) {
      const point = this.smoothedPath[pathIndex];
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

  private findNearbyPathPoint(point: THREE.Vector3, threshold: number = 15): number {
    for (let i = 0; i < this.pathPoints.length; i++) {
      const dx = point.x - this.pathPoints[i].x;
      const dz = point.z - this.pathPoints[i].z;
      if (Math.sqrt(dx * dx + dz * dz) < threshold) {
        return i;
      }
    }
    return -1;
  }

  private removePathPoint(index: number): void {
    this.pathPoints.splice(index, 1);
    this.createPathPointMeshes();
    this.updatePath();
  }

  private createPathPointMeshes(): void {
    for (const mesh of this.pathPointMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.pathPointMeshes = [];

    for (let i = 0; i < this.pathPoints.length; i++) {
      const isStart = i === 0;
      const isEnd = i === this.pathPoints.length - 1;
      const geometry = new THREE.SphereGeometry(isStart || isEnd ? 7 : 5, 16, 16);
      const material = new THREE.MeshStandardMaterial({
        color: isStart ? 0x4caf50 : isEnd ? 0xff3333 : 0xff6f00,
        emissive: isStart ? 0x1a3a1a : isEnd ? 0x3a1a1a : 0x3a1a00,
        emissiveIntensity: 0.3,
        roughness: 0.4,
        metalness: 0.1
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.pathPoints[i]);
      mesh.position.y += 5;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.pathPointMeshes.push(mesh);
    }

    this.interactionManager.setPathPointMeshes(this.pathPointMeshes);
  }

  private updatePath(): void {
    if (this.pathLineMesh) {
      this.scene.remove(this.pathLineMesh);
      this.pathLineMesh.geometry.dispose();
      (this.pathLineMesh.material as THREE.Material).dispose();
      this.pathLineMesh = null;
    }

    if (this.pathPoints.length < 2) {
      this.smoothedPath = [];
      this.uiManager.updatePathData(this.pathPoints, this.smoothedPath);
      return;
    }

    this.smoothedPath = generateSmoothPath(this.pathPoints, this.terrainData, 15);

    const positions = new Float32Array(this.smoothedPath.length * 3);
    const colors = new Float32Array(this.smoothedPath.length * 3);
    const baseColor = new THREE.Color('#ff6f00');
    const highColor = new THREE.Color('#ffcc00');

    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.smoothedPath) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const yRange = maxY - minY || 1;

    for (let i = 0; i < this.smoothedPath.length; i++) {
      const point = this.smoothedPath[i];
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

    this.uiManager.updatePathData(this.pathPoints, this.smoothedPath);
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
