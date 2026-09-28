import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  private static _instance: SceneManager;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  public clock: THREE.Clock;
  
  private _fps: number = 0;
  private _frames: number = 0;
  private _lastFpsUpdate: number = 0;
  private _animationId: number = 0;
  private _updateCallbacks: Array<(delta: number) => void> = [];
  private _gridHelper: THREE.GridHelper | null = null;
  private _ground: THREE.Mesh | null = null;

  private constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(80, 60, 80);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    this.controls.minPolarAngle = 0;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    
    this.clock = new THREE.Clock();
    
    this._initLights();
    this._initGround();
    this._initGrid();
    this._bindEvents();
  }

  public static get instance(): SceneManager {
    if (!SceneManager._instance) {
      SceneManager._instance = new SceneManager();
    }
    return SceneManager._instance;
  }

  private _initLights(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    ambientLight.name = 'ambientLight';
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    this.scene.add(directionalLight);
  }

  private _initGround(): void {
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
      metalness: 0.1
    });
    this._ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this._ground.rotation.x = -Math.PI / 2;
    this._ground.position.y = -0.01;
    this._ground.receiveShadow = true;
    this._ground.name = 'ground';
    this.scene.add(this._ground);
  }

  private _initGrid(): void {
    this._gridHelper = new THREE.GridHelper(500, 50, 0x444466, 0x333355);
    this._gridHelper.position.y = 0;
    this.scene.add(this._gridHelper);
  }

  private _bindEvents(): void {
    window.addEventListener('resize', this._onResize.bind(this));
  }

  private _onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public addObject(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  public removeObject(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  public onUpdate(callback: (delta: number) => void): void {
    this._updateCallbacks.push(callback);
  }

  public offUpdate(callback: (delta: number) => void): void {
    const index = this._updateCallbacks.indexOf(callback);
    if (index > -1) {
      this._updateCallbacks.splice(index, 1);
    }
  }

  public startAnimation(): void {
    const animate = () => {
      this._animationId = requestAnimationFrame(animate);
      
      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();
      
      this._frames++;
      if (elapsed - this._lastFpsUpdate >= 1) {
        this._fps = this._frames;
        this._frames = 0;
        this._lastFpsUpdate = elapsed;
      }
      
      this.controls.update();
      
      for (const callback of this._updateCallbacks) {
        callback(delta);
      }
      
      this.renderer.render(this.scene, this.camera);
    };
    
    animate();
  }

  public stopAnimation(): void {
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = 0;
    }
  }

  public get fps(): number {
    return this._fps;
  }

  public get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public getAmbientLight(): THREE.AmbientLight | null {
    return this.scene.getObjectByName('ambientLight') as THREE.AmbientLight || null;
  }

  public raycastFromScreen(screenX: number, screenY: number, objects: THREE.Object3D[]): THREE.Intersection | null {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    mouse.x = (screenX / window.innerWidth) * 2 - 1;
    mouse.y = -(screenY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, this.camera);
    
    const intersects = raycaster.intersectObjects(objects, false);
    return intersects.length > 0 ? intersects[0] : null;
  }

  public getGroundPlane(): THREE.Mesh | null {
    return this._ground;
  }

  public getGridHelper(): THREE.GridHelper | null {
    return this._gridHelper;
  }

  public dispose(): void {
    this.stopAnimation();
    window.removeEventListener('resize', this._onResize.bind(this));
    this.renderer.dispose();
    this.controls.dispose();
  }
}

export const sceneManager = SceneManager.instance;
