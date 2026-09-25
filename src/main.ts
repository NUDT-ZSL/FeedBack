import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FurnitureManager, FurnitureItem } from './furniture';
import { UIManager } from './ui';

const ROOM_SIZE = 10;
const WALL_HEIGHT = 4;

class App {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private furnitureManager: FurnitureManager;
  private uiManager: UIManager;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private groundPlane: THREE.Mesh;
  private isMouseDown: boolean = false;
  private mouseDownPos: THREE.Vector2 = new THREE.Vector2();
  private hasMoved: boolean = false;

  constructor() {
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xFFF8E7);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(8, 8, 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const container = document.getElementById('canvas-container');
    if (!container) throw new Error('Canvas container not found');
    container.appendChild(this.renderer.domElement);

    this.groundPlane = this.createRoom();
    this.createLighting();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 20;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.furnitureManager = new FurnitureManager(this.scene, this.groundPlane, this.raycaster);
    
    this.uiManager = new UIManager('toolbar', {
      onAddFurniture: (type: string) => this.addFurniture(type),
      onRotate: () => this.rotateFurniture(),
      onDelete: () => this.deleteFurniture()
    });

    this.furnitureManager.setOnSelectChange((item: FurnitureItem | null) => {
      this.uiManager.setSelectedItem(item);
    });

    this.setupEventListeners();
    this.animate();

    this.addFurniture('sofa');
    this.addFurniture('table');
    this.addFurniture('chair');
  }

  private createRoom(): THREE.Mesh {
    const group = new THREE.Group();

    const groundGeometry = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xD0D0D0,
      roughness: 0.9,
      metalness: 0
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide
    });

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, WALL_HEIGHT),
      wallMaterial
    );
    backWall.position.set(0, WALL_HEIGHT / 2, -ROOM_SIZE / 2);
    backWall.receiveShadow = true;
    group.add(backWall);

    const leftWall = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, WALL_HEIGHT),
      wallMaterial
    );
    leftWall.position.set(-ROOM_SIZE / 2, WALL_HEIGHT / 2, 0);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    group.add(leftWall);

    const rightWall = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, WALL_HEIGHT),
      wallMaterial
    );
    rightWall.position.set(ROOM_SIZE / 2, WALL_HEIGHT / 2, 0);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    group.add(rightWall);

    const gridHelper = new THREE.GridHelper(ROOM_SIZE, 20, 0xC0C0C0, 0xE0E0E0);
    gridHelper.position.y = 0.001;
    group.add(gridHelper);

    this.scene.add(group);

    return ground;
  }

  private createLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(5, 8, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -8;
    mainLight.shadow.camera.right = 8;
    mainLight.shadow.camera.top = 8;
    mainLight.shadow.camera.bottom = -8;
    mainLight.shadow.bias = -0.0001;
    this.scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xfff8e7, 0.3);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xd0d0d0, 0.4);
    hemiLight.position.set(0, 10, 0);
    this.scene.add(hemiLight);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.renderer.domElement.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.renderer.domElement.addEventListener('mouseleave', () => this.onMouseUp());
  }

  private updateMouse(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    
    this.isMouseDown = true;
    this.hasMoved = false;
    this.mouseDownPos.set(e.clientX, e.clientY);
    this.updateMouse(e);

    if (!this.furnitureManager.isDraggingActive()) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);
      
      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj.parent && !obj.userData.isFurniture && !obj.userData.furnitureItem) {
          obj = obj.parent;
        }
        
        const item = obj.userData.furnitureItem as FurnitureItem | undefined;
        if (item) {
          this.furnitureManager.selectItem(item);
          this.controls.enabled = false;
          this.furnitureManager.startDrag(item, this.mouse, this.camera);
          return;
        }
      }
      
      this.furnitureManager.selectItem(null);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    this.updateMouse(e);
    
    if (this.isMouseDown && !this.hasMoved) {
      const dx = e.clientX - this.mouseDownPos.x;
      const dy = e.clientY - this.mouseDownPos.y;
      if (dx * dx + dy * dy > 25) {
        this.hasMoved = true;
      }
    }
    
    if (this.furnitureManager.isDraggingActive()) {
      this.furnitureManager.updateDrag(this.mouse, this.camera);
    }
  }

  private onMouseUp(): void {
    if (this.furnitureManager.isDraggingActive()) {
      this.furnitureManager.endDrag();
    }
    this.controls.enabled = true;
    this.isMouseDown = false;
    this.hasMoved = false;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private addFurniture(type: string): void {
    this.furnitureManager.createFurniture(type);
  }

  private rotateFurniture(): void {
    this.furnitureManager.rotateSelected();
  }

  private deleteFurniture(): void {
    this.furnitureManager.deleteSelected();
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    
    const delta = this.clock.getDelta();
    
    this.controls.update();
    this.furnitureManager.animate(delta);
    
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.furnitureManager.dispose();
    this.uiManager.dispose();
    this.renderer.dispose();
  }
}

const app = new App();

window.addEventListener('beforeunload', () => {
  app.dispose();
});
