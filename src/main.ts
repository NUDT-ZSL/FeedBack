import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectManager } from './EffectManager';
import { BookManager } from './BookManager';
import { UIManager } from './UIManager';

type RepairState = 'idle' | 'repairing' | 'binding' | 'complete';

class AncientBookRestoration {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock: THREE.Clock = new THREE.Clock();
  private effectManager: EffectManager;
  private bookManager: BookManager;
  private uiManager: UIManager;
  private state: RepairState = 'idle';
  private ambientLight: THREE.AmbientLight | null = null;
  private mainLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private roomGroup: THREE.Group = new THREE.Group();
  private animationId: number | null = null;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fps: number = 0;

  private readonly ROOM_WIDTH = 12;
  private readonly ROOM_HEIGHT = 6;
  private readonly ROOM_DEPTH = 9;
  private readonly DESK_WIDTH = 3;
  private readonly DESK_DEPTH = 2;

  constructor() {
    const canvasContainer = document.getElementById('canvas-container');
    const uiContainer = document.getElementById('ui-container');
    if (!canvasContainer || !uiContainer) {
      throw new Error('Container elements not found');
    }
    this.container = canvasContainer;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.effectManager = new EffectManager(this.scene);
    this.bookManager = new BookManager(this.scene, this.effectManager);
    this.uiManager = new UIManager(
      uiContainer,
      this.camera,
      this.renderer,
      this.bookManager,
      this.effectManager
    );
    this.init();
  }

  private init(): void {
    this.setupRenderer();
    this.setupCamera();
    this.setupControls();
    this.setupLights();
    this.setupRoom();
    this.setupManagers();
    this.setupEventListeners();
    this.startAnimationLoop();
    this.state = 'repairing';
  }

  private setupRenderer(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  private setupCamera(): void {
    this.camera.position.set(2.5, 3.5, 4);
    this.camera.lookAt(0, 0.8, 0);
  }

  private setupControls(): void {
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minPolarAngle = Math.PI / 4;
    this.controls.target.set(0, 0.8, 0);
    this.controls.enablePan = false;
  }

  private setupLights(): void {
    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.6);
    this.scene.add(this.ambientLight);
    this.mainLight = new THREE.DirectionalLight(0xfff8e7, 1.2);
    this.mainLight.position.set(5, 8, 6);
    this.mainLight.castShadow = true;
    this.mainLight.shadow.mapSize.width = 2048;
    this.mainLight.shadow.mapSize.height = 2048;
    this.mainLight.shadow.camera.near = 0.5;
    this.mainLight.shadow.camera.far = 30;
    this.mainLight.shadow.camera.left = -8;
    this.mainLight.shadow.camera.right = 8;
    this.mainLight.shadow.camera.top = 8;
    this.mainLight.shadow.camera.bottom = -8;
    this.mainLight.shadow.bias = -0.0005;
    this.scene.add(this.mainLight);
    this.fillLight = new THREE.DirectionalLight(0x87ceeb, 0.3);
    this.fillLight.position.set(-4, 6, -3);
    this.scene.add(this.fillLight);
    const rimLight = new THREE.DirectionalLight(0xffe4c4, 0.4);
    rimLight.position.set(-3, 4, 5);
    this.scene.add(rimLight);
  }

  private setupRoom(): void {
    this.scene.add(this.roomGroup);
    this.createFloor();
    this.createWallsAndBookshelves();
    this.createDesk();
    this.createDecorations();
  }

