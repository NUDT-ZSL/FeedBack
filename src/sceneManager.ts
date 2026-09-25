import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KLineData } from './dataHandler';

interface BarMeshGroup {
  body: THREE.Mesh;
  wickTop: THREE.Mesh;
  wickBottom: THREE.Mesh;
  volumeMesh: THREE.Mesh;
  edgeLines: THREE.LineSegments;
  data: KLineData;
  index: number;
  targetOpacity: number;
  currentOpacity: number;
  targetScale: THREE.Vector3;
  currentScale: THREE.Vector3;
  targetPosX: number;
  currentPosX: number;
  glowIntensity: number;
  isHighlighted: boolean;
}

export class SceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private bars: BarMeshGroup[] = [];
  private klineGroup: THREE.Group;
  private starField: THREE.Points;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoveredBar: BarMeshGroup | null = null;
  private selectedBar: BarMeshGroup | null = null;
  private detailMode = false;
  private groundGrid: THREE.GridHelper;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private pointLight: THREE.PointLight;
  private animationMixins: (() => void)[] = [];
  private container: HTMLElement;
  private onBarHover: ((data: KLineData | null, screenX: number, screenY: number) => void) | null = null;
  private onBarClick: ((data: KLineData | null) => void) | null = null;
  private fadeProgress = 1;
  private isFadingIn = false;
  private isMobile = false;

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

    this.klineGroup = new THREE.Group();
    this.scene.add(this.klineGroup);

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

    this.setupBackground();
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

  private setupEvents() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.performRaycast(e.clientX, e.clientY);
    });

    canvas.addEventListener('click', () => {
      if (this.hoveredBar) {
        this.handleBarClick(this.hoveredBar);
      } else if (this.detailMode) {
        this.exitDetailMode();
      }
    });

    canvas.addEventListener('mouseleave', () => {
      this.mouse.set(-999, -999);
      if (this.hoveredBar) {
        this.hoveredBar.isHighlighted = false;
        this.hoveredBar = null;
        if (this.onBarHover) this.onBarHover(null, 0, 0);
      }
    });
  }

  private performRaycast(screenX: number, screenY: number) {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.bars.map(b => b.body);
    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object as THREE.Mesh;
      const bar = this.bars.find(b => b.body === hitMesh);
      if (bar && bar !== this.hoveredBar) {
        if (this.hoveredBar) this.hoveredBar.isHighlighted = false;
        bar.isHighlighted = true;
        this.hoveredBar = bar;
        if (this.onBarHover) this.onBarHover(bar.data, screenX, screenY);
      }
    } else {
      if (this.hoveredBar) {
        this.hoveredBar.isHighlighted = false;
        this.hoveredBar = null;
        if (this.onBarHover) this.onBarHover(null, 0, 0);
      }
    }
  }

  private handleBarClick(bar: BarMeshGroup) {
    if (this.detailMode && this.selectedBar === bar) {
      this.exitDetailMode();
      return;
    }

    this.selectedBar = bar;
    this.detailMode = true;
    const centerIdx = bar.index;

    this.bars.forEach(b => {
      const dist = Math.abs(b.index - centerIdx);
      if (dist <= 2) {
        b.targetOpacity = 1;
        b.isHighlighted = b.index === centerIdx;
        b.targetScale = new THREE.Vector3(1.4, 1.4, 1.4);
      } else {
        b.targetOpacity = 0.15;
        b.isHighlighted = false;
        b.targetScale = new THREE.Vector3(0.8, 0.8, 0.8);
      }
    });

    if (this.onBarClick) this.onBarClick(bar.data);
  }

  private exitDetailMode() {
    this.detailMode = false;
    this.selectedBar = null;
    this.bars.forEach(b => {
      b.targetOpacity = 1;
      b.isHighlighted = false;
      b.targetScale = new THREE.Vector3(1, 1, 1);
    });
    if (this.onBarClick) this.onBarClick(null);
  }

  setBarHoverCallback(cb: (data: KLineData | null, screenX: number, screenY: number) => void) {
    this.onBarHover = cb;
  }

  setBarClickCallback(cb: (data: KLineData | null) => void) {
    this.onBarClick = cb;
  }

  loadKLineData(data: KLineData[]) {
    this.clearBars();
    this.exitDetailMode();

    const priceAll = data.flatMap(d => [d.high, d.low]);
    const minPrice = Math.min(...priceAll);
    const maxPrice = Math.max(...priceAll);
    const priceRange = maxPrice - minPrice || 1;
    const maxVolume = Math.max(...data.map(d => d.volume));
    const heightScale = 8 / priceRange;
    const volumeScale = 2 / maxVolume;
    const spacing = 0.55;

    const offsetX = (data.length * spacing) / 2;

    data.forEach((kline, i) => {
      const isUp = kline.close >= kline.open;
      const color = isUp ? 0x00e676 : 0xff1744;
      const emissiveColor = isUp ? 0x003d1a : 0x4a0011;

      const bodyMin = Math.min(kline.open, kline.close);
      const bodyMax = Math.max(kline.open, kline.close);
      const bodyHeight = Math.max((bodyMax - bodyMin) * heightScale, 0.05);
      const bodyY = (bodyMin - minPrice) * heightScale + bodyHeight / 2;

      const bodyGeom = new THREE.BoxGeometry(0.38, bodyHeight, 0.38);
      const bodyMat = new THREE.MeshPhongMaterial({
        color,
        emissive: emissiveColor,
        emissiveIntensity: 0.15,
        specular: 0x666666,
        shininess: 60,
        transparent: true,
        opacity: 0,
      });
      const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
      bodyMesh.position.set(i * spacing - offsetX, bodyY, 0);

      const edgeGeom = new THREE.EdgesGeometry(bodyGeom);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0 });
      const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
      bodyMesh.add(edgeLines);

      const wickTopHeight = Math.max((kline.high - bodyMax) * heightScale, 0.01);
      const wickTopGeom = new THREE.BoxGeometry(0.04, wickTopHeight, 0.04);
      const wickMat = new THREE.MeshPhongMaterial({
        color,
        emissive: emissiveColor,
        emissiveIntensity: 0.1,
        specular: 0x444444,
        shininess: 40,
        transparent: true,
        opacity: 0,
      });
      const wickTop = new THREE.Mesh(wickTopGeom, wickMat);
      const wickTopY = (bodyMax - minPrice) * heightScale + wickTopHeight / 2;
      wickTop.position.set(i * spacing - offsetX, wickTopY, 0);

      const wickBottomHeight = Math.max((bodyMin - kline.low) * heightScale, 0.01);
      const wickBottomGeom = new THREE.BoxGeometry(0.04, wickBottomHeight, 0.04);
      const wickBottom = new THREE.Mesh(wickBottomGeom, wickMat.clone());
      const wickBottomY = (kline.low - minPrice) * heightScale + wickBottomHeight / 2;
      wickBottom.position.set(i * spacing - offsetX, wickBottomY, 0);

      const volumeHeight = Math.max(kline.volume * volumeScale, 0.01);
      const volumeGeom = new THREE.BoxGeometry(0.34, volumeHeight, 0.34);
      const volumeMat = new THREE.MeshPhongMaterial({
        color: 0x3c82ff,
        emissive: 0x0a1a40,
        emissiveIntensity: 0.1,
        specular: 0x222244,
        shininess: 30,
        transparent: true,
        opacity: 0,
      });
      const volumeMesh = new THREE.Mesh(volumeGeom, volumeMat);
      volumeMesh.position.set(i * spacing - offsetX, -volumeHeight / 2, 0);

      this.klineGroup.add(bodyMesh);
      this.klineGroup.add(wickTop);
      this.klineGroup.add(wickBottom);
      this.klineGroup.add(volumeMesh);

      const bar: BarMeshGroup = {
        body: bodyMesh,
        wickTop,
        wickBottom,
        volumeMesh,
        edgeLines,
        data: kline,
        index: i,
        targetOpacity: 1,
        currentOpacity: 0,
        targetScale: new THREE.Vector3(1, 1, 1),
        currentScale: new THREE.Vector3(1, 1, 1),
        targetPosX: i * spacing - offsetX,
        currentPosX: i * spacing - offsetX + 3,
        glowIntensity: 0,
        isHighlighted: false,
      };

      bodyMesh.userData = { barIndex: i };
      this.bars.push(bar);
    });

    this.fadeProgress = 0;
    this.isFadingIn = true;
  }

  transitionToNewData(data: KLineData[]) {
    const oldBars = [...this.bars];
    const oldCount = oldBars.length;
    const newCount = data.length;

    oldBars.forEach(bar => {
      bar.targetOpacity = 0;
    });

    setTimeout(() => {
      this.clearBars();
      this.loadKLineData(data);
    }, 400);
  }

  private clearBars() {
    while (this.klineGroup.children.length > 0) {
      const child = this.klineGroup.children[0];
      this.klineGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    this.bars = [];
    this.hoveredBar = null;
    this.selectedBar = null;
    this.detailMode = false;
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

    const lerpSpeed = 0.08;

    if (this.isFadingIn) {
      this.fadeProgress += delta * 1.25;
      if (this.fadeProgress >= 1) {
        this.fadeProgress = 1;
        this.isFadingIn = false;
      }
    }

    this.bars.forEach(bar => {
      const baseOpacity = this.isFadingIn ? this.fadeProgress : 1;
      const target = bar.targetOpacity * baseOpacity;
      bar.currentOpacity += (target - bar.currentOpacity) * lerpSpeed;

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

      bar.currentScale.lerp(bar.targetScale, lerpSpeed);
      bar.body.scale.copy(bar.currentScale);
      bar.wickTop.scale.copy(bar.currentScale);
      bar.wickBottom.scale.copy(bar.currentScale);
      bar.volumeMesh.scale.copy(bar.currentScale);

      bar.currentPosX += (bar.targetPosX - bar.currentPosX) * lerpSpeed;
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

      const glow = bar.glowIntensity * 0.5;
      bodyMat.emissiveIntensity = 0.15 + glow;
    });

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
    return this.bars.length;
  }

  dispose() {
    this.clearBars();
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize);
  }
}
