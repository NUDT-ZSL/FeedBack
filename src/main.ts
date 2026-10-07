import * as THREE from 'three';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Loom } from './Loom';
import {
  PRESET_PATTERNS,
  mapPatternToWeave,
  PatternMapping,
  SILK_COLORS_EXPORT,
} from './PatternEngine';
import { ScrollViewer } from './ScrollViewer';
import {
  UserInteraction,
  InteractionEvent,
} from './UserInteraction';

class App {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  private clock: THREE.Clock;

  private loom: Loom;
  private scrollViewer: ScrollViewer;
  private userInteraction: UserInteraction;

  private currentTargetLength: number = 20;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;
  private targetFPS: number = 60;
  private frameInterval: number = 1000 / this.targetFPS;

  private performanceMonitor = {
    frameCount: 0,
    lastFpsUpdate: 0,
    currentFps: 0,
  };

  constructor() {
    this.container = document.getElementById('root')!;
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a0f0a);
    this.scene.fog = new THREE.Fog(0x1a0f0a, 5, 20);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.setupGround();

    this.loom = new Loom();
    this.scene.add(this.loom.group);

    this.scrollViewer = new ScrollViewer();
    this.scene.add(this.scrollViewer.group);

    this.userInteraction = new UserInteraction(
      this.scene,
      this.camera,
      this.renderer,
      this.renderer.domElement
    );

    this.setupInteractionLinks();
    this.setupEventListeners();

    this.loom.onShuttleComplete = this.handleShuttleComplete.bind(this);
    this.loom.onFabricComplete = this.handleFabricComplete.bind(this);

    this.scrollViewer.onUnrollComplete = () => {
      console.log('Scroll unrolled');
    };
    this.scrollViewer.onRollbackComplete = () => {
      console.log('Scroll rolled back');
    };

    this.resize();
    this.animate();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(5, 10, 7);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -10;
    mainLight.shadow.camera.right = 10;
    mainLight.shadow.camera.top = 10;
    mainLight.shadow.camera.bottom = -10;
    this.scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffe0b2, 0.4);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xb8860b, 0.5, 10);
    rimLight.position.set(0, 3, 3);
    this.scene.add(rimLight);
  }

  private setupGround(): void {
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a1810,
      roughness: 0.9,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const rugGeo = new THREE.CircleGeometry(4, 64);
    const rugMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.8,
    });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.01;
    this.scene.add(rug);
  }

  private setupInteractionLinks(): void {
    this.userInteraction.setSlotPositions(this.loom.getSlotPositions());
    this.userInteraction.setLoomClickable(this.loom.getClickableObjects());
    this.userInteraction.setShuttleButton(this.loom.getShuttleButton());
    this.userInteraction.setScrollGroup(this.scrollViewer.group);

    this.userInteraction.addEventListener('silk_drop', this.handleSilkDrop.bind(this));
    this.userInteraction.addEventListener('pattern_select', this.handlePatternSelect.bind(this));
    this.userInteraction.addEventListener('shuttle_click', this.handleShuttleClick.bind(this));
    this.userInteraction.addEventListener('scroll_click', this.handleScrollClick.bind(this));
    this.userInteraction.addEventListener('loom_double_click', this.handleLoomDoubleClick.bind(this));
    this.userInteraction.addEventListener('target_length_change', this.handleTargetLengthChange.bind(this));
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', this.resize.bind(this));
  }

  private handleSilkDrop(event: InteractionEvent): void {
    const { slotIndex, color } = event.data;
    this.loom.setWarpColor(slotIndex, color);
    this.loom.setCurrentWeftColor(color);
  }

  private handlePatternSelect(event: InteractionEvent): void {
    const { patternId } = event.data;
    const pattern = PRESET_PATTERNS.find((p) => p.id === patternId);
    if (pattern) {
      const mapping = mapPatternToWeave(pattern.pixelData);
      this.loom.applyPattern(mapping);
      this.loom.setCurrentWeftColor(SILK_COLORS_EXPORT[0]);
    }
  }

  private handleShuttleClick(): void {
    this.loom.fireShuttle();
  }

  private handleScrollClick(): void {
    this.scrollViewer.handleClick();
  }

  private handleLoomDoubleClick(event: InteractionEvent): void {
    const { viewMode } = event.data;
    this.loom.state.viewMode = viewMode;
  }

  private handleTargetLengthChange(event: InteractionEvent): void {
    const { delta } = event.data;
    this.currentTargetLength = Math.max(
      10,
      Math.min(50, this.currentTargetLength + delta)
    );
    this.loom.setTargetLength(this.currentTargetLength);
    this.updateLengthLabel();
  }

  private handleShuttleComplete(): void {
    console.log('Shuttle complete, fabric length:', this.loom.state.fabricLength);
  }

  private handleFabricComplete(): void {
    console.log('Fabric complete, creating scroll...');
    this.scrollViewer.createScroll(this.loom.getFabricTexture());
  }

  private updateLengthLabel(): void {
    const labelText = `织物长度: ${this.currentTargetLength} 厘米 (步长5厘米)`;
    console.log('Updated target length:', labelText);
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const minWidth = 1280;
    const maxWidth = 1920;
    const scale = Math.max(
      0.8,
      Math.min(1.2, width / ((minWidth + maxWidth) / 2)
    );

    this.camera.fov = 45 / scale;
    this.camera.updateProjectionMatrix();
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

    const now = performance.now();
    const delta = now - this.lastTime;

    if (delta >= this.frameInterval) {
      this.lastTime = now - (delta % this.frameInterval);

      const deltaTime = Math.min(delta / 1000, 0.1);

      this.loom.update(deltaTime);
      this.scrollViewer.update(deltaTime);
      this.userInteraction.update(deltaTime);

      this.renderer.render(this.scene, this.camera);

      this.updatePerformanceMonitor(now);
    }
  }

  private updatePerformanceMonitor(now: number): void {
    this.performanceMonitor.frameCount++;

    if (now - this.performanceMonitor.lastFpsUpdate >= 1000) {
      this.performanceMonitor.currentFps = this.performanceMonitor.frameCount;
      this.performanceMonitor.frameCount = 0;
      this.performanceMonitor.lastFpsUpdate = now;

      if (this.performanceMonitor.currentFps < 50) {
        console.warn(`Low FPS: ${this.performanceMonitor.currentFps);
      }
    }
  }

  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener('resize', this.resize.bind(this));

    this.loom.dispose();
    this.scrollViewer.dispose();
    this.userInteraction.dispose();

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

let app: App | null = null;

function init() {
  if (!document.getElementById('root')) {
    console.error('Root element not found');
    return;
  }

  app = new App();

  const root = createRoot(document.getElementById('root')!);

  root.render(
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      },
    })
  );

  console.log('云锦织机3D交互模拟器 已启动');
  console.log('操作说明:');
  console.log('- 鼠标拖拽: 旋转视角');
  console.log('- 鼠标滚轮: 缩放');
  console.log('- 双击织机: 切换第一人称视角');
  console.log('- 拖拽丝线到经线槽: 设置经线颜色');
  console.log('- 点击纹样: 加载预设纹样');
  console.log('- 点击投梭按钮: 投梭织造');
  console.log('- 点击卷轴: 展开全景展示');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { App };