  private createFloor(): void {
    const floorGeometry = new THREE.PlaneGeometry(this.ROOM_WIDTH, this.ROOM_DEPTH);
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 1024;
    floorCanvas.height = 1024;
    const floorCtx = floorCanvas.getContext('2d')!;
    floorCtx.fillStyle = '#5c3a21';
    floorCtx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 12; i++) {
      floorCtx.fillStyle = i % 2 === 0 ? '#4a2e1a' : '#5c3a21';
      floorCtx.fillRect(0, i * 85, 1024, 83);
      floorCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      floorCtx.lineWidth = 2;
      floorCtx.beginPath();
      floorCtx.moveTo(0, i * 85 + 83);
      floorCtx.lineTo(1024, i * 85 + 83);
      floorCtx.stroke();
    }
    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(2, 1.5);
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.8,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.roomGroup.add(floor);
  }

  private createWallsAndBookshelves(): void {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8a082,
      roughness: 0.9,
      side: THREE.BackSide
    });
    const wallGeometry = new THREE.BoxGeometry(
      this.ROOM_WIDTH,
      this.ROOM_HEIGHT,
      this.ROOM_DEPTH
    );
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.position.y = this.ROOM_HEIGHT / 2;
    this.roomGroup.add(walls);
    this.createBookshelf(-this.ROOM_WIDTH / 2 + 0.15, 0, 0, Math.PI / 2);
    this.createBookshelf(this.ROOM_WIDTH / 2 - 0.15, 0, 0, -Math.PI / 2);
    this.createBookshelf(0, 0, -this.ROOM_DEPTH / 2 + 0.15, 0);
    this.createBookshelf(0, 0, this.ROOM_DEPTH / 2 - 0.15, Math.PI);
  }

  private createBookshelf(x: number, _y: number, z: number, rotationY: number): void {
    const shelfGroup = new THREE.Group();
    const woodMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.7,
      metalness: 0.1
    });
    const shelfWidth = Math.abs(rotationY) === Math.PI / 2 ? this.ROOM_DEPTH - 1 : this.ROOM_WIDTH - 1;
    const shelfHeight = this.ROOM_HEIGHT - 0.5;
    const shelfDepth = 0.4;
    const backGeometry = new THREE.BoxGeometry(shelfWidth, shelfHeight, 0.05);
    const back = new THREE.Mesh(backGeometry, woodMaterial);
    back.position.z = shelfDepth / 2;
    shelfGroup.add(back);
    for (let i = 0; i < 5; i++) {
      const shelfBoard = new THREE.Mesh(
        new THREE.BoxGeometry(shelfWidth, 0.05, shelfDepth),
        woodMaterial
      );
      shelfBoard.position.y = -shelfHeight / 2 + 0.3 + i * (shelfHeight - 0.6) / 4;
      shelfBoard.position.z = 0;
      shelfBoard.receiveShadow = true;
      shelfGroup.add(shelfBoard);
    }
    this.fillBooks(shelfGroup, shelfWidth, shelfHeight);
    shelfGroup.position.set(x, shelfHeight / 2, z);
    shelfGroup.rotation.y = rotationY;
    this.roomGroup.add(shelfGroup);
  }

  private fillBooks(shelfGroup: THREE.Group, shelfWidth: number, shelfHeight: number): void {
    const bookColors = [0x8b4513, 0x654321, 0xa0522d, 0x8b0000, 0x2f4f4f, 0x556b2f];
    const scrollColors = [0xd4c5a9, 0xc4a35a, 0xb8860b];
    for (let row = 0; row < 4; row++) {
      const rowY = -shelfHeight / 2 + 0.55 + row * (shelfHeight - 0.6) / 4;
      let xPos = -shelfWidth / 2 + 0.2;
      while (xPos < shelfWidth / 2 - 0.2) {
        if (Math.random() > 0.25) {
          const bookHeight = 0.25 + Math.random() * 0.15;
          const bookWidth = 0.08 + Math.random() * 0.08;
          const bookDepth = 0.3 + Math.random() * 0.08;
          const bookMaterial = new THREE.MeshStandardMaterial({
            color: bookColors[Math.floor(Math.random() * bookColors.length)],
            roughness: 0.8
          });
          const book = new THREE.Mesh(
            new THREE.BoxGeometry(bookWidth, bookHeight, bookDepth),
            bookMaterial
          );
          book.position.set(xPos + bookWidth / 2, rowY + bookHeight / 2 - 0.05, -0.02);
          book.rotation.y = (Math.random() - 0.5) * 0.1;
          book.castShadow = true;
          book.receiveShadow = true;
          shelfGroup.add(book);
          xPos += bookWidth + 0.01;
        } else {
          const scrollRadius = 0.06 + Math.random() * 0.04;
          const scrollLength = 0.25 + Math.random() * 0.15;
          const scrollMaterial = new THREE.MeshStandardMaterial({
            color: scrollColors[Math.floor(Math.random() * scrollColors.length)],
            roughness: 0.7
          });
          const scroll = new THREE.Mesh(
            new THREE.CylinderGeometry(scrollRadius, scrollRadius, scrollLength, 16),
            scrollMaterial
          );
          scroll.rotation.z = Math.PI / 2;
          scroll.position.set(xPos + scrollLength / 2, rowY + scrollRadius, -0.05);
          scroll.castShadow = true;
          shelfGroup.add(scroll);
          xPos += scrollLength + 0.03;
        }
      }
    }
  }

  private createDesk(): void {
    const deskGroup = new THREE.Group();
    const woodMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b4423,
      roughness: 0.6,
      metalness: 0.1
    });
    const topGeometry = new THREE.BoxGeometry(this.DESK_WIDTH, 0.08, this.DESK_DEPTH);
    const top = new THREE.Mesh(topGeometry, woodMaterial);
    top.position.y = 0.04;
    top.castShadow = true;
    top.receiveShadow = true;
    deskGroup.add(top);
    const legGeometry = new THREE.BoxGeometry(0.12, 0.75, 0.12);
    const legPositions = [
      [-this.DESK_WIDTH / 2 + 0.15, -0.375, -this.DESK_DEPTH / 2 + 0.15],
      [this.DESK_WIDTH / 2 - 0.15, -0.375, -this.DESK_DEPTH / 2 + 0.15],
      [-this.DESK_WIDTH / 2 + 0.15, -0.375, this.DESK_DEPTH / 2 - 0.15],
      [this.DESK_WIDTH / 2 - 0.15, -0.375, this.DESK_DEPTH / 2 - 0.15]
    ];
    for (const pos of legPositions) {
      const leg = new THREE.Mesh(legGeometry, woodMaterial);
      leg.position.set(pos[0], pos[1], pos[2]);
      leg.castShadow = true;
      deskGroup.add(leg);
    }
    const clothCanvas = document.createElement('canvas');
    clothCanvas.width = 512;
    clothCanvas.height = 512;
    const clothCtx = clothCanvas.getContext('2d')!;
    clothCtx.fillStyle = '#8baa9a';
    clothCtx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5000; i++) {
      clothCtx.fillStyle = `rgba(100, 130, 120, ${Math.random() * 0.2})`;
      clothCtx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const clothTexture = new THREE.CanvasTexture(clothCanvas);
    clothTexture.colorSpace = THREE.SRGBColorSpace;
    const clothMaterial = new THREE.MeshStandardMaterial({
      map: clothTexture,
      roughness: 0.95,
      metalness: 0.05
    });
    const clothGeometry = new THREE.PlaneGeometry(
      this.DESK_WIDTH - 0.1,
      this.DESK_DEPTH - 0.1,
      16,
      16
    );
    const cloth = new THREE.Mesh(clothGeometry, clothMaterial);
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = 0.085;
    cloth.receiveShadow = true;
    deskGroup.add(cloth);
    deskGroup.position.y = 0.78;
    this.roomGroup.add(deskGroup);
  }

  private createDecorations(): void {
    const inkStone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.18, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 })
    );
    inkStone.position.set(1.2, 0.85, 0.5);
    inkStone.castShadow = true;
    this.roomGroup.add(inkStone);
    const ink = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.2 })
    );
    ink.position.set(1.2, 0.88, 0.5);
    this.roomGroup.add(ink);
    const brushHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.025, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7 })
    );
    brushHandle.position.set(1.45, 0.92, 0.45);
    brushHandle.rotation.z = Math.PI / 6;
    this.roomGroup.add(brushHandle);
    const brushTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 })
    );
    brushTip.position.set(1.58, 0.99, 0.38);
    brushTip.rotation.z = Math.PI / 6;
    this.roomGroup.add(brushTip);
    const paperWeight = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.02, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.6, metalness: 0.3 })
    );
    paperWeight.rotation.x = Math.PI / 2;
    paperWeight.position.set(-1.1, 0.86, 0.5);
    paperWeight.castShadow = true;
    this.roomGroup.add(paperWeight);
  }

  private setupManagers(): void {
    this.bookManager.createBook(new THREE.Vector3(0, 0.82, 0));
    this.uiManager.setOnBindCallback(() => {
      this.startBinding();
    });
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private startBinding(): void {
    if (this.state !== 'repairing') return;
    this.state = 'binding';
    this.uiManager.hideForScroll();
    this.controls.enabled = false;
    const targetPos = new THREE.Vector3(0, 2.5, 3);
    const startPos = this.camera.position.clone();
    const startTime = performance.now();
    const duration = 1500;
    const animateCamera = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const easedT = this.effectManager.easeInOutCustom(t);
      this.camera.position.lerpVectors(startPos, targetPos, easedT);
      this.controls.target.lerp(new THREE.Vector3(0, 0.85, 0), easedT);
      this.camera.lookAt(this.controls.target);
      if (t < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        this.bookManager.startScrollAnimation();
        setTimeout(() => {
          this.state = 'complete';
          this.controls.enabled = true;
          this.uiManager.showAfterScroll();
        }, 4500);
      }
    };
    animateCamera();
  }

  private startAnimationLoop(): void {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      const deltaTime = this.clock.getDelta();
      const elapsedTime = this.clock.getElapsedTime();
      this.update(deltaTime, elapsedTime);
      this.render();
      this.updateFPS();
    };
    animate();
  }

  private update(deltaTime: number, elapsedTime: number): void {
    this.controls.update();
    this.effectManager.update(deltaTime);
    this.bookManager.update(deltaTime);
    this.uiManager.update(deltaTime);
    if (this.mainLight) {
      this.mainLight.intensity = 1.2 + Math.sin(elapsedTime * 0.3) * 0.05;
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
      if (this.fps < 30) {
        console.warn(`Low FPS: ${this.fps}. Active particles: ${this.effectManager.getActiveParticleCount()}`);
      }
    }
  }

  public getState(): RepairState {
    return this.state;
  }

  public getFPS(): number {
    return this.fps;
  }

  public dispose(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    this.effectManager.dispose();
    this.bookManager.dispose();
    this.uiManager.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

let app: AncientBookRestoration | null = null;

try {
  app = new AncientBookRestoration();
} catch (error) {
  console.error('Failed to initialize application:', error);
}

export default app;
