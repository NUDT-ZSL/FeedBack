import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { SolarSystem, Planet, SUN_DATA } from './SolarSystem';

export interface CameraState {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export class UIController {
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private solarSystem: SolarSystem;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private isDragging: boolean = false;
  private previousMousePosition: { x: number; y: number } = { x: 0, y: 0 };
  private spherical: { theta: number; phi: number; radius: number };
  private target: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  private focusedPlanet: Planet | null = null;
  private isAnimating: boolean = false;

  private readonly MIN_RADIUS = 5;
  private readonly MAX_RADIUS = 50;
  private readonly ROTATE_SPEED = 0.05;

  private infoPanel: HTMLElement;
  private planetNameEl: HTMLElement;
  private planetDistanceEl: HTMLElement;
  private planetPeriodEl: HTMLElement;
  private planetDiameterEl: HTMLElement;
  private planetTemperatureEl: HTMLElement;

  private playPauseBtn: HTMLButtonElement;
  private resetViewBtn: HTMLButtonElement;
  private speedSlider: HTMLInputElement;
  private speedValueEl: HTMLElement;

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    solarSystem: SolarSystem
  ) {
    this.camera = camera;
    this.renderer = renderer;
    this.solarSystem = solarSystem;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    const direction = new THREE.Vector3().subVectors(camera.position, this.target);
    this.spherical = {
      theta: Math.atan2(direction.x, direction.z),
      phi: Math.acos(direction.y / direction.length()),
      radius: direction.length()
    };

    this.infoPanel = document.getElementById('info-panel')!;
    this.planetNameEl = document.getElementById('planet-name')!;
    this.planetDistanceEl = document.getElementById('planet-distance')!;
    this.planetPeriodEl = document.getElementById('planet-period')!;
    this.planetDiameterEl = document.getElementById('planet-diameter')!;
    this.planetTemperatureEl = document.getElementById('planet-temperature')!;

    this.playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;
    this.resetViewBtn = document.getElementById('reset-view-btn') as HTMLButtonElement;
    this.speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
    this.speedValueEl = document.getElementById('speed-value')!;

    this.setupEventListeners();
    this.showPlanetInfo(null);
  }

