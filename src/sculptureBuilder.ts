import * as THREE from 'three';

export enum VisualizationMode {
  SPECTRUM = 'spectrum',
  WAVEFORM = 'waveform',
  PARTICLES = 'particles'
}

interface CubeState {
  targetHeight: number;
  currentHeight: number;
  velocity: number;
  basePosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  velocityVec: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  targetColor: THREE.Color;
  currentColor: THREE.Color;
  opacity: number;
}

interface ParticleState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  targetPosition: THREE.Vector3;
  color: THREE.Color;
  size: number;
}

export class SculptureBuilder {
  private scene: THREE.Scene | null = null;
  private sculptureGroup: THREE.Group = new THREE.Group();
  private cubes: THREE.Mesh[][][] = [];
  private cubeStates: CubeState[][][] = [];
  private particleSystem: THREE.Points | null = null;
  private particleStates: ParticleState[] = [];
  private particleGeometry: THREE.BufferGeometry | null = null;
  private particlePositions: Float32Array = new Float32Array();
  private particleColors: Float32Array = new Float32Array();
  
  private currentMode: VisualizationMode = VisualizationMode.SPECTRUM;
  private animationState: 'idle' | 'collapsing' | 'reforming' = 'idle';
  private animationProgress: number = 0;
  private animationDuration: number = 1;
  
  private readonly GRID_X = 16;
  private readonly GRID_Y = 8;
  private readonly GRID_Z = 8;
  private readonly CUBE_SIZE = 0.4;
  private readonly CUBE_GAP = 0.1;
  private readonly MAX_HEIGHT = 4;
  private readonly ROTATION_SPEED = (Math.PI * 2) / 30;
  
  private starField: THREE.Points | null = null;
  private sharedMaterial: THREE.MeshStandardMaterial | null = null;
  private edgeMaterial: THREE.LineBasicMaterial | null = null;

  constructor() {
    this.sculptureGroup.name = 'sculptureGroup';
  }

  init(scene: THREE.Scene): void {
    this.scene = scene;
    
    this.createSharedMaterials();
    this.createCubeGrid();
    this.createParticleSystem();
    this.createStarField();
    
    scene.add(this.sculptureGroup);
    
    this.updateModeVisibility();
  }

