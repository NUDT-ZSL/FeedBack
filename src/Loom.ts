import * as THREE from 'three';
import { Howl } from 'howler';
import { PatternMapping, WeaveType } from './PatternEngine';

export interface WarpThread {
  id: number;
  color: string;
  heddleHeight: number;
  targetHeight: number;
  slotIndex: number;
}

export interface WeftThread {
  id: number;
  color: string;
  yPosition: number;
}

export interface LoomState {
  warpThreads: WarpThread[];
  weftThreads: WeftThread[];
  heddlePositions: number[];
  fabricLength: number;
  targetLength: number;
  isShuttling: boolean;
  shuttlePosition: number;
  currentPattern: PatternMapping | null;
  viewMode: 'orbit' | 'firstPerson';
  currentWeftColor: string;
}

const LOOM_WIDTH = 3;
const LOOM_HEIGHT = 2;
const LOOM_DEPTH = 2.5;
const HEDDLE_COUNT = 108;
const HEDDLE_SPACING = 0.032;
const SLOT_COUNT = 108;
const WARP_SLOT_LENGTH = 3.5;
const SHUTTLE_SPEED = 2;
const SHUTTLE_DURATION = WARP_SLOT_LENGTH / SHUTTLE_SPEED;

export class Loom {
  public group: THREE.Group;
  public state: LoomState;
  public onShuttleComplete?: () => void;
  public onFabricComplete?: () => void;

  private heddleMeshes: THREE.InstancedMesh;
  private heddleDummy: THREE.Object3D;
  private heddleColors: Float32Array;
  private warpThreads: THREE.Line[] = [];
  private weftMeshes: THREE.Mesh[] = [];
  private shuttle: THREE.Group;
  private shuttleButton: THREE.Mesh;
  private fabricMesh: THREE.Mesh;
  private fabricTexture: THREE.CanvasTexture;
  private fabricCanvas: HTMLCanvasElement;
  private fabricCtx: CanvasRenderingContext2D;
  private slotPositions: THREE.Vector3[] = [];
  private clickableObjects: THREE.Object3D[] = [];
  private shuttleSound: Howl;
  private dropSound: Howl;
  private patternPreview: THREE.Mesh | null = null;
  private halos: THREE.PointLight[] = [];

  private shuttleAnimation = {
    active: false,
    startTime: 0,
    duration: SHUTTLE_DURATION,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
  };

  private heddleAnimations: Map<number, { startHeight: number; targetHeight: number; startTime: number; duration: number }[]> = new Map();

  constructor() {
    this.group = new THREE.Group();
    this.heddleDummy = new THREE.Object3D();

    this.state = {
      warpThreads: [],
      weftThreads: [],
      heddlePositions: new Array(HEDDLE_COUNT).fill(0),
      fabricLength: 0,
      targetLength: 20,
      isShuttling: false,
      shuttlePosition: -1,
      currentPattern: null,
      viewMode: 'orbit',
      currentWeftColor: '#cc2936',
    };

    const heddleGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.2, 4);
    const heddleMat = new THREE.MeshStandardMaterial({
      color: 0x8b7d6b,
      metalness: 0.3,
      roughness: 0.7,
    });
    this.heddleMeshes = new THREE.InstancedMesh(heddleGeo, heddleMat, HEDDLE_COUNT);
    this.heddleColors = new Float32Array(HEDDLE_COUNT * 3);
    this.heddleMeshes.instanceColor = new THREE.InstancedBufferAttribute(this.heddleColors, 3);

    this.fabricCanvas = document.createElement('canvas');
    this.fabricCanvas.width = 512;
    this.fabricCanvas.height = 512;
    this.fabricCtx = this.fabricCanvas.getContext('2d')!;
    this.fabricCtx.fillStyle = '#3e2723';
    this.fabricCtx.fillRect(0, 0, 512, 512);
    this.fabricTexture = new THREE.CanvasTexture(this.fabricCanvas);
    this.fabricTexture.needsUpdate = true;

    this.shuttleSound = this.createShuttleSound();
    this.dropSound = this.createDropSound();

