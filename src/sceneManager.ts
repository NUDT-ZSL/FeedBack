import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KLineData } from './dataHandler';
import { BarHoverCallback, BarClickCallback } from './scene/types';
import { buildKLineBars } from './scene/barFactory';
import { BarCollection } from './scene/barCollection';
import { InteractionState } from './scene/interactionState';
import { InteractionController } from './scene/interactionController';
import { TransitionController } from './scene/transitionController';
import { BarAnimator } from './scene/barAnimator';
import { disposeObject3D, disposeTexture } from './scene/resourceDisposer';

/**
 * 场景管理编排层：只负责搭建渲染环境（相机/灯光/背景/控制器），
 * 并把数据加载、柱体生命周期、交互状态、过渡动画、资源释放
 * 委托给 src/scene/ 下的专职模块。公开 API 与重构前完全一致。
 */
export class SceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private starField: THREE.Points;
  private groundGrid: THREE.GridHelper;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private pointLight: THREE.PointLight;
  private container: HTMLElement;
  private isMobile = false;

  private readonly collection = new BarCollection();
  private readonly interaction: InteractionState;
  private readonly input: InteractionController;
  private readonly transitions = new TransitionController();
  private readonly animator = new BarAnimator();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(15, 12, 15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 60;
    this.controls.target.set(0, 3, 0);

    this.scene.add(this.collection.group);

    this.ambientLight = new THREE.AmbientLight(0x4466aa, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.directionalLight.position.set(10, 20, 10);
    this.scene.add(this.directionalLight);

    this.pointLight = new THREE.PointLight(0x3366ff, 0.4, 50);
    this.pointLight.position.set(-5, 10, -5);
    this.scene.add(this.pointLight);

    this.groundGrid = new THREE.GridHelper(40, 40, 0x1a2a4a, 0x0d1525);
    this.groundGrid.position.y = -0.01;
    this.scene.add(this.groundGrid);

    this.starField = this.createStarField();
    this.scene.add(this.starField);

    this.setupBackground();

    this.interaction = new InteractionState(() => this.collection.all);
    this.input = new InteractionController(
      this.renderer.domElement,
      this.camera,
      this.interaction,
      this.collection,
    );
    this.input.attach();

    this.checkMobile();

    window.addEventListener('resize', this.onResize);
  }
  private createStarField(): THREE.Points {
    const count = 200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 80 + 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x8899cc,
      size: 0.15,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
    });

    return new THREE.Points(geometry, material);
  }

  private setupBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#0a0e2a');
    gradient.addColorStop(0.5, '#060818');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    const texture = new THREE.CanvasTexture(canvas);
    this.scene.background = texture;
  }

  setBarHoverCallback(cb: BarHoverCallback) {
    this.interaction.setHoverCallback(cb);
  }

  setBarClickCallback(cb: BarClickCallback) {
    this.interaction.setClickCallback(cb);
  }

  loadKLineData(data: KLineData[]) {
    // 直接加载会取代任何尚未执行的过渡切换，避免过期定时器清掉新数据。
    this.transitions.cancelPending();
    this.collection.replace(buildKLineBars(data));
    this.interaction.reset();
    this.transitions.beginFadeIn();
  }

  transitionToNewData(data: KLineData[]) {
    for (const bar of this.collection.all) {
      bar.targetOpacity = 0;
    }
    this.transitions.scheduleSwap(() => {
      this.loadKLineData(data);
    }, 400);
  }

  private checkMobile() {
    this.isMobile = window.innerWidth < 768;
    if (this.isMobile) {
      this.camera.position.set(0, 25, 0.1);
      this.controls.target.set(0, 3, 0);
    }
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.checkMobile();
  };

  update(delta: number) {
    this.controls.update();

    this.starField.rotation.y += 0.0001;

    this.transitions.update(delta);
    this.animator.update(this.collection.all, this.transitions.baseOpacity);

    this.renderer.render(this.scene, this.camera);
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getBarCount(): number {
    return this.collection.count;
  }

  dispose() {
    this.transitions.reset();
    this.input.detach();
    this.collection.clear();
    disposeObject3D(this.starField);
    disposeObject3D(this.groundGrid);
    disposeTexture(this.scene.background as THREE.Texture | null);
    this.scene.background = null;
    this.controls.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize);
  }
}