  private setupEventListeners(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));
    canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));

    this.playPauseBtn.addEventListener('click', this.onPlayPause.bind(this));
    this.resetViewBtn.addEventListener('click', this.onResetView.bind(this));
    this.speedSlider.addEventListener('input', this.onSpeedChange.bind(this));

    window.addEventListener('resize', this.onResize.bind(this));
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.isAnimating) return;
    this.isDragging = true;
    this.previousMousePosition = { x: event.clientX, y: event.clientY };
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.isDragging || this.isAnimating) return;

    const deltaX = event.clientX - this.previousMousePosition.x;
    const deltaY = event.clientY - this.previousMousePosition.y;

    this.spherical.theta -= deltaX * this.ROTATE_SPEED;
    this.spherical.phi = Math.max(
      0.1,
      Math.min(Math.PI - 0.1, this.spherical.phi - deltaY * this.ROTATE_SPEED)
    );

    this.updateCameraPosition();

    this.previousMousePosition = { x: event.clientX, y: event.clientY };
  }

  private onMouseUp(): void {
    this.isDragging = false;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.isAnimating) return;

    const zoomSpeed = 0.002;
    this.spherical.radius = Math.max(
      this.MIN_RADIUS,
      Math.min(this.MAX_RADIUS, this.spherical.radius + event.deltaY * zoomSpeed * this.spherical.radius)
    );

    this.updateCameraPosition();
  }

  private onDoubleClick(event: MouseEvent): void {
    if (this.isAnimating) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.solarSystem.getAllMeshes();
    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (hit.userData.type === 'sun') {
        this.flyToSun();
      } else if (hit.userData.type === 'planet') {
        this.flyToPlanet(hit.userData.planet as Planet);
      }
    }
  }

  private flyToPlanet(planet: Planet): void {
    this.isAnimating = true;
    this.focusedPlanet = planet;

    const targetPosition = planet.mesh.position.clone();
    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, targetPosition)
      .normalize();
    const targetRadius = Math.max(planet.data.radius * 4, 8);
    const endPosition = targetPosition.clone().add(direction.multiplyScalar(targetRadius));

    this.animateCamera(
      this.camera.position.clone(),
      endPosition,
      this.target.clone(),
      targetPosition,
      1000
    );

    this.showPlanetInfo(planet);
  }

  private flyToSun(): void {
    this.isAnimating = true;
    this.focusedPlanet = null;

    const targetPosition = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, targetPosition)
      .normalize();
    const targetRadius = 25;
    const endPosition = targetPosition.clone().add(direction.multiplyScalar(targetRadius));

    this.animateCamera(
      this.camera.position.clone(),
      endPosition,
      this.target.clone(),
      targetPosition,
      1000
    );

    this.showPlanetInfo(null);
  }

  private onResetView(): void {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this.focusedPlanet = null;

    const endPosition = new THREE.Vector3(0, 30, 50);
    const endTarget = new THREE.Vector3(0, 0, 0);

    this.animateCamera(
      this.camera.position.clone(),
      endPosition,
      this.target.clone(),
      endTarget,
      1000
    );

    this.showPlanetInfo(null);
  }

  private animateCamera(
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
    startTarget: THREE.Vector3,
    endTarget: THREE.Vector3,
    duration: number
  ): void {
    const tween = new TWEEN.Tween({
      posX: startPos.x, posY: startPos.y, posZ: startPos.z,
      tgtX: startTarget.x, tgtY: startTarget.y, tgtZ: startTarget.z
    })
      .to({
        posX: endPos.x, posY: endPos.y, posZ: endPos.z,
        tgtX: endTarget.x, tgtY: endTarget.y, tgtZ: endTarget.z
      }, duration)
      .easing((t: number) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      })
      .onUpdate((obj: { posX: number; posY: number; posZ: number; tgtX: number; tgtY: number; tgtZ: number }) => {
        this.camera.position.set(obj.posX, obj.posY, obj.posZ);
        this.target.set(obj.tgtX, obj.tgtY, obj.tgtZ);
        this.camera.lookAt(this.target);

        const direction = new THREE.Vector3().subVectors(this.camera.position, this.target);
        this.spherical.theta = Math.atan2(direction.x, direction.z);
        this.spherical.phi = Math.acos(direction.y / direction.length());
        this.spherical.radius = direction.length();
      })
      .onComplete(() => {
        this.isAnimating = false;
      });

    tween.start();
  }

  private onPlayPause(): void {
    const newPlaying = !this.solarSystem.isPlaying;
    this.solarSystem.setPlaying(newPlaying);
    this.playPauseBtn.textContent = newPlaying ? '⏸' : '▶';
  }

  private onSpeedChange(): void {
    const speed = parseFloat(this.speedSlider.value);
    this.solarSystem.setSpeed(speed);
    this.speedValueEl.textContent = `${speed.toFixed(1)}x`;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private updateCameraPosition(): void {
    const x = this.spherical.radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta);
    const y = this.spherical.radius * Math.cos(this.spherical.phi);
    const z = this.spherical.radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta);

    const newPosition = this.target.clone().add(new THREE.Vector3(x, y, z));

    const start = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z
    };

    new TWEEN.Tween(start)
      .to({ x: newPosition.x, y: newPosition.y, z: newPosition.z }, 300)
      .easing(TWEEN.Easing.Cubic.Out)
      .onUpdate((obj: { x: number; y: number; z: number }) => {
        this.camera.position.set(obj.x, obj.y, obj.z);
        this.camera.lookAt(this.target);
      })
      .start();
  }

  private showPlanetInfo(planet: Planet | null): void {
    this.infoPanel.classList.add('visible');

    if (planet === null) {
      this.planetNameEl.textContent = SUN_DATA.nameCN;
      this.planetDistanceEl.textContent = `${SUN_DATA.distanceAU} AU`;
      this.planetPeriodEl.textContent = `${SUN_DATA.periodDays} 天`;
      this.planetDiameterEl.textContent = `${SUN_DATA.diameterKm.toLocaleString()} km`;
      this.planetTemperatureEl.textContent = SUN_DATA.temperature;
    } else {
      this.planetNameEl.textContent = planet.data.nameCN;
      this.planetDistanceEl.textContent = `${planet.data.distanceAU} AU`;
      this.planetPeriodEl.textContent = `${planet.data.periodDays.toLocaleString()} 天`;
      this.planetDiameterEl.textContent = `${planet.data.diameterKm.toLocaleString()} km`;
      this.planetTemperatureEl.textContent = planet.data.temperature;
    }
  }

  public update(): void {
    if (this.focusedPlanet && !this.isAnimating) {
      const targetPosition = this.focusedPlanet.mesh.position.clone();
      this.target.lerp(targetPosition, 0.1);
      this.updateCameraPositionImmediate();
    }

    this.updatePlanetLabels();
  }

  private updateCameraPositionImmediate(): void {
    const x = this.spherical.radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta);
    const y = this.spherical.radius * Math.cos(this.spherical.phi);
    const z = this.spherical.radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta);

    this.camera.position.copy(this.target).add(new THREE.Vector3(x, y, z));
    this.camera.lookAt(this.target);
  }

  private updatePlanetLabels(): void {
    const cameraPosition = this.camera.position;

    for (const planet of this.solarSystem.planets) {
      const distance = cameraPosition.distanceTo(planet.mesh.position);
      planet.setLabelVisible(distance < 25);
    }
  }
}