  private createSharedMaterials(): void {
    this.sharedMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.3,
      roughness: 0.2,
      transparent: true,
      opacity: 1,
      emissiveIntensity: 0.5
    });

    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8
    });
  }

  private createCubeGrid(): void {
    const totalWidth = this.GRID_X * (this.CUBE_SIZE + this.CUBE_GAP);
    const totalDepth = this.GRID_Z * (this.CUBE_SIZE + this.CUBE_GAP);
    const offsetX = -totalWidth / 2 + this.CUBE_SIZE / 2;
    const offsetZ = -totalDepth / 2 + this.CUBE_SIZE / 2;

    const geometry = new THREE.BoxGeometry(this.CUBE_SIZE, this.CUBE_SIZE, this.CUBE_SIZE);
    const edgeGeometry = new THREE.EdgesGeometry(geometry);

    for (let x = 0; x < this.GRID_X; x++) {
      this.cubes[x] = [];
      this.cubeStates[x] = [];
      
      for (let z = 0; z < this.GRID_Z; z++) {
        this.cubes[x][z] = [];
        this.cubeStates[x][z] = [];
        
        for (let y = 0; y < this.GRID_Y; y++) {
          const material = this.sharedMaterial!.clone();
          const cube = new THREE.Mesh(geometry, material);
          
          const baseX = offsetX + x * (this.CUBE_SIZE + this.CUBE_GAP);
          const baseY = y * (this.CUBE_SIZE + this.CUBE_GAP) + this.CUBE_SIZE / 2;
          const baseZ = offsetZ + z * (this.CUBE_SIZE + this.CUBE_GAP);
          
          cube.position.set(baseX, baseY, baseZ);
          cube.castShadow = true;
          cube.receiveShadow = true;
          
          const edges = new THREE.LineSegments(edgeGeometry, this.edgeMaterial!.clone());
          cube.add(edges);
          
          const bandIndex = Math.floor(x / (this.GRID_X / 16));
          const baseColor = this.getColorForBand(bandIndex, 0.5);
          (material as THREE.MeshStandardMaterial).color.copy(baseColor);
          (material as THREE.MeshStandardMaterial).emissive.copy(baseColor);
          
          this.sculptureGroup.add(cube);
          this.cubes[x][z][y] = cube;
          
          this.cubeStates[x][z][y] = {
            targetHeight: 0,
            currentHeight: 0,
            velocity: 0,
            basePosition: new THREE.Vector3(baseX, baseY, baseZ),
            currentPosition: new THREE.Vector3(baseX, baseY, baseZ),
            velocityVec: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            targetColor: baseColor.clone(),
            currentColor: baseColor.clone(),
            opacity: 1
          };
        }
      }
    }
  }

  private createParticleSystem(): void {
    const particleCount = this.GRID_X * this.GRID_Y * this.GRID_Z * 2;
    
    this.particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(particleCount * 3);
    this.particleColors = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      this.particlePositions[i * 3] = (Math.random() - 0.5) * 20;
      this.particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      this.particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      
      const color = this.getColorForBand(Math.floor(Math.random() * 16), Math.random());
      this.particleColors[i * 3] = color.r;
      this.particleColors[i * 3 + 1] = color.g;
      this.particleColors[i * 3 + 2] = color.b;
      
      this.particleStates.push({
        position: new THREE.Vector3(
          this.particlePositions[i * 3],
          this.particlePositions[i * 3 + 1],
          this.particlePositions[i * 3 + 2]
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02
        ),
        targetPosition: new THREE.Vector3(),
        color: color.clone(),
        size: Math.random() * 0.1 + 0.05
      });
    }
    
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    
    this.particleSystem = new THREE.Points(this.particleGeometry, particleMaterial);
    this.particleSystem.visible = false;
    this.sculptureGroup.add(this.particleSystem);
  }

  private createStarField(): void {
    const starCount = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount; i++) {
      const radius = 50 + Math.random() * 100;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      const brightness = 0.5 + Math.random() * 0.5;
      colors[i * 3] = 0.7 * brightness + Math.random() * 0.3;
      colors[i * 3 + 1] = 0.8 * brightness + Math.random() * 0.2;
      colors[i * 3 + 2] = 1.0 * brightness;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    
    this.starField = new THREE.Points(geometry, material);
    this.scene!.add(this.starField);
  }

  private getColorForBand(band: number, intensity: number): THREE.Color {
    const color = new THREE.Color();
    
    if (band < 6) {
      const t = band / 5;
      color.setRGB(
        1.0,
        0.23 + t * 0.2,
        0.23 * (1 - t * 0.5)
      );
    } else if (band < 12) {
      const t = (band - 6) / 5;
      color.setRGB(
        0,
        0.8 + t * 0.2,
        0.53 + t * 0.27
      );
    } else {
      const t = (band - 12) / 3;
      color.setRGB(
        0.42 * t,
        0.83 * (1 - t * 0.3),
        1.0
      );
    }
    
    const boost = 0.5 + intensity * 0.5;
    color.multiplyScalar(boost);
    
    return color;
  }

  update(frequencyData: number[], waveformData: number[], delta: number, isPlaying: boolean): void {
    if (this.animationState !== 'idle') {
      this.updateTransition(delta);
      return;
    }

    this.sculptureGroup.rotation.y += this.ROTATION_SPEED * delta;
    
    if (this.starField) {
      this.starField.rotation.y += this.ROTATION_SPEED * 0.1 * delta;
    }

    switch (this.currentMode) {
      case VisualizationMode.SPECTRUM:
        this.updateSpectrumMode(frequencyData, delta, isPlaying);
        break;
      case VisualizationMode.WAVEFORM:
        this.updateWaveformMode(frequencyData, waveformData, delta, isPlaying);
        break;
      case VisualizationMode.PARTICLES:
        this.updateParticlesMode(frequencyData, waveformData, delta, isPlaying);
        break;
    }
  }

  private updateSpectrumMode(frequencyData: number[], delta: number, isPlaying: boolean): void {
    const stiffness = 180;
    const damping = 12;

    for (let x = 0; x < this.GRID_X; x++) {
      const bandIndex = Math.floor(x / (this.GRID_X / frequencyData.length));
      const energy = isPlaying ? frequencyData[bandIndex] : 0;
      
      for (let z = 0; z < this.GRID_Z; z++) {
        for (let y = 0; y < this.GRID_Y; y++) {
          const state = this.cubeStates[x][z][y];
          const cube = this.cubes[x][z][y];
          
          const layerFactor = y / this.GRID_Y;
          const heightThreshold = layerFactor * 0.8 + 0.2;
          const targetHeight = energy > heightThreshold ? 
            (energy - heightThreshold) * this.MAX_HEIGHT * (1 + layerFactor * 0.5) : 0;
          
          state.targetHeight = targetHeight;
          
          const force = -stiffness * (state.currentHeight - state.targetHeight);
          const dampingForce = -damping * state.velocity;
          const acceleration = force + dampingForce;
          state.velocity += acceleration * delta;
          state.currentHeight += state.velocity * delta;
          
          const newY = state.basePosition.y + state.currentHeight;
          cube.position.y = newY;
          
          const scaleY = 1 + state.currentHeight * 0.5;
          cube.scale.y = Math.max(0.1, scaleY);
          
          const bandColor = this.getColorForBand(bandIndex, energy);
          state.targetColor.copy(bandColor);
          
          state.currentColor.lerp(state.targetColor, Math.min(1, delta * 5));
          
          const material = cube.material as THREE.MeshStandardMaterial;
          material.color.copy(state.currentColor);
          material.emissive.copy(state.currentColor);
          material.emissiveIntensity = 0.3 + energy * 0.7;
          
          const edges = cube.children[0] as THREE.LineSegments;
          const edgeMat = edges.material as THREE.LineBasicMaterial;
          edgeMat.color.copy(state.currentColor);
          edgeMat.opacity = 0.5 + energy * 0.5;
        }
      }
    }
  }

  private updateWaveformMode(frequencyData: number[], waveformData: number[], delta: number, isPlaying: boolean): void {
    const stiffness = 150;
    const damping = 10;

    for (let x = 0; x < this.GRID_X; x++) {
      const waveIndex = Math.floor(x / (this.GRID_X / waveformData.length));
      const waveValue = isPlaying ? (waveformData[waveIndex] - 0.5) * 2 : 0;
      const freqEnergy = isPlaying ? frequencyData[Math.floor(x / (this.GRID_X / frequencyData.length))] : 0;
      
      for (let z = 0; z < this.GRID_Z; z++) {
        const depthPhase = Math.sin(z * 0.5 + this.sculptureGroup.rotation.y) * 0.3;
        
        for (let y = 0; y < this.GRID_Y; y++) {
          const state = this.cubeStates[x][z][y];
          const cube = this.cubes[x][z][y];
          
          const layerFactor = y / this.GRID_Y;
          const heightModulation = waveValue * (1 - layerFactor * 0.5) + depthPhase;
          const targetHeight = Math.abs(heightModulation) * this.MAX_HEIGHT * freqEnergy;
          
          state.targetHeight = targetHeight;
          
          const force = -stiffness * (state.currentHeight - state.targetHeight);
          const dampingForce = -damping * state.velocity;
          const acceleration = force + dampingForce;
          state.velocity += acceleration * delta;
          state.currentHeight += state.velocity * delta;
          
          cube.position.y = state.basePosition.y + state.currentHeight;
          cube.position.x = state.basePosition.x + waveValue * 0.3 * layerFactor;
          cube.position.z = state.basePosition.z + depthPhase * 0.2;
          
          const bandColor = this.getColorForBand(Math.floor(x / (this.GRID_X / 16)), freqEnergy);
          state.targetColor.copy(bandColor);
          state.currentColor.lerp(state.targetColor, Math.min(1, delta * 5));
          
          const material = cube.material as THREE.MeshStandardMaterial;
          material.color.copy(state.currentColor);
          material.emissive.copy(state.currentColor);
          material.emissiveIntensity = 0.2 + freqEnergy * 0.6;
          
          cube.rotation.y = waveValue * 0.3;
          cube.rotation.z = depthPhase * 0.2;
        }
      }
    }
  }

  private updateParticlesMode(frequencyData: number[], waveformData: number[], delta: number, isPlaying: boolean): void {
    if (!this.particleSystem || !this.particleGeometry) return;

    const positions = this.particleGeometry.attributes.position.array as Float32Array;
    const colors = this.particleGeometry.attributes.color.array as Float32Array;
    
    const totalWidth = this.GRID_X * (this.CUBE_SIZE + this.CUBE_GAP);
    const totalDepth = this.GRID_Z * (this.CUBE_SIZE + this.CUBE_GAP);
    const offsetX = -totalWidth / 2;
    const offsetZ = -totalDepth / 2;

    for (let i = 0; i < this.particleStates.length; i++) {
      const state = this.particleStates[i];
      const bandIndex = Math.floor((i % this.GRID_X) / (this.GRID_X / frequencyData.length));
      const energy = isPlaying ? frequencyData[bandIndex] : 0;
      const waveValue = isPlaying ? (waveformData[i % waveformData.length] - 0.5) * 2 : 0;
      
      const gridX = (i % this.GRID_X) / this.GRID_X;
      const gridY = Math.floor((i / this.GRID_X) % this.GRID_Y) / this.GRID_Y;
      const gridZ = Math.floor(i / (this.GRID_X * this.GRID_Y)) / this.GRID_Z;
      
      state.targetPosition.set(
        offsetX + gridX * totalWidth + waveValue * energy * 2,
        gridY * this.MAX_HEIGHT * energy + Math.sin(this.sculptureGroup.rotation.y + i * 0.1) * 0.5,
        offsetZ + gridZ * totalDepth + Math.cos(this.sculptureGroup.rotation.y + i * 0.15) * 0.3
      );
      
      state.velocity.lerp(
        state.targetPosition.clone().sub(state.position).multiplyScalar(2),
        Math.min(1, delta * 3)
      );
      
      state.position.add(state.velocity.clone().multiplyScalar(delta));
      state.velocity.multiplyScalar(0.95);
      
      const noise = (Math.random() - 0.5) * energy * 0.5;
      positions[i * 3] = state.position.x + noise;
      positions[i * 3 + 1] = state.position.y + noise;
      positions[i * 3 + 2] = state.position.z + noise;
      
      const color = this.getColorForBand(bandIndex, energy);
      state.color.lerp(color, Math.min(1, delta * 3));
      colors[i * 3] = state.color.r;
      colors[i * 3 + 1] = state.color.g;
      colors[i * 3 + 2] = state.color.b;
    }
    
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
  }

  private updateTransition(delta: number): void {
    this.animationProgress += delta / this.animationDuration;
    
    if (this.animationState === 'collapsing') {
      this.updateCollapse(delta, this.animationProgress);
      if (this.animationProgress >= 1) {
        this.animationState = 'reforming';
        this.animationProgress = 0;
        this.updateModeVisibility();
      }
    } else if (this.animationState === 'reforming') {
      this.updateReform(delta, this.animationProgress);
      if (this.animationProgress >= 1) {
        this.animationState = 'idle';
        this.animationProgress = 0;
        this.resetCubeStates();
      }
    }
  }

  private updateCollapse(delta: number, progress: number): void {
    const gravity = -9.8;
    
    for (let x = 0; x < this.GRID_X; x++) {
      for (let z = 0; z < this.GRID_Z; z++) {
        for (let y = 0; y < this.GRID_Y; y++) {
          const state = this.cubeStates[x][z][y];
          const cube = this.cubes[x][z][y];
          
          if (progress === 0) {
            state.velocityVec.set(
              (Math.random() - 0.5) * 8,
              Math.random() * 6 + 2,
              (Math.random() - 0.5) * 8
            );
            state.angularVelocity.set(
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 10
            );
          }
          
          state.velocityVec.y += gravity * delta;
          state.velocityVec.multiplyScalar(0.99);
          
          state.currentPosition.add(state.velocityVec.clone().multiplyScalar(delta));
          
          cube.position.copy(state.currentPosition);
          cube.rotation.x += state.angularVelocity.x * delta;
          cube.rotation.y += state.angularVelocity.y * delta;
          cube.rotation.z += state.angularVelocity.z * delta;
          
          const opacity = 1 - progress;
          const material = cube.material as THREE.MeshStandardMaterial;
          material.opacity = opacity;
          
          const edges = cube.children[0] as THREE.LineSegments;
          const edgeMat = edges.material as THREE.LineBasicMaterial;
          edgeMat.opacity = opacity * 0.5;
        }
      }
    }
    
    if (this.particleSystem) {
      const particleMat = this.particleSystem.material as THREE.PointsMaterial;
      particleMat.opacity = 1 - progress;
    }
  }

  private updateReform(delta: number, progress: number): void {
    const easeProgress = this.easeOutCubic(progress);
    
    for (let x = 0; x < this.GRID_X; x++) {
      for (let z = 0; z < this.GRID_Z; z++) {
        for (let y = 0; y < this.GRID_Y; y++) {
          const state = this.cubeStates[x][z][y];
          const cube = this.cubes[x][z][y];
          
          if (progress === 0) {
            state.currentPosition.set(
              (Math.random() - 0.5) * 30,
              (Math.random() - 0.5) * 30,
              (Math.random() - 0.5) * 30
            );
            cube.rotation.set(
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2
            );
          }
          
          state.currentPosition.lerp(state.basePosition, Math.min(1, delta * 5 + easeProgress * 0.5));
          cube.position.copy(state.currentPosition);
          
          cube.rotation.x *= (1 - delta * 8);
          cube.rotation.y *= (1 - delta * 8);
          cube.rotation.z *= (1 - delta * 8);
          
          const opacity = easeProgress;
          const material = cube.material as THREE.MeshStandardMaterial;
          material.opacity = opacity;
          
          const edges = cube.children[0] as THREE.LineSegments;
          const edgeMat = edges.material as THREE.LineBasicMaterial;
          edgeMat.opacity = opacity * 0.8;
        }
      }
    }
    
    if (this.particleSystem && this.currentMode === VisualizationMode.PARTICLES) {
      const particleMat = this.particleSystem.material as THREE.PointsMaterial;
      particleMat.opacity = easeProgress * 0.8;
    }
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private resetCubeStates(): void {
    for (let x = 0; x < this.GRID_X; x++) {
      for (let z = 0; z < this.GRID_Z; z++) {
        for (let y = 0; y < this.GRID_Y; y++) {
          const state = this.cubeStates[x][z][y];
          const cube = this.cubes[x][z][y];
          
          state.currentHeight = 0;
          state.targetHeight = 0;
          state.velocity = 0;
          state.currentPosition.copy(state.basePosition);
          state.velocityVec.set(0, 0, 0);
          state.angularVelocity.set(0, 0, 0);
          state.opacity = 1;
          
          cube.position.copy(state.basePosition);
          cube.rotation.set(0, 0, 0);
          cube.scale.set(1, 1, 1);
          
          const material = cube.material as THREE.MeshStandardMaterial;
          material.opacity = 1;
          
          const edges = cube.children[0] as THREE.LineSegments;
          const edgeMat = edges.material as THREE.LineBasicMaterial;
          edgeMat.opacity = 0.8;
        }
      }
    }
  }

  private updateModeVisibility(): void {
    const showCubes = this.currentMode !== VisualizationMode.PARTICLES;
    const showParticles = this.currentMode === VisualizationMode.PARTICLES;
    
    for (let x = 0; x < this.GRID_X; x++) {
      for (let z = 0; z < this.GRID_Z; z++) {
        for (let y = 0; y < this.GRID_Y; y++) {
          this.cubes[x][z][y].visible = showCubes;
        }
      }
    }
    
    if (this.particleSystem) {
      this.particleSystem.visible = showParticles;
    }
  }

  async setMode(mode: VisualizationMode): Promise<void> {
    if (mode === this.currentMode || this.animationState !== 'idle') return;
    
    this.animationState = 'collapsing';
    this.animationProgress = 0;
    this.animationDuration = 0.5;
    
    await new Promise<void>(resolve => {
      const checkComplete = () => {
        if (this.animationState === 'idle') {
          this.currentMode = mode;
          resolve();
        } else {
          requestAnimationFrame(checkComplete);
        }
      };
      checkComplete();
    });
  }

  getCurrentMode(): VisualizationMode {
    return this.currentMode;
  }

  isTransitioning(): boolean {
    return this.animationState !== 'idle';
  }

  rotate(angle: number): void {
    this.sculptureGroup.rotation.y = angle;
  }

  getGroup(): THREE.Group {
    return this.sculptureGroup;
  }

  dispose(): void {
    for (let x = 0; x < this.GRID_X; x++) {
      for (let z = 0; z < this.GRID_Z; z++) {
        for (let y = 0; y < this.GRID_Y; y++) {
          const cube = this.cubes[x][z][y];
          cube.geometry.dispose();
          (cube.material as THREE.Material).dispose();
          const edges = cube.children[0] as THREE.LineSegments;
          edges.geometry.dispose();
          (edges.material as THREE.Material).dispose();
        }
      }
    }
    
    if (this.particleGeometry) {
      this.particleGeometry.dispose();
    }
    if (this.particleSystem) {
      (this.particleSystem.material as THREE.Material).dispose();
    }
    if (this.starField) {
      this.starField.geometry.dispose();
      (this.starField.material as THREE.Material).dispose();
    }
    if (this.sharedMaterial) {
      this.sharedMaterial.dispose();
    }
    if (this.edgeMaterial) {
      this.edgeMaterial.dispose();
    }
  }
}
