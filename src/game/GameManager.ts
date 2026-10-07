import * as THREE from 'three';
import { GameState, HerbData, FurnaceSlot, PillData, GameEvents } from '../types';
import { TerrainGenerator } from './TerrainGenerator';
import { Herb } from './Herb';
import { Player } from './Player';
import { Furnace } from './Furnace';
import { Pill } from './Pill';

export class GameManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private state: GameState = 'exploring';
  private events: GameEvents;
  
  private terrainGenerator: TerrainGenerator;
  private terrainMesh: THREE.Group | null = null;
  private herbs: Herb[] = [];
  private collectedHerbs: HerbData[] = [];
  
  private player: Player;
  private furnace: Furnace;
  private pill: Pill | null = null;
  
  private keys: Record<string, boolean> = {};
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  
  private refiningRoomScene: THREE.Scene | null = null;
  private refiningRoomCamera: THREE.PerspectiveCamera | null = null;
  
  private screenVignette: THREE.Mesh | null = null;
  private vignetteActive: boolean = false;
  private vignetteTime: number = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, events: GameEvents) {
    this.scene = scene;
    this.camera = camera;
    this.events = events;
    
    this.terrainGenerator = new TerrainGenerator(100, 64);
    this.player = new Player();
    this.furnace = new Furnace();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    this.setupInputHandlers();
    this.initializeValleyScene();
  }

  private setupInputHandlers(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
      
      if (e.key === 'e' || e.key === 'E') {
        this.tryCollectNearbyHerb();
      }
      if (e.key === 'r' || e.key === 'R') {
        this.switchToRefining();
      }
      if (e.key === 'Escape') {
        if (this.state === 'refining') {
          this.switchToExploring();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
    });

    window.addEventListener('click', (e) => {
      if (this.state === 'exploring') {
        this.handleValleyClick(e);
      }
    });
  }

  private initializeValleyScene(): void {
    const terrainData = this.terrainGenerator.generate();
    this.terrainMesh = terrainData.mesh;
    this.herbs = terrainData.herbs;
    
    this.scene.add(this.terrainMesh);
    this.scene.add(this.player.getMesh());
    
    this.scene.fog = terrainData.mesh.userData.fog;
    
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    this.scene.add(directionalLight);
    
    const startHeight = this.terrainGenerator.getHeightAt(0, 0);
    this.player.setPosition(new THREE.Vector3(0, startHeight, 0));
    
    this.createScreenVignette();
  }

  private createScreenVignette(): void {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        active: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float active;
        varying vec2 vUv;
        
        void main() {
          vec2 center = vec2(0.5, 0.5);
          float dist = distance(vUv, center);
          
          vec3 innerColor = vec3(1.0, 0.8, 0.0);
          vec3 outerColor = vec3(0.8, 0.1, 0.0);
          
          float gradient = smoothstep(0.0, 0.7, dist);
          vec3 color = mix(innerColor, outerColor, gradient);
          
          float alpha = active * (1.0 - smoothstep(0.2, 0.7, dist)) * 0.6;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthTest: false
    });
    
    this.screenVignette = new THREE.Mesh(geometry, material);
    this.screenVignette.position.z = -1;
  }

  private handleValleyClick(event: MouseEvent): void {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const herbMeshes = this.herbs.map(h => h.getMesh());
    const intersects = this.raycaster.intersectObjects(herbMeshes, true);
    
    if (intersects.length > 0) {
      let targetHerb: Herb | null = null;
      let targetObject = intersects[0].object;
      
      while (targetObject.parent && !targetHerb) {
        targetHerb = this.herbs.find(h => h.getMesh() === targetObject) || null;
        targetObject = targetObject.parent;
      }
      
      if (targetHerb) {
        this.player.moveTo(targetHerb.getPosition());
      }
    } else {
      const groundIntersects = this.raycaster.intersectObject(this.terrainMesh!, true);
      if (groundIntersects.length > 0) {
        const point = groundIntersects[0].point;
        this.player.moveTo(point);
      }
    }
  }

  private tryCollectNearbyHerb(): void {
    if (this.state !== 'exploring') return;
    
    const playerPos = this.player.getPosition();
    
    for (let i = this.herbs.length - 1; i >= 0; i--) {
      const herb = this.herbs[i];
      const distance = playerPos.distanceTo(herb.getPosition());
      
      if (distance < 2) {
        this.collectHerb(herb, i);
        break;
      }
    }
  }

  private collectHerb(herb: Herb, index: number): void {
    this.player.startPicking();
    
    const basketPos = this.player.getBasketPosition();
    
    herb.collectAnimation(basketPos, () => {
      const herbData = herb.getData();
      this.collectedHerbs.push(herbData);
      
      herb.dispose();
      this.herbs.splice(index, 1);
      if (this.terrainMesh) {
        this.terrainMesh.remove(herb.getMesh());
      }
      
      this.player.finishPicking();
      this.events.onHerbCollected(herbData);
      this.updateUI();
    });
  }

  private switchToRefining(): void {
    if (this.collectedHerbs.length < 5) {
      this.events.onUIUpdate({
        type: 'notification',
        message: '至少需要5株草药才能炼丹！'
      });
      return;
    }
    
    this.state = 'refining';
    this.createRefiningRoom();
    this.events.onStateChange('refining');
  }

  private createRefiningRoom(): void {
    this.refiningRoomScene = new THREE.Scene();
    this.refiningRoomScene.background = new THREE.Color(0x4a1a1a);
    
    this.refiningRoomCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.refiningRoomCamera.position.set(0, 5, 10);
    this.refiningRoomCamera.lookAt(0, 1, 0);
    
    const ambientLight = new THREE.AmbientLight(0x402020, 0.5);
    this.refiningRoomScene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xff6600, 1, 20);
    pointLight.position.set(0, 4, 0);
    this.refiningRoomScene.add(pointLight);
    
    const floorGeometry = new THREE.PlaneGeometry(15, 15);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a1a1a,
      roughness: 0.9
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.refiningRoomScene.add(floor);
    
    this.refiningRoomScene.add(this.furnace.getMesh());
    
    const wallGeometry = new THREE.BoxGeometry(15, 8, 0.5);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a0a0a,
      roughness: 0.9
    });
    
    const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
    backWall.position.set(0, 4, -7.5);
    this.refiningRoomScene.add(backWall);
    
    const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-7.5, 4, 0);
    this.refiningRoomScene.add(leftWall);
    
    const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(7.5, 4, 0);
    this.refiningRoomScene.add(rightWall);
    
    const torchPositions = [
      { x: -6, z: -6 },
      { x: 6, z: -6 },
      { x: -6, z: 6 },
      { x: 6, z: 6 }
    ];
    
    torchPositions.forEach(pos => {
      const torch = this.createTorch();
      torch.position.set(pos.x, 2, pos.z);
      this.refiningRoomScene!.add(torch);
    });
  }

  private createTorch(): THREE.Group {
    const torch = new THREE.Group();
    
    const handleGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1, 8);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = 0.5;
    torch.add(handle);
    
    const fireGeometry = new THREE.ConeGeometry(0.15, 0.4, 8);
    const fireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.8
    });
    const fire = new THREE.Mesh(fireGeometry, fireMaterial);
    fire.position.y = 1.2;
    fire.userData = { isFire: true, baseScale: 1 };
    torch.add(fire);
    
    const light = new THREE.PointLight(0xff6600, 0.5, 5);
    light.position.y = 1.2;
    torch.add(light);
    
    return torch;
  }

  private switchToExploring(): void {
    this.state = 'exploring';
    this.refiningRoomScene = null;
    this.refiningRoomCamera = null;
    this.events.onStateChange('exploring');
  }

  public dropHerbToSlot(herbId: string, slotIndex: number): boolean {
    const herbIndex = this.collectedHerbs.findIndex(h => h.id === herbId);
    if (herbIndex === -1) return false;
    
    const herbData = this.collectedHerbs[herbIndex];
    const isCorrect = this.furnace.placeHerb(herbData, slotIndex);
    
    if (isCorrect) {
      this.collectedHerbs.splice(herbIndex, 1);
    }
    
    this.events.onFurnaceUpdate(this.furnace.getSlots(), this.furnace.getCurrentColor());
    this.updateUI();
    
    if (this.furnace.isAllSlotsFilled()) {
      this.startRefining();
    }
    
    return isCorrect;
  }

  private startRefining(): void {
    this.furnace.startRefining();
    this.events.onRefiningStart();
    
    this.vignetteActive = true;
    this.vignetteTime = 0;
  }

  private onRefiningComplete(): void {
    const pillData = this.furnace.generatePill();
    this.pill = new Pill(pillData);
    this.pill.setPosition(new THREE.Vector3(0, 1.5, 0));
    
    if (this.refiningRoomScene) {
      this.refiningRoomScene.add(this.pill.getMesh());
    }
    
    this.vignetteActive = false;
    this.state = 'result';
    this.events.onRefiningComplete(pillData);
    this.events.onStateChange('result');
  }

  public update(deltaTime: number): void {
    if (this.state === 'exploring') {
      this.updateValleyScene(deltaTime);
    } else if (this.state === 'refining' || this.state === 'result') {
      this.updateRefiningScene(deltaTime);
    }
    
    if (this.vignetteActive) {
      this.vignetteTime += deltaTime;
      if (this.screenVignette) {
        (this.screenVignette.material as THREE.ShaderMaterial).uniforms.time.value = this.vignetteTime;
        (this.screenVignette.material as THREE.ShaderMaterial).uniforms.active.value = 1.0;
      }
    } else if (this.screenVignette) {
      (this.screenVignette.material as THREE.ShaderMaterial).uniforms.active.value = 0.0;
    }
  }

  private updateValleyScene(deltaTime: number): void {
    this.player.update(deltaTime, this.keys, (x, z) => this.terrainGenerator.getHeightAt(x, z));
    
    this.herbs.forEach(herb => herb.update(deltaTime));
    
    if (this.terrainMesh) {
      this.terrainMesh.traverse((child) => {
        this.terrainGenerator.updateStreamAnimation(child, deltaTime);
      });
    }
    
    const playerPos = this.player.getPosition();
    this.camera.position.set(
      playerPos.x + Math.sin(this.player.getState().rotation) * 8,
      playerPos.y + 6,
      playerPos.z + Math.cos(this.player.getState().rotation) * 8
    );
    this.camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z);
    
    this.checkHerbCollision();
  }

  private checkHerbCollision(): void {
    const playerPos = this.player.getPosition();
    const playerState = this.player.getState();
    
    if (playerState.isPicking || playerState.isWalking) return;
    
    for (let i = this.herbs.length - 1; i >= 0; i--) {
      const herb = this.herbs[i];
      const distance = playerPos.distanceTo(herb.getPosition());
      
      if (distance < 1.5) {
        this.collectHerb(herb, i);
        break;
      }
    }
  }

  private updateRefiningScene(deltaTime: number): void {
    const isComplete = this.furnace.update(deltaTime);
    
    if (this.refiningRoomScene) {
      this.refiningRoomScene.traverse((child) => {
        if (child.userData.isFire) {
          child.scale.y = child.userData.baseScale + Math.sin(Date.now() * 0.01) * 0.1;
        }
      });
    }
    
    if (this.pill) {
      this.pill.update(deltaTime);
    }
    
    if (isComplete) {
      this.onRefiningComplete();
    }
    
    if (this.refiningRoomCamera) {
      const time = Date.now() * 0.0005;
      this.refiningRoomCamera.position.x = Math.sin(time) * 10;
      this.refiningRoomCamera.position.z = Math.cos(time) * 10;
      this.refiningRoomCamera.lookAt(0, 1, 0);
    }
    
    this.events.onUIUpdate({
      type: 'refiningProgress',
      progress: this.furnace.getRefiningProgress()
    });
  }

  public getActiveScene(): THREE.Scene {
    return this.state === 'exploring' ? this.scene : (this.refiningRoomScene || this.scene);
  }

  public getActiveCamera(): THREE.PerspectiveCamera {
    return this.state === 'exploring' ? this.camera : (this.refiningRoomCamera || this.camera);
  }

  public getState(): GameState {
    return this.state;
  }

  public getCollectedHerbs(): HerbData[] {
    return [...this.collectedHerbs];
  }

  public getFurnaceSlots(): FurnaceSlot[] {
    return this.furnace.getSlots();
  }

  public getRefiningProgress(): number {
    return this.furnace.getRefiningProgress();
  }

  public getVignetteMesh(): THREE.Mesh | null {
    return this.screenVignette;
  }

  public getCurrentPill(): PillData | null {
    return this.pill ? this.pill.getData() : null;
  }

  public resetGame(): void {
    this.collectedHerbs = [];
    this.furnace.reset();
    this.pill = null;
    this.state = 'exploring';
    this.vignetteActive = false;
    this.refiningRoomScene = null;
    this.refiningRoomCamera = null;
    this.player.resetBasketCount();
    
    this.updateUI();
  }

  private updateUI(): void {
    this.events.onUIUpdate({
      type: 'basketUpdate',
      herbs: this.collectedHerbs,
      count: this.collectedHerbs.length
    });
    
    this.events.onFurnaceUpdate(this.furnace.getSlots(), this.furnace.getCurrentColor());
  }

  public dispose(): void {
    window.removeEventListener('keydown', () => {});
    window.removeEventListener('keyup', () => {});
    window.removeEventListener('click', () => {});
    
    this.herbs.forEach(herb => herb.dispose());
    if (this.pill) {
      this.pill.dispose();
    }
  }
}
