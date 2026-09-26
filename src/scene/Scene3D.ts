import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { eventBus } from '@/utils/EventBus';

export interface ColorOption {
  id: string;
  name: string;
  hex: string;
}

export interface MaterialOption {
  id: string;
  name: string;
  roughness: number;
  metalness: number;
}

export interface AccessoryComponent {
  type: 'wing' | 'rim' | 'spoiler';
  geometry: 'box' | 'cylinder' | 'torus';
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
}

export interface AccessoryOption {
  id: string;
  name: string;
  components: AccessoryComponent[];
}

export interface ProductConfig {
  productName: string;
  colors: ColorOption[];
  materials: MaterialOption[];
  accessories: AccessoryOption[];
  defaultConfig: {
    colorId: string;
    materialId: string;
    accessoryId: string;
  };
}

export interface ConfigChangeEvent {
  type: 'color' | 'material' | 'accessory';
  id: string;
}

interface TransitionState {
  startTime: number;
  duration: number;
  fromValue: number;
  toValue: number;
  onUpdate: (current: number) => void;
  onComplete?: () => void;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

export class Scene3D {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private productGroup: THREE.Group;
  private bodyMeshes: THREE.Mesh[] = [];
  private accessoryGroup: THREE.Group;
  private currentMaterial: MaterialOption;
  private currentColor: THREE.Color;
  private animations: TransitionState[] = [];
  private animationFrameId: number = 0;
  private clock: THREE.Clock;
  private shadowPlane: THREE.Mesh;
  private config: ProductConfig;

  constructor(container: HTMLElement, config: ProductConfig) {
    this.config = config;
    this.clock = new THREE.Clock();

    const defaultColor = config.colors.find((c) => c.id === config.defaultConfig.colorId) || config.colors[0];
    const defaultMaterial = config.materials.find((m) => m.id === config.defaultConfig.materialId) || config.materials[0];

    this.currentColor = new THREE.Color(defaultColor.hex);
    this.currentMaterial = defaultMaterial;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0B0F19');

    const gradientCanvas = document.createElement('canvas');
    gradientCanvas.width = 2;
    gradientCanvas.height = 512;
    const ctx = gradientCanvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#0B0F19');
    gradient.addColorStop(1, '#1B1629');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 512);
    const bgTexture = new THREE.CanvasTexture(gradientCanvas);
    this.scene.background = bgTexture;

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(0, 2, 5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 12;
    this.controls.target.set(0, 0.8, 0);
    this.controls.update();

    this.setupLights();

    this.productGroup = new THREE.Group();
    this.accessoryGroup = new THREE.Group();
    this.productGroup.add(this.accessoryGroup);
    this.scene.add(this.productGroup);

    this.shadowPlane = this.createShadowPlane();
    this.scene.add(this.shadowPlane);

    this.buildProduct(config);

    this.productGroup.scale.set(0, 0, 0);
    this.animateEntrance();

    this.animate();

    const configChangeHandler = (event: unknown) => {
      this.handleConfigChange(event as ConfigChangeEvent);
    };
    eventBus.on('ConfigChange', configChangeHandler);

    const resizeHandler = () => this.handleResize(container);
    window.addEventListener('resize', resizeHandler);

    (this as unknown as Record<string, unknown>)._configChangeHandler = configChangeHandler;
    (this as unknown as Record<string, unknown>)._resizeHandler = resizeHandler;
  }

  private setupLights(): void {
    const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(5, 8, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -5;
    mainLight.shadow.camera.right = 5;
    mainLight.shadow.camera.top = 5;
    mainLight.shadow.camera.bottom = -5;
    mainLight.shadow.radius = 4;
    this.scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x4A90D9, 0.4);
    fillLight.position.set(-3, 4, -3);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x4A90D9, 0.8, 15);
    rimLight.position.set(-2, 3, -4);
    this.scene.add(rimLight);

    const bottomLight = new THREE.PointLight(0x2a1a4a, 0.5, 10);
    bottomLight.position.set(0, -1, 2);
    this.scene.add(bottomLight);
  }

