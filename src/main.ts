import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Star, StarConfig } from './star';
import { Orbit } from './orbit';
import { setupGUI, GUIState } from './gui';

class StellarSimulator {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private clock!: THREE.Clock;
  private stars!: Star[];
  private orbits!: Orbit[];
  private nebula!: THREE.Points;
  private guiState!: GUIState;
  private speedMultiplier!: number;
  private showOrbits!: boolean;
  private raycaster!: THREE.Raycaster;
  private mouse!: THREE.Vector2;
  private tooltip!: HTMLElement;
  private initialCameraPos!: THREE.Vector3;
  private initialTarget!: THREE.Vector3;
  private resettingCamera!: boolean;
  private resetProgress!: number;
  private animationId!: number;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000011);
    this.clock = new THREE.Clock();
    this.stars = [];
    this.orbits = [];
    this.speedMultiplier = 1;
    this.showOrbits = true;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.resettingCamera = false;
    this.resetProgress = 0;
    this.animationId = 0;

    this.guiState = {
      primaryMass: 3,
      secondaryMass: 1.5,
      speedMultiplier: 1,
      showOrbits: true
    };

    const tooltipEl = document.getElementById('tooltip');
    if (!tooltipEl) throw new Error('Tooltip element not found');
    this.tooltip = tooltipEl;

    this.initialCameraPos = new THREE.Vector3(0, 18, 22);
    this.initialTarget = new THREE.Vector3(0, 0, 0);

    this.initRenderer();
    this.initCamera();
    this.initControls();
    this.initLights();
    this.initGridHelper();
    this.initNebula();
    this.initStars();
    this.initGUI();
    this.initEventListeners();
    this.animate();
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000011, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    const app = document.getElementById('app');
    if (!app) throw new Error('App element not found');
    app.appendChild(this.renderer.domElement);
  }

  private initCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.copy(this.initialCameraPos);
    this.camera.lookAt(this.initialTarget);
  }

  private initControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 50;
    this.controls.target.copy(this.initialTarget);
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.controls.update();
  }

  private initLights(): void {
    const ambientLight = new THREE.AmbientLight(0x1a1a3a, 0.4);
    this.scene.add(ambientLight);
  }

  private initGridHelper(): void {
    const gridHelper = new THREE.GridHelper(60, 60, 0x222244, 0x111133);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.15;
    this.scene.add(gridHelper);
  }

  private initNebula(): void {
    const particleCount = 500;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    const colorStart = new THREE.Color(0x4a00e0);
    const colorEnd = new THREE.Color(0x00e5ff);

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 20 + Math.random() * 80;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      const mixFactor = Math.random();
      const color = colorStart.clone().lerp(colorEnd, mixFactor);
      const brightness = 0.4 + Math.random() * 0.6;
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;

      sizes[i] = 0.15 + Math.random() * 0.35;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: particleTexture,
      sizeAttenuation: true
    });

    this.nebula = new THREE.Points(geometry, material);
    this.scene.add(this.nebula);
  }

  private initStars(): void {
    const primaryConfig: StarConfig = {
      name: '主星 (黄)',
      mass: 3,
      baseRadius: 1.5,
      color: 0xffd700,
      temperature: 5778,
      planetColor: 0x00ced1,
      position: new THREE.Vector3(-4, 0, 0)
    };

    const secondaryConfig: StarConfig = {
      name: '伴星 (红)',
      mass: 1.5,
      baseRadius: 1.0,
      color: 0xff4500,
      temperature: 3200,
      planetColor: 0x20b2aa,
      position: new THREE.Vector3(4, 0, 0)
    };

    const primaryStar = new Star(primaryConfig);
    const secondaryStar = new Star(secondaryConfig);

    this.stars.push(primaryStar, secondaryStar);

    const inclination = 30 * Math.PI / 180;
    const primaryOrbit = new Orbit(primaryStar, secondaryStar, 4, inclination);
    const secondaryOrbit = new Orbit(secondaryStar, primaryStar, 3, -inclination);

    this.orbits.push(primaryOrbit, secondaryOrbit);

    this.scene.add(primaryStar.group);
    this.scene.add(secondaryStar.group);
    this.scene.add(primaryStar.planet);
    this.scene.add(primaryStar.planetGlow);
    this.scene.add(secondaryStar.planet);
    this.scene.add(secondaryStar.planetGlow);
    this.scene.add(primaryOrbit.line);
    this.scene.add(secondaryOrbit.line);
    this.scene.add(primaryOrbit.labelSprite);
    this.scene.add(secondaryOrbit.labelSprite);

    primaryStar.updateMass(3);
    secondaryStar.updateMass(1.5);
  }

  private initGUI(): void {
    setupGUI(this.guiState, {
      onPrimaryMassChange: (value: number) => {
        this.guiState.primaryMass = value;
        if (this.stars[0]) {
          this.stars[0].updateMass(value);
          this.orbits[0].updateMass(value);
        }
      },
      onSecondaryMassChange: (value: number) => {
        this.guiState.secondaryMass = value;
        if (this.stars[1]) {
          this.stars[1].updateMass(value);
          this.orbits[1].updateMass(value);
        }
      },
      onSpeedChange: (value: number) => {
        this.speedMultiplier = value;
      },
      onShowOrbitsChange: (value: boolean) => {
        this.showOrbits = value;
        this.orbits.forEach(orbit => orbit.setVisible(value));
      },
      onResetView: () => {
        this.resettingCamera = true;
        this.resetProgress = 0;
      }
    });
  }

  private initEventListeners(): void {
    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.renderer.domElement.addEventListener('mouseleave', this.onMouseLeave.bind(this));
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onMouseMove(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes: THREE.Object3D[] = [];
    this.stars.forEach(star => {
      meshes.push(star.mesh);
    });

    const intersects = this.raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const star = (obj.userData as { starRef?: Star }).starRef;
      if (star) {
        this.showTooltip(star, event.clientX, event.clientY);
        document.body.style.cursor = 'pointer';
      } else {
        this.hideTooltip();
        document.body.style.cursor = 'grab';
      }
    } else {
      this.hideTooltip();
      document.body.style.cursor = 'grab';
    }
  }

  private onMouseLeave(): void {
    this.hideTooltip();
  }

  private showTooltip(star: Star, x: number, y: number): void {
    const config = star.config;
    const radius = star.getRadius().toFixed(2);

    this.tooltip.innerHTML = `
      <div class="star-name">${config.name}</div>
      <div class="info-row">
        <span class="info-label">质量</span>
        <span class="info-value">${config.mass.toFixed(1)} M☉</span>
      </div>
      <div class="info-row">
        <span class="info-label">半径</span>
        <span class="info-value">${radius} R☉</span>
      </div>
      <div class="info-row">
        <span class="info-label">温度</span>
        <span class="info-value">${config.temperature.toLocaleString()} K</span>
      </div>
    `;

    const tooltipWidth = 180;
    const offsetX = x + 15 + tooltipWidth > window.innerWidth ? -tooltipWidth - 15 : 15;
    const offsetY = y + 15;

    this.tooltip.style.left = `${x + offsetX}px`;
    this.tooltip.style.top = `${offsetY}px`;
    this.tooltip.classList.add('visible');
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('visible');
  }

  private resetCamera(deltaTime: number): void {
    if (!this.resettingCamera) return;

    this.resetProgress += deltaTime * 1.5;
    const t = Math.min(this.resetProgress, 1);
    const easeT = t * t * (3 - 2 * t);

    this.camera.position.lerpVectors(this.camera.position, this.initialCameraPos, easeT * 0.08 + 0.02);
    this.controls.target.lerpVectors(this.controls.target, this.initialTarget, easeT * 0.08 + 0.02);

    const posDist = this.camera.position.distanceTo(this.initialCameraPos);
    const targetDist = this.controls.target.distanceTo(this.initialTarget);

    if (posDist < 0.05 && targetDist < 0.05 || t >= 1) {
      this.camera.position.copy(this.initialCameraPos);
      this.controls.target.copy(this.initialTarget);
      this.resettingCamera = false;
      this.resetProgress = 0;
    }
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(this.animate.bind(this));

    const deltaTime = Math.min(this.clock.getDelta(), 0.1);

    if (this.resettingCamera) {
      this.resetCamera(deltaTime);
    }

    this.nebula.rotation.y += 0.01 * deltaTime;
    this.nebula.rotation.x += 0.005 * deltaTime;

    this.stars.forEach(star => {
      star.update(deltaTime);
    });

    this.orbits.forEach(orbit => {
      orbit.update(deltaTime, this.speedMultiplier);
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.dispose();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    new StellarSimulator();
  } catch (error) {
    console.error('Failed to initialize stellar simulator:', error);
  }
});
