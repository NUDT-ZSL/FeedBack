import * as THREE from 'three';
import { Plant, PlantParams, GrowthStage } from './plant';
import { PlantGUI } from './gui';

class App {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private plant!: Plant;
  private gui!: PlantGUI;
  private directionalLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private clock: THREE.Clock = new THREE.Clock();
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private isDragging: boolean = false;
  private previousMouse: THREE.Vector2 = new THREE.Vector2();
  private lightAngle: number = 0;
  private lightHeight: number = 1;
  private audioContext: AudioContext | null = null;
  private infoLabelTimeout: number | null = null;

  private stageNames: Record<GrowthStage, string> = {
    seed: '🌰 种子阶段',
    sprout: '🌱 嫩芽阶段',
    adult: '🌿 成株阶段',
    flowering: '🌸 开花阶段'
  };

  constructor() {
    this.init();
  }

  private init() {
    this.setupRenderer();
    this.setupScene();
    this.setupLights();
    this.setupCamera();
    this.setupEnvironment();
    this.setupPlant();
    this.setupGUI();
    this.setupEventListeners();
    this.animate();
  }

  private setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    document.getElementById('app')!.appendChild(this.renderer.domElement);
  }

  private setupScene() {
    this.scene = new THREE.Scene();
  }

  private setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0.6, 0.5, 0.8);
    this.camera.lookAt(0, 0.15, 0);
  }

  private setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(1, 1.5, 1);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 1024;
    this.directionalLight.shadow.mapSize.height = 1024;
    this.directionalLight.shadow.camera.near = 0.1;
    this.directionalLight.shadow.camera.far = 5;
    this.directionalLight.shadow.camera.left = -1;
    this.directionalLight.shadow.camera.right = 1;
    this.directionalLight.shadow.camera.top = 1;
    this.directionalLight.shadow.camera.bottom = -1;
    this.scene.add(this.directionalLight);
  }

  private setupEnvironment() {
    const groundGeometry = new THREE.PlaneGeometry(3, 3, 20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xa5d6a7,
      roughness: 0.9,
      metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const gridHelper = new THREE.GridHelper(3, 15, 0x81c784, 0xa5d6a7);
    gridHelper.position.y = -0.099;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.4;
    this.scene.add(gridHelper);

    this.createPot();
  }

  private createPot() {
    const potGroup = new THREE.Group();

    const potOuterGeometry = new THREE.CylinderGeometry(0.14, 0.11, 0.18, 32);
    const potMaterial = new THREE.MeshStandardMaterial({
      color: 0x8d6e63,
      roughness: 0.85,
      metalness: 0.05
    });
    const potOuter = new THREE.Mesh(potOuterGeometry, potMaterial);
    potOuter.position.y = -0.01;
    potOuter.castShadow = true;
    potOuter.receiveShadow = true;
    potGroup.add(potOuter);

    const rimGeometry = new THREE.TorusGeometry(0.14, 0.015, 16, 32);
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x795548,
      roughness: 0.8,
      metalness: 0.05
    });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.08;
    potGroup.add(rim);

    const soilGeometry = new THREE.CylinderGeometry(0.13, 0.12, 0.04, 32);
    const soilMaterial = new THREE.MeshStandardMaterial({
      color: 0x5d4037,
      roughness: 1.0,
      metalness: 0.0
    });
    const soil = new THREE.Mesh(soilGeometry, soilMaterial);
    soil.position.y = 0.06;
    potGroup.add(soil);

    this.scene.add(potGroup);
  }

  private setupPlant() {
    this.plant = new Plant({
      light: 50,
      water: 50,
      temperature: 20
    });
    this.plant.group.position.y = 0.08;
    this.scene.add(this.plant.group);
  }

  private setupGUI() {
    this.gui = new PlantGUI({
      onParamsChange: (params: PlantParams) => {
        this.plant.updateParams(params);
        this.updateDataPanel(params);
        this.updateLightIntensity(params.light);
      },
      onReset: () => {
        this.reset();
      }
    });
  }

  private updateLightIntensity(light: number) {
    this.directionalLight.intensity = 0.3 + (light / 100) * 1.2;
    this.ambientLight.intensity = 0.3 + (light / 100) * 0.5;
  }

  private setupEventListeners() {
    window.addEventListener('resize', this.onWindowResize.bind(this));

    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    canvas.addEventListener('click', this.onClick.bind(this));

    canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd.bind(this));

    document.getElementById('resetBtn')!.addEventListener('click', () => {
      this.reset();
    });
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onMouseDown(event: MouseEvent) {
    this.isDragging = true;
    this.previousMouse.set(event.clientX, event.clientY);
  }

  private onMouseMove(event: MouseEvent) {
    if (this.isDragging) {
      const deltaX = event.clientX - this.previousMouse.x;
      const deltaY = event.clientY - this.previousMouse.y;

      this.lightAngle += deltaX * 0.01;
      this.lightHeight = Math.max(0.3, Math.min(2, this.lightHeight - deltaY * 0.005));

      this.updateLightPosition();
      this.previousMouse.set(event.clientX, event.clientY);
    }
  }

  private onMouseUp() {
    this.isDragging = false;
  }

  private onTouchStart(event: TouchEvent) {
    if (event.touches.length === 1) {
      event.preventDefault();
      this.isDragging = true;
      this.previousMouse.set(event.touches[0].clientX, event.touches[0].clientY);
    }
  }

  private onTouchMove(event: TouchEvent) {
    if (this.isDragging && event.touches.length === 1) {
      event.preventDefault();
      const deltaX = event.touches[0].clientX - this.previousMouse.x;
      const deltaY = event.touches[0].clientY - this.previousMouse.y;

      this.lightAngle += deltaX * 0.01;
      this.lightHeight = Math.max(0.3, Math.min(2, this.lightHeight - deltaY * 0.005));

      this.updateLightPosition();
      this.previousMouse.set(event.touches[0].clientX, event.touches[0].clientY);
    }
  }

  private onTouchEnd() {
    this.isDragging = false;
  }

  private updateLightPosition() {
    const radius = 1.5;
    this.directionalLight.position.x = Math.cos(this.lightAngle) * radius;
    this.directionalLight.position.z = Math.sin(this.lightAngle) * radius;
    this.directionalLight.position.y = this.lightHeight;

    const lightDir = new THREE.Vector3()
      .copy(this.directionalLight.position)
      .normalize();
    this.plant.lightDirection.copy(lightDir);
  }

  private onClick(event: MouseEvent) {
    if (this.isDragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.plant.getInteractableObjects(), false);

    if (intersects.length > 0) {
      const object = intersects[0].object as THREE.Mesh;
      const type = object.userData.type;

      if (type === 'leaf') {
        this.plant.vibrateLeaf(object);
        this.playLeafSound();
      } else if (type === 'flower') {
        const flowerGroup = this.plant.getFlowerGroupFromPetal(object);
        if (flowerGroup) {
          this.plant.scatterFlower(flowerGroup);
        }
      } else if (type === 'stem') {
        this.showGrowthInfo(event.clientX, event.clientY);
      }
    }
  }

  private playLeafSound() {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = this.audioContext;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);
    } catch (e) {
    }
  }

  private showGrowthInfo(x: number, y: number) {
    const label = document.getElementById('infoLabel')!;
    const days = this.plant.getGrowthDays();
    const stage = this.stageNames[this.plant.currentStage];

    label.innerHTML = `📅 生长 ${days} 天<br>阶段: ${stage}`;
    label.style.left = `${x + 15}px`;
    label.style.top = `${y - 10}px`;
    label.classList.add('visible');

    if (this.infoLabelTimeout) {
      window.clearTimeout(this.infoLabelTimeout);
    }

    this.infoLabelTimeout = window.setTimeout(() => {
      label.classList.remove('visible');
    }, 2500);
  }

  private reset() {
    this.gui.reset();
    this.plant.reset();
    this.plant.triggerSparkle();
    this.updateDataPanel(this.gui.getParams());
    this.updateLightIntensity(50);
  }

  private updateDataPanel(params: PlantParams) {
    document.getElementById('lightValue')!.textContent = `${Math.round(params.light)}%`;
    document.getElementById('waterValue')!.textContent = `${Math.round(params.water)}%`;
    document.getElementById('tempValue')!.textContent = `${params.temperature.toFixed(1)}°C`;

    document.getElementById('lightBar')!.style.width = `${params.light}%`;
    document.getElementById('waterBar')!.style.width = `${params.water}%`;
    document.getElementById('tempBar')!.style.width = `${(params.temperature / 40) * 100}%`;

    document.getElementById('stageName')!.textContent = this.stageNames[this.plant.currentStage];

    const growthRate = 0.3 + 0.7 *
      Math.sin((params.light / 100) * Math.PI) *
      Math.sin((params.water / 100) * Math.PI) *
      (params.temperature >= 10 && params.temperature <= 32 ? 1 : 0.3);

    const timeToFlowering = Math.max(0, 30 - (this.plant as any).growthTime) / Math.max(0.1, growthRate);
    document.getElementById('countdown')!.textContent =
      this.plant.currentStage === 'flowering' ? '已开花 🌸' : `${Math.ceil(timeToFlowering)} 秒`;
  }

  private animate() {
    requestAnimationFrame(this.animate.bind(this));

    const delta = Math.min(this.clock.getDelta(), 0.1);

    this.plant.update(delta);
    this.updateDataPanel(this.gui.getParams());

    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.plant.dispose();
    this.gui.dispose();
    this.renderer.dispose();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