  private createShadowPlane(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(6, 6);
    const material = new THREE.ShadowMaterial({
      opacity: 0.3,
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    return plane;
  }

  private buildProduct(config: ProductConfig): void {
    this.bodyMeshes = [];

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.currentColor.clone(),
      roughness: this.currentMaterial.roughness,
      metalness: this.currentMaterial.metalness,
      envMapIntensity: 1.0,
    });

    const mainBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.9, 1.6, 32),
      bodyMaterial
    );
    mainBody.position.y = 0.8;
    mainBody.castShadow = true;
    mainBody.receiveShadow = true;
    this.bodyMeshes.push(mainBody);
    this.productGroup.add(mainBody);

    const topCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.8, 0.3, 32),
      bodyMaterial
    );
    topCap.position.y = 1.75;
    topCap.castShadow = true;
    this.bodyMeshes.push(topCap);
    this.productGroup.add(topCap);

    const topDetail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.6, 0.15, 32),
      bodyMaterial
    );
    topDetail.position.y = 1.95;
    topDetail.castShadow = true;
    this.bodyMeshes.push(topDetail);
    this.productGroup.add(topDetail);

    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.05, 16, 48),
      bodyMaterial
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.02;
    baseRing.castShadow = true;
    this.bodyMeshes.push(baseRing);
    this.productGroup.add(baseRing);

    const groove1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.02, 8, 48),
      bodyMaterial
    );
    groove1.rotation.x = Math.PI / 2;
    groove1.position.y = 0.9;
    this.bodyMeshes.push(groove1);
    this.productGroup.add(groove1);

    const groove2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.02, 8, 48),
      bodyMaterial
    );
    groove2.rotation.x = Math.PI / 2;
    groove2.position.y = 1.3;
    this.bodyMeshes.push(groove2);
    this.productGroup.add(groove2);

    this.buildAccessories(config.defaultConfig.accessoryId, config);
  }

  private buildAccessories(accessoryId: string, config: ProductConfig): void {
    while (this.accessoryGroup.children.length > 0) {
      const child = this.accessoryGroup.children[0];
      this.accessoryGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const accessory = config.accessories.find((a) => a.id === accessoryId);
    if (!accessory || accessory.components.length === 0) return;

    const accessoryMaterial = new THREE.MeshStandardMaterial({
      color: this.currentColor.clone(),
      roughness: this.currentMaterial.roughness * 0.8,
      metalness: Math.min(this.currentMaterial.metalness + 0.1, 1),
    });

    for (const comp of accessory.components) {
      let geometry: THREE.BufferGeometry;
      switch (comp.geometry) {
        case 'box':
          geometry = new THREE.BoxGeometry(0.8, 0.08, 0.4);
          break;
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 16);
          break;
        case 'torus':
          geometry = new THREE.TorusGeometry(0.7, 0.06, 16, 48);
          break;
        default:
          geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      }

      const mesh = new THREE.Mesh(geometry, accessoryMaterial.clone());
      mesh.position.set(...comp.position);
      mesh.rotation.set(...comp.rotation);
      mesh.castShadow = true;
      this.accessoryGroup.add(mesh);
    }
  }

  private animateEntrance(): void {
    const startTime = performance.now();
    const duration = 1000;

    const animateScale = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const easedT = easeOutElastic(t);

      this.productGroup.scale.set(easedT, easedT, easedT);

      if (t < 1) {
        requestAnimationFrame(animateScale);
      }
    };

    requestAnimationFrame(animateScale);
  }

  private handleConfigChange(event: ConfigChangeEvent): void {
    if (event.type === 'color') {
      const colorOption = this.config.colors.find((c) => c.id === event.id);
      if (!colorOption) return;

      const fromColor = this.currentColor.clone();
      const toColor = new THREE.Color(colorOption.hex);
      const duration = 450;
      const startTime = performance.now();

      this.animateProperty({
        startTime,
        duration,
        fromValue: 0,
        toValue: 1,
        onUpdate: (t) => {
          const eased = easeInOutCubic(t);
          this.currentColor.lerpColors(fromColor, toColor, eased);
          this.bodyMeshes.forEach((mesh) => {
            (mesh.material as THREE.MeshStandardMaterial).color.copy(this.currentColor);
          });
          this.accessoryGroup.children.forEach((child) => {
            if (child instanceof THREE.Mesh) {
              (child.material as THREE.MeshStandardMaterial).color.copy(this.currentColor);
            }
          });
        },
        onComplete: () => {
          this.currentColor.copy(toColor);
          eventBus.emit('TransitionComplete', { type: 'color' });
        },
      });
    } else if (event.type === 'material') {
      const materialOption = this.config.materials.find((m) => m.id === event.id);
      if (!materialOption) return;

      const fromRoughness = this.currentMaterial.roughness;
      const toRoughness = materialOption.roughness;
      const fromMetalness = this.currentMaterial.metalness;
      const toMetalness = materialOption.metalness;
      const duration = 500;
      const startTime = performance.now();

      this.animateProperty({
        startTime,
        duration,
        fromValue: 0,
        toValue: 1,
        onUpdate: (t) => {
          const eased = easeInOutCubic(t);
          const roughness = fromRoughness + (toRoughness - fromRoughness) * eased;
          const metalness = fromMetalness + (toMetalness - fromMetalness) * eased;
          this.bodyMeshes.forEach((mesh) => {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.roughness = roughness;
            mat.metalness = metalness;
          });
          this.accessoryGroup.children.forEach((child) => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial;
              mat.roughness = roughness * 0.8;
              mat.metalness = Math.min(metalness + 0.1, 1);
            }
          });
        },
        onComplete: () => {
          this.currentMaterial = materialOption;
          eventBus.emit('TransitionComplete', { type: 'material' });
        },
      });
    } else if (event.type === 'accessory') {
      const duration = 400;
      const startTime = performance.now();

      this.animateProperty({
        startTime,
        duration,
        fromValue: 1,
        toValue: 0,
        onUpdate: (t) => {
          const eased = easeInOutCubic(t);
          this.accessoryGroup.scale.set(eased, eased, eased);
        },
        onComplete: () => {
          this.buildAccessories(event.id, this.config);
          this.accessoryGroup.scale.set(0, 0, 0);
          const growStart = performance.now();
          this.animateProperty({
            startTime: growStart,
            duration: 350,
            fromValue: 0,
            toValue: 1,
            onUpdate: (t) => {
              const eased = easeInOutCubic(t);
              this.accessoryGroup.scale.set(eased, eased, eased);
            },
            onComplete: () => {
              eventBus.emit('TransitionComplete', { type: 'accessory' });
            },
          });
        },
      });
    }
  }

  private animateProperty(state: TransitionState): void {
    this.animations.push(state);
  }

  private processAnimations(): void {
    const now = performance.now();
    this.animations = this.animations.filter((anim) => {
      const elapsed = now - anim.startTime;
      const rawT = Math.min(elapsed / anim.duration, 1);
      const normalizedT = (rawT - 0) / (1 - 0);
      const t = anim.fromValue + (anim.toValue - anim.fromValue) * normalizedT;

      anim.onUpdate(rawT);

      if (rawT >= 1) {
        anim.onComplete?.();
        return false;
      }
      return true;
    });
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    this.processAnimations();
    this.controls.update();

    const time = this.clock.getElapsedTime();
    this.productGroup.position.y = Math.sin(time * 0.8) * 0.03;

    this.renderer.render(this.scene, this.camera);
  }

  private handleResize(container: HTMLElement): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrameId);

    const configHandler = (this as unknown as Record<string, unknown>)._configChangeHandler;
    if (configHandler) {
      eventBus.off('ConfigChange', configHandler as (...args: unknown[]) => void);
    }

    const resizeHandler = (this as unknown as Record<string, unknown>)._resizeHandler;
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler as EventListener);
    }

    this.controls.dispose();
    this.renderer.dispose();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((m) => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    });

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
