import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KLineData } from './dataHandler';
import { BarMeshGroup, BarHoverCallback, BarClickCallback } from './scene/types';
import { createBars } from './scene/barFactory';
import { BarCollection } from './scene/barCollection';
import { InteractionState } from './scene/interactionState';
import { TransitionController } from './scene/transitionController';

const TRANSITION_DELAY_MS = 400;
const LERP_SPEED = 0.08;

/**
 * Facade that wires together the focused scene modules:
 *   - barFactory:           data -> bar mesh construction
 *   - BarCollection:        bar lifecycle + resource disposal
 *   - InteractionState:     hover / selection / detail mode
 *   - TransitionController: fade progress + deferred data swaps
 *
 * The public API and callback semantics are unchanged.
 */
export class SceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private starField: THREE.Points;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private groundGrid: THREE.GridHelper;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private pointLight: THREE.PointLight;
  private container: HTMLElement;
  private backgroundTexture: THREE.Texture;
  private isMobile = false;

  private bars = new BarCollection();
  private interaction = new InteractionState();
  private transitions = new TransitionController();

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

    this.scene.add(this.bars.group);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);

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

    this.backgroundTexture = this.createBackgroundTexture();
    this.scene.background = this.backgroundTexture;

    this.setupEvents();
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

  private createBackgroundTexture(): THREE.Texture {
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
    return new THREE.CanvasTexture(canvas);
  }

  private setupEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
  }

  private onMouseMove = (e: MouseEvent) => {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.performRaycast(e.clientX, e.clientY);
  };

  private onClick = () => {
    const hovered = this.interaction.hoveredBar;
    if (hovered) {
      this.interaction.clickBar(hovered, this.bars.all);
    } else {
      this.interaction.clickBlank(this.bars.all);
    }
  };

  private onMouseLeave = () => {
    this.mouse.set(-999, -999);
    this.interaction.clearHover();
  };

  private performRaycast(screenX: number, screenY: number) {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const all = this.bars.all;
    const meshes = all.map(b => b.body);
    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object as THREE.Mesh;
      const bar = all.find(b => b.body === hitMesh) ?? null;
      this.interaction.setHover(bar, screenX, screenY);
    } else {
      this.interaction.clearHover();
    }
  }

  setBarHoverCallback(cb: BarHoverCallback) {
    this.interaction.onHover = cb;
  }

  setBarClickCallback(cb: BarClickCallback) {
    this.interaction.onClick = cb;
  }

  loadKLineData(data: KLineData[]) {
    this.transitions.cancelPending();
    this.bars.replace(createBars(data));
    this.interaction.resetForDataChange();
    this.transitions.beginFadeIn();
  }

  transitionToNewData(data: KLineData[]) {
    this.bars.fadeOutAll();
    this.transitions.schedule(TRANSITION_DELAY_MS, () => {
      this.loadKLineData(data);
    });
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

  private updateBarAnimation(bar: BarMeshGroup, baseOpacity: number) {
    const target = bar.targetOpacity * baseOpacity;
    bar.currentOpacity += (target - bar.currentOpacity) * LERP_SPEED;

    const bodyMat = bar.body.material as THREE.MeshPhongMaterial;
    bodyMat.opacity = bar.currentOpacity;

    const edgeMat = bar.edgeLines.material as THREE.LineBasicMaterial;
    edgeMat.opacity = bar.currentOpacity * 0.35;

    const wickTopMat = bar.wickTop.material as THREE.MeshPhongMaterial;
    wickTopMat.opacity = bar.currentOpacity;
    const wickBotMat = bar.wickBottom.material as THREE.MeshPhongMaterial;
    wickBotMat.opacity = bar.currentOpacity;

    const volMat = bar.volumeMesh.material as THREE.MeshPhongMaterial;
    volMat.opacity = bar.currentOpacity * 0.45;

    bar.currentScale.lerp(bar.targetScale, LERP_SPEED);
    bar.body.scale.copy(bar.currentScale);
    bar.wickTop.scale.copy(bar.currentScale);
    bar.wickBottom.scale.copy(bar.currentScale);
    bar.volumeMesh.scale.copy(bar.currentScale);

    bar.currentPosX += (bar.targetPosX - bar.currentPosX) * LERP_SPEED;
    const posX = bar.currentPosX;
    bar.body.position.x = posX;
    bar.wickTop.position.x = posX;
    bar.wickBottom.position.x = posX;
    bar.volumeMesh.position.x = posX;

    if (bar.isHighlighted) {
      bar.glowIntensity = Math.min(bar.glowIntensity + 0.05, 1);
    } else {
      bar.glowIntensity = Math.max(bar.glowIntensity - 0.05, 0);
    }

    bodyMat.emissiveIntensity = 0.15 + bar.glowIntensity * 0.5;
  }

  update(delta: number) {
    this.controls.update();

    this.starField.rotation.y += 0.0001;

    this.transitions.update(delta);
    const baseOpacity = this.transitions.isFadingIn ? this.transitions.progress : 1;

    this.bars.all.forEach(bar => this.updateBarAnimation(bar, baseOpacity));

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
    return this.bars.count;
  }

  dispose() {
    this.transitions.dispose();
    this.bars.dispose();
    this.interaction.resetForDataChange();

    this.starField.geometry.dispose();
    (this.starField.material as THREE.Material).dispose();
    this.groundGrid.geometry.dispose();
    (this.groundGrid.material as THREE.Material).dispose();
    this.backgroundTexture.dispose();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('mouseleave', this.onMouseLeave);
    window.removeEventListener('resize', this.onResize);

    this.controls.dispose();
    this.renderer.dispose();
  }
}
