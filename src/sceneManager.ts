import * as THREE from 'three';
import { ParticleSystem } from './particleSystem';
import { ForgeState, ForgeStateData, MaterialType } from './forgeCore';

export class SceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private particleSystem: ParticleSystem;
  private clock: THREE.Clock;
  
  private forge: THREE.Group | null = null;
  private anvil: THREE.Group | null = null;
  private waterTrough: THREE.Group | null = null;
  private materialBlock: THREE.Mesh | null = null;
  private heatedIngot: THREE.Group | null = null;
  private swordBlade: THREE.Group | null = null;
  private finalSword: THREE.Group | null = null;
  private grindstone: THREE.Mesh | null = null;
  
  private forgeLight: THREE.PointLight;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  
  private anvilOriginalPosition: THREE.Vector3 = new THREE.Vector3();
  private anvilShakeTime: number = 0;
  
  private ingotScale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };
  private ingotTemperature: number = 1200;
  
  private waterTime: number = 0;
  private steamTimer: number = 0;
  
  private grindProgress: number = 0;
  private sharpenProgress: number = 0;
  
  private swordRotationTime: number = 0;
  private swordFloatTime: number = 0;
  
  private currentState: ForgeState = 'idle';
  private materialType: MaterialType | null = null;
  
  private responsiveScale: number = 1;
  
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }
    this.container = container;
    
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a1e0e);
    
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 1, 0);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    
    this.container.appendChild(this.renderer.domElement);
    
    this.ambientLight = new THREE.AmbientLight(0x4a3a2a, 0.6);
    this.scene.add(this.ambientLight);
    
    this.directionalLight = new THREE.DirectionalLight(0xfff4e6, 0.8);
    this.directionalLight.position.set(5, 10, 5);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(this.directionalLight);
    
    this.forgeLight = new THREE.PointLight(0xff6600, 2, 10);
    this.forgeLight.position.set(0, 2, 0);
    this.forgeLight.castShadow = true;
    this.scene.add(this.forgeLight);
    
    this.particleSystem = new ParticleSystem(this.scene);
    this.particleSystem.setFirePosition(new THREE.Vector3(0, 1.8, 0));
    
    this.createEnvironment();
    this.createForge();
    this.createAnvil();
    this.createWaterTrough();
    this.createGrindstone();
    
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
    
    if (width <= 1366 || height <= 768) {
      this.responsiveScale = 0.8;
    } else {
      this.responsiveScale = 1;
    }
    
    if (this.forge) this.forge.scale.setScalar(this.responsiveScale);
    if (this.anvil) this.anvil.scale.setScalar(this.responsiveScale);
    if (this.waterTrough) this.waterTrough.scale.setScalar(this.responsiveScale);
  }

  private createEnvironment(): void {
    const wallGeometry = new THREE.BoxGeometry(20, 8, 0.5);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a2e1a,
      roughness: 0.9,
      metalness: 0.1
    });
    const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
    backWall.position.set(0, 3, -5);
    backWall.receiveShadow = true;
    this.scene.add(backWall);
    
    const floorGeometry = new THREE.PlaneGeometry(20, 15);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private createForge(): void {
    this.forge = new THREE.Group();
    
    const brickGeometry = new THREE.BoxGeometry(3, 0.4, 0.4);
    const brickMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a4535,
      roughness: 0.9,
      metalness: 0.1
    });
    
    for (let row = 0; row < 5; row++) {
      for (let col = -1; col <= 1; col++) {
        const brick = new THREE.Mesh(brickGeometry, brickMaterial);
        brick.position.set(
          col * 1 + (row % 2 === 0 ? 0 : 0.5),
          0.2 + row * 0.4,
          0
        );
        brick.castShadow = true;
        brick.receiveShadow = true;
        this.forge.add(brick);
      }
    }
    
    const fireOpeningGeometry = new THREE.BoxGeometry(1.5, 1.2, 0.5);
    const fireOpeningMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a0a00,
      transparent: true,
      opacity: 0.8
    });
    const fireOpening = new THREE.Mesh(fireOpeningGeometry, fireOpeningMaterial);
    fireOpening.position.set(0, 1.2, 0.2);
    this.forge.add(fireOpening);
    
    const chimneyGeometry = new THREE.BoxGeometry(0.8, 2, 0.8);
    const chimney = new THREE.Mesh(chimneyGeometry, brickMaterial);
    chimney.position.set(0, 3.2, 0);
    chimney.castShadow = true;
    this.forge.add(chimney);
    
    this.forge.position.set(0, 0, -2);
    this.scene.add(this.forge);
  }

  private createAnvil(): void {
    this.anvil = new THREE.Group();
    
    const baseGeometry = new THREE.BoxGeometry(2, 0.4, 1.5);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.6,
      metalness: 0.8,
      transparent: true,
      opacity: 0.9
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.2;
    base.castShadow = true;
    base.receiveShadow = true;
    this.anvil.add(base);
    
    const topGeometry = new THREE.BoxGeometry(1.8, 0.3, 1.3);
    const topMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.4,
      metalness: 0.9,
      transparent: true,
      opacity: 0.95
    });
    const top = new THREE.Mesh(topGeometry, topMaterial);
    top.position.y = 0.55;
    top.castShadow = true;
    top.receiveShadow = true;
    this.anvil.add(top);
    
    const dentGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const dentMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      roughness: 0.8,
      metalness: 0.7
    });
    
    for (let i = 0; i < 8; i++) {
      const dent = new THREE.Mesh(dentGeometry, dentMaterial);
      dent.position.set(
        (Math.random() - 0.5) * 1.2,
        0.65,
        (Math.random() - 0.5) * 0.8
      );
      dent.scale.y = 0.3;
      this.anvil.add(dent);
    }
    
    this.anvil.position.set(0, 0, 1);
    this.anvilOriginalPosition.copy(this.anvil.position);
    this.scene.add(this.anvil);
  }

  private createWaterTrough(): void {
    this.waterTrough = new THREE.Group();
    
    const troughGeometry = new THREE.BoxGeometry(2.5, 0.6, 1.5);
    const troughMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      roughness: 0.8,
      metalness: 0.2
    });
    const trough = new THREE.Mesh(troughGeometry, troughMaterial);
    trough.position.y = 0.3;
    trough.castShadow = true;
    this.waterTrough.add(trough);
    
    const waterGeometry = new THREE.PlaneGeometry(2.2, 1.2);
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x3366aa,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.6, 0);
    water.name = 'waterSurface';
    this.waterTrough.add(water);
    
    this.waterTrough.position.set(-4, 0, 1);
    this.scene.add(this.waterTrough);
  }

  private createGrindstone(): void {
    const grindGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.3, 32);
    const grindMaterial = new THREE.MeshStandardMaterial({
      color: 0x887766,
      roughness: 0.9,
      metalness: 0.1
    });
    this.grindstone = new THREE.Mesh(grindGeometry, grindMaterial);
    this.grindstone.rotation.z = Math.PI / 2;
    this.grindstone.position.set(3, 1, 1);
    this.grindstone.castShadow = true;
    this.grindstone.visible = false;
    this.scene.add(this.grindstone);
  }

  createMaterialBlock(type: MaterialType): void {
    this.materialType = type;
    
    const colors: Record<MaterialType, number> = {
      mystery: 0x555555,
      meteorite: 0x8844aa,
      cold: 0x3366ff
    };
    
    const sizes: Record<MaterialType, number> = {
      mystery: 0.5,
      meteorite: 0.45,
      cold: 0.55
    };
    
    if (this.materialBlock) {
      this.scene.remove(this.materialBlock);
      this.materialBlock.geometry.dispose();
      (this.materialBlock.material as THREE.Material).dispose();
    }
    
    const geometry = new THREE.BoxGeometry(sizes[type], sizes[type] * 0.6, sizes[type] * 0.8);
    const material = new THREE.MeshStandardMaterial({
      color: colors[type],
      roughness: 0.5,
      metalness: 0.8
    });
    
    this.materialBlock = new THREE.Mesh(geometry, material);
    this.materialBlock.position.set(0, 1.5, 0);
    this.materialBlock.castShadow = true;
    this.scene.add(this.materialBlock);
  }

  animateMaterialToForge(): void {
    if (!this.materialBlock) return;
    
    const targetPos = new THREE.Vector3(0, 1.2, -1.5);
    const startPos = this.materialBlock.position.clone();
    const duration = 1000;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      
      this.materialBlock!.position.lerpVectors(startPos, targetPos, eased);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }

  createHeatedIngot(): void {
    if (this.materialBlock) {
      this.scene.remove(this.materialBlock);
      this.materialBlock.geometry.dispose();
      (this.materialBlock.material as THREE.Material).dispose();
      this.materialBlock = null;
    }
    
    this.heatedIngot = new THREE.Group();
    
    const ingotGeometry = new THREE.BoxGeometry(0.5, 0.3, 1);
    const ingotMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff2200,
      emissiveIntensity: 1.5,
      roughness: 0.3,
      metalness: 0.6
    });
    
    const ingot = new THREE.Mesh(ingotGeometry, ingotMaterial);
    ingot.castShadow = true;
    ingot.name = 'ingotMesh';
    this.heatedIngot.add(ingot);
    
    const glowGeometry = new THREE.SphereGeometry(0.6, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.name = 'ingotGlow';
    this.heatedIngot.add(glow);
    
    this.heatedIngot.position.set(0, 1.5, -1.5);
    this.scene.add(this.heatedIngot);
    
    this.ingotScale = { x: 1, y: 1, z: 1 };
    this.ingotTemperature = 1200;
  }

  moveIngotToAnvil(): void {
    if (!this.heatedIngot) return;
    
    const targetPos = new THREE.Vector3(0, 0.9, 1);
    const startPos = this.heatedIngot.position.clone();
    const duration = 1500;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      
      this.heatedIngot!.position.lerpVectors(startPos, targetPos, eased);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }

  hammerStrike(): void {
    if (!this.heatedIngot) return;
    
    this.ingotScale.z = Math.min(1.8, this.ingotScale.z + 0.015);
    this.ingotScale.x = Math.max(0.6, this.ingotScale.x - 0.008);
    this.ingotScale.y = Math.max(0.5, this.ingotScale.y - 0.005);
    
    const ingotMesh = this.heatedIngot.getObjectByName('ingotMesh') as THREE.Mesh;
    if (ingotMesh) {
      ingotMesh.scale.set(this.ingotScale.x, this.ingotScale.y, this.ingotScale.z);
    }
    
    this.anvilShakeTime = 0.2;
  }

  updateIngotTemperature(temp: number): void {
    this.ingotTemperature = temp;
    
    if (!this.heatedIngot) return;
    
    const ingotMesh = this.heatedIngot.getObjectByName('ingotMesh') as THREE.Mesh;
    const glowMesh = this.heatedIngot.getObjectByName('ingotGlow') as THREE.Mesh;
    
    if (ingotMesh) {
      const material = ingotMesh.material as THREE.MeshStandardMaterial;
      const t = (temp - 600) / 600;
      const r = Math.floor(255 * Math.max(0.3, t));
      const g = Math.floor(100 * Math.max(0, t));
      const b = Math.floor(50 * Math.max(0, t - 0.5));
      material.color.setRGB(r / 255, g / 255, b / 255);
      material.emissive.setRGB(r / 255 * 0.8, g / 255 * 0.5, 0);
      material.emissiveIntensity = 1.5 * Math.max(0.2, t);
    }
    
    if (glowMesh) {
      const material = glowMesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.3 * Math.max(0.2, (temp - 600) / 600);
    }
    
    this.forgeLight.intensity = 2 * Math.max(0.5, (temp - 600) / 800);
  }

  moveIngotToWater(): void {
    if (!this.heatedIngot) return;
    
    const targetPos = new THREE.Vector3(-4, 0.5, 1);
    const startPos = this.heatedIngot.position.clone();
    const duration = 1500;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      
      this.heatedIngot!.position.lerpVectors(startPos, targetPos, eased);
      
      if (progress >= 0.5 && this.steamTimer < 2) {
        this.steamTimer += 0.1;
        this.particleSystem.emitSteamParticles(new THREE.Vector3(-4, 0.8, 1), 3);
      }
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }

  createSwordBlade(): void {
    if (this.heatedIngot) {
      this.scene.remove(this.heatedIngot);
      this.heatedIngot.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.heatedIngot = null;
    }
    
    this.swordBlade = new THREE.Group();
    
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.lineTo(0.08, 0);
    bladeShape.lineTo(0.05, 1.5);
    bladeShape.lineTo(0, 1.6);
    bladeShape.lineTo(-0.05, 1.5);
    bladeShape.lineTo(-0.08, 0);
    bladeShape.lineTo(0, 0);
    
    const extrudeSettings = {
      steps: 1,
      depth: 0.03,
      bevelEnabled: false
    };
    
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0x555544,
      roughness: 0.8,
      metalness: 0.6
    });
    
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.rotation.x = Math.PI / 2;
    blade.position.y = 0.8;
    blade.castShadow = true;
    blade.name = 'swordBladeMesh';
    this.swordBlade.add(blade);
    
    const guardGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.15);
    const guardMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.6,
      metalness: 0.4
    });
    const guard = new THREE.Mesh(guardGeometry, guardMaterial);
    guard.position.set(0, 0.78, 0);
    guard.castShadow = true;
    this.swordBlade.add(guard);
    
    const handleGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 12);
    const handleMaterial = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.9,
      metalness: 0.1
    });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.set(0, 0.6, 0);
    handle.castShadow = true;
    this.swordBlade.add(handle);
    
    this.swordBlade.position.set(0, 0, 1);
    this.scene.add(this.swordBlade);
    
    this.grindProgress = 0;
  }

  updateGrindProgress(progress: number): void {
    this.grindProgress = progress;
    
    if (!this.swordBlade) return;
    
    const bladeMesh = this.swordBlade.getObjectByName('swordBladeMesh') as THREE.Mesh;
    if (bladeMesh) {
      const material = bladeMesh.material as THREE.MeshStandardMaterial;
      const t = progress / 100;
      material.color.setRGB(0.4 + t * 0.4, 0.4 + t * 0.4, 0.35 + t * 0.45);
      material.roughness = 0.8 - t * 0.7;
      material.metalness = 0.6 + t * 0.35;
    }
  }

  moveSwordToGrindstone(): void {
    if (!this.swordBlade) return;
    
    if (this.grindstone) {
      this.grindstone.visible = true;
    }
    
    const targetPos = new THREE.Vector3(2.5, 1, 1);
    const startPos = this.swordBlade.position.clone();
    const duration = 1000;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      
      this.swordBlade!.position.lerpVectors(startPos, targetPos, eased);
      this.swordBlade!.rotation.z = Math.PI / 2 * eased;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }

  updateSharpenProgress(progress: number): void {
    this.sharpenProgress = progress;
    
    if (!this.swordBlade) return;
    
    const bladeMesh = this.swordBlade.getObjectByName('swordBladeMesh') as THREE.Mesh;
    if (bladeMesh) {
      bladeMesh.scale.x = 1 - (progress / 100) * 0.1;
      
      const material = bladeMesh.material as THREE.MeshStandardMaterial;
      const t = progress / 100;
      material.roughness = Math.max(0.05, 0.1 - t * 0.05);
      material.metalness = Math.min(0.98, 0.95 + t * 0.03);
    }
  }

  createFinalSword(inscription: string, materialType: MaterialType): void {
    if (this.swordBlade) {
      this.scene.remove(this.swordBlade);
      this.swordBlade.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.swordBlade = null;
    }
    
    if (this.grindstone) {
      this.grindstone.visible = false;
    }
    
    this.finalSword = new THREE.Group();
    
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.lineTo(0.08, 0);
    bladeShape.lineTo(0.05, 2);
    bladeShape.lineTo(0, 2.2);
    bladeShape.lineTo(-0.05, 2);
    bladeShape.lineTo(-0.08, 0);
    bladeShape.lineTo(0, 0);
    
    const extrudeSettings = {
      steps: 1,
      depth: 0.025,
      bevelEnabled: false
    };
    
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
    
    const materialColors: Record<MaterialType, number> = {
      mystery: 0xcccccc,
      meteorite: 0xddccff,
      cold: 0xccddff
    };
    
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: materialColors[materialType],
      roughness: 0.05,
      metalness: 0.98,
      envMapIntensity: 1.5
    });
    
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.rotation.x = Math.PI / 2;
    blade.castShadow = true;
    blade.name = 'finalBlade';
    this.finalSword.add(blade);
    
    const edgeGeometry = new THREE.EdgesGeometry(bladeGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.rotation.x = Math.PI / 2;
    this.finalSword.add(edges);
    
    const guardGeometry = new THREE.BoxGeometry(0.35, 0.06, 0.18);
    const guardMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.5,
      metalness: 0.6
    });
    const guard = new THREE.Mesh(guardGeometry, guardMaterial);
    guard.position.y = -0.05;
    guard.castShadow = true;
    this.finalSword.add(guard);
    
    const handleGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.35, 12);
    const handleMaterial = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.8,
      metalness: 0.2
    });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = -0.25;
    handle.castShadow = true;
    this.finalSword.add(handle);
    
    const pommelGeometry = new THREE.SphereGeometry(0.05, 16, 16);
    const pommelMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.3,
      metalness: 0.9
    });
    const pommel = new THREE.Mesh(pommelGeometry, pommelMaterial);
    pommel.position.y = -0.45;
    pommel.castShadow = true;
    this.finalSword.add(pommel);
    
    if (inscription) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'transparent';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8b0000';
      ctx.font = 'bold 36px "Noto Serif SC", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(inscription, canvas.width / 2, canvas.height / 2);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      
      const inscriptionGeometry = new THREE.PlaneGeometry(0.3, 0.08);
      const inscriptionMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
      });
      
      const inscriptionMesh = new THREE.Mesh(inscriptionGeometry, inscriptionMaterial);
      inscriptionMesh.rotation.x = Math.PI / 2;
      inscriptionMesh.position.set(0, 0.8, 0.015);
      inscriptionMesh.name = 'inscription';
      this.finalSword.add(inscriptionMesh);
    }
    
    const auraGeometry = new THREE.TorusGeometry(0.8, 0.02, 16, 100);
    const auraMaterial = new THREE.MeshBasicMaterial({
      color: materialColors[materialType],
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const aura = new THREE.Mesh(auraGeometry, auraMaterial);
    aura.rotation.x = Math.PI / 3;
    aura.name = 'aura';
    this.finalSword.add(aura);
    
    this.finalSword.position.set(0, 1.5, 0);
    this.finalSword.rotation.set(0.3, 0, 0);
    this.scene.add(this.finalSword);
    
    this.swordRotationTime = 0;
    this.swordFloatTime = 0;
  }

  getIntersectedObject(event: MouseEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const objects: THREE.Object3D[] = [];
    if (this.anvil) objects.push(this.anvil);
    if (this.heatedIngot) objects.push(this.heatedIngot);
    if (this.swordBlade) objects.push(this.swordBlade);
    
    const intersects = this.raycaster.intersectObjects(objects, true);
    
    if (intersects.length > 0) {
      return intersects[0].object;
    }
    
    return null;
  }

  getMouseWorldPosition(): THREE.Vector3 {
    const target = new THREE.Vector3();
    this.raycaster.ray.at(5, target);
    return target;
  }

  updateState(state: ForgeStateData): void {
    this.currentState = state.currentState;
    
    if (state.currentState === 'hammering') {
      this.updateIngotTemperature(state.temperature);
    }
  }

  render(): void {
    const delta = this.clock.getDelta();
    
    this.particleSystem.update(delta);
    
    if (this.anvilShakeTime > 0 && this.anvil) {
      this.anvilShakeTime -= delta;
      const shake = this.anvilShakeTime * 0.1;
      this.anvil.position.x = this.anvilOriginalPosition.x + (Math.random() - 0.5) * shake;
      this.anvil.position.y = this.anvilOriginalPosition.y + (Math.random() - 0.5) * shake;
      
      if (this.anvilShakeTime <= 0) {
        this.anvil.position.copy(this.anvilOriginalPosition);
      }
    }
    
    if (this.currentState === 'quenching') {
      this.waterTime += delta;
      this.steamTimer += delta;
      
      const waterSurface = this.waterTrough?.getObjectByName('waterSurface') as THREE.Mesh;
      if (waterSurface) {
        const material = waterSurface.material as THREE.MeshStandardMaterial;
        const wave = Math.sin(this.waterTime * 3) * 0.1 + Math.sin(this.waterTime * 5) * 0.05;
        material.color.setHSL(0.6, 0.6, 0.4 + wave * 0.1);
      }
      
      if (this.steamTimer > 0.1) {
        this.steamTimer = 0;
        this.particleSystem.emitSteamParticles(new THREE.Vector3(-4, 0.8, 1), 5);
      }
    }
    
    if (this.grindstone && this.currentState === 'sharpening') {
      this.grindstone.rotation.x += delta * 5;
    }
    
    if (this.finalSword && this.currentState === 'showing') {
      this.swordRotationTime += delta;
      this.swordFloatTime += delta;
      
      this.finalSword.rotation.y = (this.swordRotationTime / 10) * Math.PI * 2;
      this.finalSword.position.y = 1.5 + Math.sin(this.swordFloatTime * 2) * 0.2;
      
      const aura = this.finalSword.getObjectByName('aura') as THREE.Mesh;
      if (aura) {
        aura.rotation.z += delta * 0.5;
        const auraMaterial = aura.material as THREE.MeshBasicMaterial;
        auraMaterial.opacity = 0.2 + Math.sin(this.swordFloatTime * 3) * 0.1;
      }
    }
    
    const fireIntensity = 1.5 + Math.sin(this.clock.elapsedTime * 10) * 0.3;
    this.forgeLight.intensity = Math.max(0.5, fireIntensity * (this.currentState === 'heating' ? 1.5 : 0.8));
    
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.particleSystem.clear();
    this.renderer.dispose();
    window.removeEventListener('resize', () => this.handleResize());
  }

  getParticleSystem(): ParticleSystem {
    return this.particleSystem;
  }
}
