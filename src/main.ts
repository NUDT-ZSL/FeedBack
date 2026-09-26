import * as THREE from 'three';
import { generateMaze, MazeData, GemData, WallData } from './maze';
import { Player } from './player';
import { MusicManager } from './music';
import { UIManager } from './ui';

class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;

  private mazeData: MazeData | null = null;
  private player: Player | null = null;
  private musicManager: MusicManager;
  private uiManager: UIManager;

  private wallMeshes: THREE.Mesh[] = [];
  private gemMeshes: THREE.Mesh[] = [];
  private gemParticles: THREE.Points[] = [];
  private explosionParticles: THREE.Points[] = [];
  private activeExplosions: { particles: THREE.Points; velocity: THREE.Vector3[]; life: number; maxLife: number }[] = [];

  private baseWallColor: THREE.Color;
  private borderWallColor: THREE.Color;
  private wallBrightness: number = 0.5;
  private targetBrightness: number = 0.5;
  private brightnessTransition: number = 0.2;
  private beatIntensity: number = 0;

  private gridLineOffset: number = 0;
  private gridLineSpeed: number = 1;

  private isGameStarted: boolean = false;
  private isGameWon: boolean = false;

  private maxActiveParticles: number = 100;
  private currentParticles: number = 0;

  private exitMarker: THREE.Mesh | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.Fog(0x0a0a1a, 10, 40);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const container = document.getElementById('canvas-container');
    if (container) {
      container.appendChild(this.renderer.domElement);
    }

    this.clock = new THREE.Clock();
    this.musicManager = new MusicManager();
    this.uiManager = new UIManager();

    this.baseWallColor = new THREE.Color(0x2d1b69);
    this.borderWallColor = new THREE.Color(0x8b5cf6);

    this.initLights();
    this.initFloor();
    this.bindEvents();
    this.initUI();
  }

  private initLights(): void {
    const ambientLight = new THREE.AmbientLight(0x404080, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    this.scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x8b5cf6, 0.5, 30);
    pointLight.position.set(0, 5, 0);
    this.scene.add(pointLight);
  }

  private initFloor(): void {
    const floorGeometry = new THREE.PlaneGeometry(60, 60);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x151530,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const gridHelper = new THREE.GridHelper(60, 60, 0x2a2a50, 0x1a1a40);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);
  }

  private initMaze(): void {
    this.wallMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.wallMeshes = [];

    this.gemMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.gemMeshes = [];

    this.gemParticles.forEach(points => {
      this.scene.remove(points);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    });
    this.gemParticles = [];

    this.mazeData = generateMaze(5, 4);

    const gemColors = this.mazeData.gems.map(g => g.color);
    this.uiManager.init(this.mazeData, gemColors);

    this.mazeData.walls.forEach(wallData => {
      const wallMesh = this.createWall(wallData);
      this.wallMeshes.push(wallMesh);
      this.scene.add(wallMesh);
    });

    this.mazeData.gems.forEach((gemData, index) => {
      const gemMesh = this.createGem(gemData);
      gemMesh.position.set(gemData.x, 1, gemData.z);
      this.gemMeshes.push(gemMesh);
      this.scene.add(gemMesh);

      const particles = this.createGemParticles(gemData);
      this.gemParticles.push(particles);
      this.scene.add(particles);
    });

    this.createExitMarker();
  }

  private createWall(wallData: WallData): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(wallData.width, wallData.height, wallData.depth);

    const material = new THREE.MeshStandardMaterial({
      color: this.baseWallColor,
      transparent: true,
      opacity: 0.85,
      emissive: this.borderWallColor,
      emissiveIntensity: this.wallBrightness * 0.3,
      roughness: 0.3,
      metalness: 0.5
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(wallData.x, wallData.y, wallData.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edgesGeometry = new THREE.EdgesGeometry(geometry);
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: this.borderWallColor,
      transparent: true,
      opacity: 0.9
    });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    mesh.add(edges);

    return mesh;
  }

  private createGem(gemData: GemData): THREE.Mesh {
    const size = 0.4;
    const geometry = new THREE.OctahedronGeometry(size, 0);

    const color = new THREE.Color(gemData.color);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.9
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;

    return mesh;
  }

  private createGemParticles(gemData: GemData): THREE.Points {
    const particleCount = 12;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const color = new THREE.Color(gemData.color);

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 0.6;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle * 2) * 0.2;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    points.position.set(gemData.x, 1, gemData.z);

    return points;
  }

  private createExitMarker(): void {
    if (!this.mazeData) return;

    const geometry = new THREE.RingGeometry(0.8, 1.2, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x666666,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });

    this.exitMarker = new THREE.Mesh(geometry, material);
    this.exitMarker.rotation.x = -Math.PI / 2;
    this.exitMarker.position.set(this.mazeData.exitX, 0.02, this.mazeData.exitZ);
    this.scene.add(this.exitMarker);
  }

  private updateExitMarker(): void {
    if (!this.exitMarker || !this.player) return;

    const allCollected = this.player.getCollectedCount() >= this.player.getTotalGems();
    const material = this.exitMarker.material as THREE.MeshBasicMaterial;

    if (allCollected) {
      material.color.setHex(0x00ff88);
      material.opacity = 0.8 + Math.sin(Date.now() * 0.005) * 0.2;
    } else {
      material.color.setHex(0x666666);
      material.opacity = 0.3;
    }
  }

  private createExplosion(position: THREE.Vector3, color: THREE.Color): void {
    if (this.currentParticles + 20 > this.maxActiveParticles) return;

    const particleCount = 20;
    const positions = new Float32Array(particleCount * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3,
        (Math.random() - 0.5) * 4
      );
      velocities.push(velocity);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: color,
      size: 0.15,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);
    this.currentParticles += particleCount;

    this.activeExplosions.push({
      particles,
      velocity: velocities,
      life: 0.5,
      maxLife: 0.5
    });
  }

  private updateExplosions(deltaTime: number): void {
    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const explosion = this.activeExplosions[i];
      explosion.life -= deltaTime;

      if (explosion.life <= 0) {
        this.scene.remove(explosion.particles);
        explosion.particles.geometry.dispose();
        (explosion.particles.material as THREE.Material).dispose();
        this.currentParticles -= explosion.velocity.length;
        this.activeExplosions.splice(i, 1);
        continue;
      }

      const positions = explosion.particles.geometry.attributes.position.array as Float32Array;
      const alpha = explosion.life / explosion.maxLife;

      for (let j = 0; j < explosion.velocity.length; j++) {
        positions[j * 3] += explosion.velocity[j].x * deltaTime;
        positions[j * 3 + 1] += explosion.velocity[j].y * deltaTime;
        positions[j * 3 + 2] += explosion.velocity[j].z * deltaTime;

        explosion.velocity[j].y -= 5 * deltaTime;
      }

      (explosion.particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (explosion.particles.material as THREE.PointsMaterial).opacity = alpha;
    }
  }

  private initUI(): void {
    const startButton = document.getElementById('start-button');
    const restartButton = document.getElementById('restart-button');

    if (startButton) {
      startButton.addEventListener('click', () => this.startGame());
    }

    if (restartButton) {
      restartButton.addEventListener('click', () => this.restartGame());
    }
  }

  private async startGame(): Promise<void> {
    if (this.isGameStarted) return;

    await this.musicManager.init();
    this.musicManager.resume();

    this.initMaze();

    if (this.mazeData) {
      this.player = new Player(this.mazeData);
      this.scene.add(this.player.mesh);
    }

    this.musicManager.startBeat();
    this.musicManager.setOnBeatCallback((intensity: number) => {
      this.onBeat(intensity);
    });

    this.uiManager.hideStartScreen();
    this.isGameStarted = true;
    this.isGameWon = false;
  }

  private restartGame(): void {
    if (this.player) {
      this.scene.remove(this.player.mesh);
      this.player.dispose();
      this.player = null;
    }

    this.activeExplosions.forEach(exp => {
      this.scene.remove(exp.particles);
      exp.particles.geometry.dispose();
      (exp.particles.material as THREE.Material).dispose();
    });
    this.activeExplosions = [];
    this.currentParticles = 0;

    if (this.exitMarker) {
      this.scene.remove(this.exitMarker);
      this.exitMarker.geometry.dispose();
      (this.exitMarker.material as THREE.Material).dispose();
      this.exitMarker = null;
    }

    this.musicManager.stopBeat();
    this.uiManager.reset();
    this.isGameStarted = false;
    this.isGameWon = false;
    this.wallBrightness = 0.5;
    this.targetBrightness = 0.5;
  }

  private onBeat(intensity: number): void {
    this.beatIntensity = intensity;
    this.targetBrightness = 0.5 + intensity * 0.3;
  }

  private updateWalls(deltaTime: number): void {
    const diff = this.targetBrightness - this.wallBrightness;
    const speed = 1 / this.brightnessTransition;
    this.wallBrightness += diff * Math.min(1, deltaTime * speed);

    this.gridLineOffset += deltaTime * this.gridLineSpeed;

    this.wallMeshes.forEach((mesh, index) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = this.wallBrightness * 0.4;

      const waveOffset = Math.sin(mesh.position.x * 0.5 + mesh.position.z * 0.3 + this.gridLineOffset) * 0.1;
      material.emissiveIntensity += waveOffset * 0.1;
    });
  }

  private updateGems(deltaTime: number): void {
    const rotationSpeed = 0.5;

    this.gemMeshes.forEach((mesh, index) => {
      if (!this.player || !this.mazeData) return;

      if (this.player.isGemCollected(index)) {
        mesh.visible = false;
        if (this.gemParticles[index]) {
          this.gemParticles[index].visible = false;
        }
        return;
      }

      mesh.rotation.y += rotationSpeed * deltaTime;
      mesh.rotation.x += rotationSpeed * 0.5 * deltaTime;
      mesh.position.y = 1 + Math.sin(Date.now() * 0.003 + index) * 0.15;

      if (this.gemParticles[index]) {
        this.gemParticles[index].rotation.y += rotationSpeed * 0.7 * deltaTime;
        this.gemParticles[index].position.y = 1 + Math.sin(Date.now() * 0.003 + index) * 0.15;

        const positions = this.gemParticles[index].geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2 + this.gridLineOffset * 2 + index;
          const radius = 0.5 + Math.sin(Date.now() * 0.005 + i + index) * 0.1;
          positions[i * 3] = Math.cos(angle) * radius;
          positions[i * 3 + 2] = Math.sin(angle) * radius;
        }
        (this.gemParticles[index].geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    });
  }

  private updateCamera(): void {
    if (!this.player) return;

    const playerPos = this.player.getPosition();
    const targetX = playerPos.x;
    const targetY = playerPos.y + 8;
    const targetZ = playerPos.z + 10;

    this.camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1);
    this.camera.lookAt(playerPos.x, playerPos.y, playerPos.z);
  }

  private checkGemCollection(): void {
    if (!this.player || !this.mazeData) return;

    const gemIndex = this.player.checkGemCollection();
    if (gemIndex !== null) {
      const gemData = this.mazeData.gems[gemIndex];

      this.musicManager.playNote(gemData.noteIndex);

      const gemMesh = this.gemMeshes[gemIndex];
      if (gemMesh) {
        const color = new THREE.Color(gemData.color);
        this.createExplosion(gemMesh.position.clone(), color);
      }

      this.uiManager.collectGem(gemIndex, 100);
    }
  }

  private checkWinCondition(): void {
    if (!this.player || this.isGameWon) return;

    if (this.player.checkExit()) {
      this.isGameWon = true;
      this.musicManager.stopBeat();
      this.uiManager.showWinScreen(this.uiManager.getTime(), this.uiManager.getScore());
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.onWindowResize());
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    const deltaTime = this.clock.getDelta();
    const clampedDelta = Math.min(deltaTime, 0.1);

    if (this.isGameStarted && !this.isGameWon) {
      if (this.player) {
        this.player.update(clampedDelta);
      }

      this.musicManager.update(clampedDelta);
      this.updateWalls(clampedDelta);
      this.updateGems(clampedDelta);
      this.updateExplosions(clampedDelta);
      this.checkGemCollection();
      this.checkWinCondition();
      this.updateExitMarker();
      this.updateCamera();

      if (this.player) {
        const pos = this.player.getPosition();
        this.uiManager.update(clampedDelta, { x: pos.x, z: pos.z });
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  start(): void {
    this.animate();
  }
}

const game = new Game();
game.start();