    this.shuttle = this.createShuttle();
    this.shuttleButton = this.createShuttleButton();

    this.fabricMesh = this.createFabricMesh();

    this.buildLoomFrame();
    this.buildHeddles();
    this.buildWarpThreads();
    this.buildSlotPositions();
    this.buildHalos();

    this.group.add(this.heddleMeshes);
    this.group.add(this.shuttle);
    this.group.add(this.shuttleButton);
    this.group.add(this.fabricMesh);

    this.clickableObjects.push(this.shuttleButton);
  }

  private createShuttleSound(): Howl {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(120, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    return new Howl({
      src: [this.oscillatorToBuffer(oscillator, audioCtx, 0.3)],
      volume: 0.5,
    });
  }

  private oscillatorToBuffer(osc: OscillatorNode, ctx: AudioContext, duration: number): string {
    const sampleRate = ctx.sampleRate;
    const length = duration * sampleRate;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      data[i] = Math.sin(2 * Math.PI * 120 * t) * (1 - t / duration) * 0.3;
    }

    const wav = this.bufferToWav(buffer);
    return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  }

  private bufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return arrayBuffer;
  }

  private createDropSound(): Howl {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const length = 0.1 * audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / audioCtx.sampleRate;
      data[i] = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 20) * 0.3;
    }

    const wav = this.bufferToWav(buffer);
    return new Howl({
      src: [URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))],
      volume: 0.4,
    });
  }

  private buildLoomFrame(): void {
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x4e342e,
      roughness: 0.8,
      metalness: 0.1,
    });

    const legGeo = new THREE.BoxGeometry(0.15, LOOM_HEIGHT, 0.15);
    const positions = [
      [-LOOM_WIDTH / 2 + 0.1, 0, -LOOM_DEPTH / 2 + 0.1],
      [LOOM_WIDTH / 2 - 0.1, 0, -LOOM_DEPTH / 2 + 0.1],
      [-LOOM_WIDTH / 2 + 0.1, 0, LOOM_DEPTH / 2 - 0.1],
      [LOOM_WIDTH / 2 - 0.1, 0, LOOM_DEPTH / 2 - 0.1],
    ];

    positions.forEach(([x, y, z]) => {
      const leg = new THREE.Mesh(legGeo, frameMaterial);
      leg.position.set(x, y + LOOM_HEIGHT / 2, z);
      this.group.add(leg);
    });

    const topBeamGeo = new THREE.BoxGeometry(LOOM_WIDTH, 0.15, 0.15);
    const topBeam = new THREE.Mesh(topBeamGeo, frameMaterial);
    topBeam.position.set(0, LOOM_HEIGHT - 0.1, 0);
    this.group.add(topBeam);

    const bottomBeamGeo = new THREE.BoxGeometry(LOOM_WIDTH, 0.15, 0.3);
    const bottomBeam = new THREE.Mesh(bottomBeamGeo, frameMaterial);
    bottomBeam.position.set(0, 0.8, 0);
    this.group.add(bottomBeam);

    const frontBeamGeo = new THREE.BoxGeometry(LOOM_WIDTH, 0.1, 0.1);
    const frontBeam = new THREE.Mesh(frontBeamGeo, frameMaterial);
    frontBeam.position.set(0, LOOM_HEIGHT - 0.3, -LOOM_DEPTH / 2 + 0.15);
    this.group.add(frontBeam);

    const backBeam = new THREE.Mesh(frontBeamGeo, frameMaterial);
    backBeam.position.set(0, LOOM_HEIGHT - 0.3, LOOM_DEPTH / 2 - 0.15);
    this.group.add(backBeam);

    const tableGeo = new THREE.BoxGeometry(LOOM_WIDTH, 0.05, LOOM_DEPTH * 0.6);
    const table = new THREE.Mesh(tableGeo, frameMaterial);
    table.position.set(0, 1.0, -0.2);
    this.group.add(table);

    this.addCloudCarvings();
    this.addWarpSlot();
  }

  private addCloudCarvings(): void {
    const carvingMaterial = new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.9,
    });

    for (let i = 0; i < 5; i++) {
      const cloudShape = new THREE.Shape();
      const x = -LOOM_WIDTH / 2 + 0.5 + i * 0.5;
      cloudShape.absarc(x, 0, 0.08, 0, Math.PI * 2);

      const extrudeSettings = { depth: 0.02, bevelEnabled: false };
      const cloudGeo = new THREE.ExtrudeGeometry(cloudShape, extrudeSettings);
      const cloud = new THREE.Mesh(cloudGeo, carvingMaterial);
      cloud.position.set(0, LOOM_HEIGHT - 0.12, -LOOM_DEPTH / 2 + 0.08);
      this.group.add(cloud);

      const cloud2 = cloud.clone();
      cloud2.position.set(0, LOOM_HEIGHT - 0.12, LOOM_DEPTH / 2 - 0.08);
      cloud2.rotation.y = Math.PI;
      this.group.add(cloud2);
    }
  }

  private addWarpSlot(): void {
    const slotMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e1a12,
      roughness: 0.9,
    });

    const slotGeo = new THREE.BoxGeometry(WARP_SLOT_LENGTH, 0.05, 0.1);
    const slot = new THREE.Mesh(slotGeo, slotMaterial);
    slot.position.set(0, LOOM_HEIGHT - 0.25, 0);
    this.group.add(slot);

    const slotInnerGeo = new THREE.BoxGeometry(WARP_SLOT_LENGTH - 0.1, 0.02, 0.08);
    const slotInner = new THREE.Mesh(slotInnerGeo, new THREE.MeshStandardMaterial({
      color: 0x1a0f0a,
      roughness: 1,
    }));
    slotInner.position.set(0, LOOM_HEIGHT - 0.24, 0);
    this.group.add(slotInner);
  }

  private buildHeddles(): void {
    for (let i = 0; i < HEDDLE_COUNT; i++) {
      const x = (i - HEDDLE_COUNT / 2) * HEDDLE_SPACING;
      this.heddleDummy.position.set(x, LOOM_HEIGHT - 0.9, 0);
      this.heddleDummy.rotation.z = Math.PI / 2;
      this.heddleDummy.updateMatrix();
      this.heddleMeshes.setMatrixAt(i, this.heddleDummy.matrix);

      const color = new THREE.Color(0x8b7d6b);
      this.heddleColors[i * 3] = color.r;
      this.heddleColors[i * 3 + 1] = color.g;
      this.heddleColors[i * 3 + 2] = color.b;

      this.state.warpThreads.push({
        id: i,
        color: '#d6ecf0',
        heddleHeight: 0,
        targetHeight: 0,
        slotIndex: i,
      });

      this.state.heddlePositions[i] = 0;
    }
    this.heddleMeshes.instanceColor!.needsUpdate = true;
    this.heddleMeshes.instanceMatrix.needsUpdate = true;
  }

  private buildWarpThreads(): void {
    const warpMaterial = new THREE.LineBasicMaterial({
      color: 0xd6ecf0,
      transparent: true,
      opacity: 0.9,
    });

    for (let i = 0; i < HEDDLE_COUNT; i++) {
      const x = (i - HEDDLE_COUNT / 2) * HEDDLE_SPACING;
      const points = [];
      points.push(new THREE.Vector3(x, LOOM_HEIGHT - 0.3, 0));
      points.push(new THREE.Vector3(x, LOOM_HEIGHT - 1.5, 0));

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, warpMaterial.clone());
      this.warpThreads.push(line);
      this.group.add(line);
    }
  }

  private buildSlotPositions(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = (i - SLOT_COUNT / 2) * (WARP_SLOT_LENGTH / SLOT_COUNT);
      this.slotPositions.push(new THREE.Vector3(x, LOOM_HEIGHT - 0.25, 0));
    }
  }

  private buildHalos(): void {
    const haloPositions = [
      [-1, 1.5, 0],
      [1, 1.5, 0],
      [0, 1.8, -0.5],
      [0, 0.8, 0.5],
    ];

    haloPositions.forEach(([x, y, z]) => {
      const halo = new THREE.PointLight(0xb8860b, 0.3, 0.5);
      halo.position.set(x, y, z);
      this.halos.push(halo);
      this.group.add(halo);

      const haloMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0xb8860b,
          transparent: true,
          opacity: 0.3,
        })
      );
      haloMesh.position.copy(halo.position);
      this.group.add(haloMesh);
    });
  }

  private createShuttle(): THREE.Group {
    const shuttleGroup = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.6, 0.15, 0.3);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.6,
      metalness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    shuttleGroup.add(body);

    const tipGeo = new THREE.ConeGeometry(0.15, 0.2, 8);
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xdaa520,
      metalness: 0.8,
      roughness: 0.3,
    });
    const tip1 = new THREE.Mesh(tipGeo, tipMat);
    tip1.rotation.z = -Math.PI / 2;
    tip1.position.x = 0.35;
    shuttleGroup.add(tip1);

    const tip2 = tip1.clone();
    tip2.rotation.z = Math.PI / 2;
    tip2.position.x = -0.35;
    shuttleGroup.add(tip2);

    shuttleGroup.position.set(-WARP_SLOT_LENGTH / 2, LOOM_HEIGHT - 0.9, 0);

    return shuttleGroup;
  }

  private createShuttleButton(): THREE.Mesh {
    const buttonGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 32);
    const buttonMat = new THREE.MeshStandardMaterial({
      color: 0x8b7d6b,
      metalness: 0.7,
      roughness: 0.3,
    });
    const button = new THREE.Mesh(buttonGeo, buttonMat);
    button.rotation.x = Math.PI / 2;
    button.position.set(0, 1.05, -LOOM_DEPTH / 2 + 0.4);
    button.userData.isShuttleButton = true;
    return button;
  }

  private createFabricMesh(): THREE.Mesh {
    const fabricGeo = new THREE.PlaneGeometry(2.2, 1.5, 1, 1);
    const fabricMat = new THREE.MeshStandardMaterial({
      map: this.fabricTexture,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    const fabric = new THREE.Mesh(fabricGeo, fabricMat);
    fabric.position.set(0, LOOM_HEIGHT - 1.1, 0.01);
    fabric.rotation.x = -Math.PI / 8;
    return fabric;
  }

  public getSlotPositions(): THREE.Vector3[] {
    return this.slotPositions;
  }

  public getClickableObjects(): THREE.Object3D[] {
    return this.clickableObjects;
  }

  public getShuttleButton(): THREE.Mesh {
    return this.shuttleButton;
  }

  public setWarpColor(slotIndex: number, color: string): void {
    if (slotIndex < 0 || slotIndex >= HEDDLE_COUNT) return;

    this.state.warpThreads[slotIndex].color = color;

    const threeColor = new THREE.Color(color);
    this.heddleColors[slotIndex * 3] = threeColor.r;
    this.heddleColors[slotIndex * 3 + 1] = threeColor.g;
    this.heddleColors[slotIndex * 3 + 2] = threeColor.b;
    this.heddleMeshes.instanceColor!.needsUpdate = true;

    const warpMat = this.warpThreads[slotIndex].material as THREE.LineBasicMaterial;
    warpMat.color = threeColor;

    this.animateHeddleLift(slotIndex, 0.1);
    this.dropSound.play();
  }

  private animateHeddleLift(index: number, targetHeight: number): void {
    if (!this.heddleAnimations.has(index)) {
      this.heddleAnimations.set(index, []);
    }
    this.heddleAnimations.get(index)!.push({
      startHeight: this.state.warpThreads[index].heddleHeight,
      targetHeight,
      startTime: performance.now(),
      duration: 300,
    });
  }

  public setTargetLength(cm: number): void {
    this.state.targetLength = Math.max(10, Math.min(50, cm));
  }

  public applyPattern(mapping: PatternMapping): void {
    this.state.currentPattern = mapping;

    const colors = this.getSilkColorsForPattern(mapping);
    for (let i = 0; i < HEDDLE_COUNT; i++) {
      this.setWarpColor(i, colors[i]);
    }

    this.updatePatternPreview(mapping);
  }

  private getSilkColorsForPattern(mapping: PatternMapping): string[] {
    const colors: string[] = [];
    const scale = HEDDLE_COUNT / 64;
    const warpColor = '#cc2936';
    const weftColor = '#ffe066';
    const mixColor = '#1f4e79';

    for (let i = 0; i < HEDDLE_COUNT; i++) {
      const patternX = Math.floor(i / scale);
      const weaveType = mapping.weaveTypes[0][Math.min(patternX, 63)];
      if (weaveType === WeaveType.WARP_UP) {
        colors[i] = warpColor;
      } else if (weaveType === WeaveType.WEFT_VISIBLE) {
        colors[i] = weftColor;
      } else {
        colors[i] = mixColor;
      }
    }
    return colors;
  }

  private updatePatternPreview(mapping: PatternMapping): void {
    if (this.patternPreview) {
      this.group.remove(this.patternPreview);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const gray = mapping.weaveTypes[y][x];
        let color: string;
        if (gray === WeaveType.WARP_UP) {
          color = '#cc2936';
        } else if (gray === WeaveType.WEFT_VISIBLE) {
          color = '#ffe066';
        } else {
          color = '#1f4e79';
        }
        ctx.fillStyle = color;
        ctx.fillRect(x * 4, y * 4, 4, 4);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    const previewGeo = new THREE.PlaneGeometry(2.2, 2.2);
    const previewMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.4,
    });
    this.patternPreview = new THREE.Mesh(previewGeo, previewMat);
    this.patternPreview.position.set(0, LOOM_HEIGHT + 0.3, 0);
    this.patternPreview.rotation.x = -Math.PI / 2;
    this.group.add(this.patternPreview);
  }

  public fireShuttle(): boolean {
    if (this.state.isShuttling) return false;

    this.state.isShuttling = true;
    this.shuttleAnimation.active = true;
    this.shuttleAnimation.startTime = performance.now();
    this.shuttleAnimation.startPos.copy(this.shuttle.position);
    this.shuttleAnimation.endPos.set(
      WARP_SLOT_LENGTH / 2,
      LOOM_HEIGHT - 0.9,
      0
    );

    const rowIndex = Math.floor(this.state.weftThreads.length);
    if (this.state.currentPattern) {
      const positions = this.getHeddlePositionsForRow(this.state.currentPattern, rowIndex);
      for (let i = 0; i < HEDDLE_COUNT; i++) {
        if (positions[i] === 1) {
          this.animateHeddleLift(i, 0.15);
          this.state.heddlePositions[i] = 1;
        } else {
          this.animateHeddleLift(i, 0);
          this.state.heddlePositions[i] = 0;
        }
      }
    }

    this.shuttleSound.play();

    return true;
  }

  private getHeddlePositionsForRow(mapping: PatternMapping, rowIndex: number): number[] {
    const positions: number[] = new Array(HEDDLE_COUNT).fill(0);
    const heddleRow = mapping.heddleSequence[rowIndex % 64];
    const scale = HEDDLE_COUNT / 64;

    for (let i = 0; i < HEDDLE_COUNT; i++) {
      const patternX = Math.floor(i / scale);
      positions[i] = heddleRow[Math.min(patternX, 63)];
    }

    return positions;
  }

  private addWeftThread(): void {
    const weft: WeftThread = {
      id: this.state.weftThreads.length,
      color: this.state.currentWeftColor,
      yPosition: this.state.fabricLength / this.state.targetLength * 1.5 - 0.75,
    };
    this.state.weftThreads.push(weft);

    const weftGeo = new THREE.BoxGeometry(2.2, 0.02, 0.02);
    const weftMat = new THREE.MeshStandardMaterial({
      color: weft.color,
      roughness: 0.7,
    });
    const weftMesh = new THREE.Mesh(weftGeo, weftMat);
    weftMesh.position.set(0, LOOM_HEIGHT - 1.1 + weft.yPosition, 0.02);
    weftMesh.rotation.x = -Math.PI / 8;
    this.weftMeshes.push(weftMesh);
    this.group.add(weftMesh);

    this.state.fabricLength += 2;
    this.updateFabricTexture();

    if (this.state.fabricLength >= this.state.targetLength) {
      setTimeout(() => {
        this.onFabricComplete?.();
      }, 500);
    }
  }

  private updateFabricTexture(): void {
    const ctx = this.fabricCtx;
    const rowHeight = 512 / (this.state.targetLength / 2);
    const currentRow = this.state.weftThreads.length - 1;
    const y = 512 - (currentRow + 1) * rowHeight;

    for (let x = 0; x < HEDDLE_COUNT; x++) {
      const heddleUp = this.state.heddlePositions[x];
      const threadColor = heddleUp ? this.state.warpThreads[x].color : this.state.currentWeftColor;
      ctx.fillStyle = threadColor;
      const threadWidth = 512 / HEDDLE_COUNT;
      ctx.fillRect(x * threadWidth, y, threadWidth + 1, rowHeight + 1);
    }

    this.fabricTexture.needsUpdate = true;
  }

  public setCurrentWeftColor(color: string): void {
    this.state.currentWeftColor = color;
  }

  public getCurrentWeftColor(): string {
    return this.state.currentWeftColor;
  }

  public getState(): LoomState {
    return { ...this.state };
  }

  public getFabricTexture(): THREE.CanvasTexture {
    return this.fabricTexture;
  }

  public getWeftThreads(): WeftThread[] {
    return this.state.weftThreads;
  }

  public update(deltaTime: number): void {
    const now = performance.now();

    if (this.shuttleAnimation.active) {
      const elapsed = now - this.shuttleAnimation.startTime;
      const t = Math.min(elapsed / (this.shuttleAnimation.duration * 1000), 1);
      const easedT = (1 - Math.cos(t * Math.PI)) / 2;

      const pos = new THREE.Vector3().lerpVectors(
        this.shuttleAnimation.startPos,
        this.shuttleAnimation.endPos,
        easedT
      );
      this.shuttle.position.copy(pos);
      this.state.shuttlePosition = easedT * 2 - 1;

      if (t >= 1) {
        this.shuttleAnimation.active = false;
        this.state.isShuttling = false;
        this.addWeftThread();
        this.onShuttleComplete?.();
      }
    }

    this.heddleAnimations.forEach((anims, index) => {
      const remaining: typeof anims = [];
      anims.forEach((anim) => {
        const elapsed = now - anim.startTime;
        const t = Math.min(elapsed / anim.duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const height = anim.startHeight + (anim.targetHeight - anim.startHeight) * eased;
        this.state.warpThreads[index].heddleHeight = height;

        const x = (index - HEDDLE_COUNT / 2) * HEDDLE_SPACING;
        this.heddleDummy.position.set(x, LOOM_HEIGHT - 0.9 + height, 0);
        this.heddleDummy.rotation.z = Math.PI / 2;
        this.heddleDummy.updateMatrix();
        this.heddleMeshes.setMatrixAt(index, this.heddleDummy.matrix);

        const warpLine = this.warpThreads[index];
        const positions = warpLine.geometry.attributes.position.array as Float32Array;
        positions[1] = LOOM_HEIGHT - 0.3 + height;
        warpLine.geometry.attributes.position.needsUpdate = true;

        if (t < 1) {
          remaining.push(anim);
        }
      });
      if (remaining.length > 0) {
        this.heddleAnimations.set(index, remaining);
      } else {
        this.heddleAnimations.delete(index);
      }
    });
    this.heddleMeshes.instanceMatrix.needsUpdate = true;

    this.halos.forEach((halo, i) => {
      const pulse = 0.3 + Math.sin(now * 0.002 + i) * 0.1;
      halo.intensity = pulse;
    });

    const buttonPulse = 0.3 + Math.sin(now * 0.003) * 0.3;
    const buttonMat = this.shuttleButton.material as THREE.MeshStandardMaterial;
    buttonMat.emissive = new THREE.Color(0xffe0b2);
    buttonMat.emissiveIntensity = buttonPulse;
  }

  public dispose(): void {
    this.heddleMeshes.dispose();
    this.warpThreads.forEach((line) => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.weftMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.fabricTexture.dispose();
  }
}
