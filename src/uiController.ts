import * as THREE from 'three';
import { ForgeCore, ForgeStateData, MaterialType } from './forgeCore';
import { SceneManager } from './sceneManager';
import { ParticleSystem } from './particleSystem';

const stageNames: Record<string, string> = {
  idle: '准备锻造',
  heating: '炼化材料',
  hammering: '锤炼塑形',
  quenching: '淬火冷却',
  grinding: '研磨开光',
  sharpening: '磨砺开刃',
  inscribing: '铭刻剑名',
  showing: '宝剑出世'
};

export class UIController {
  private forgeCore: ForgeCore;
  private sceneManager: SceneManager;
  private particleSystem: ParticleSystem;
  private audioContext: AudioContext | null = null;
  
  private progressContainer: HTMLElement;
  private progressFill: HTMLElement;
  private progressLabel: HTMLElement;
  private messageBox: HTMLElement;
  private materialRack: HTMLElement;
  private stageIndicator: HTMLElement;
  private hammerHint: HTMLElement;
  private grindHint: HTMLElement;
  private inscriptionPanel: HTMLElement;
  private inscriptionInput: HTMLInputElement;
  private inscriptionSubmit: HTMLElement;
  
  private isDragging: boolean = false;
  private dragMaterialType: MaterialType | null = null;
  private isGrinding: boolean = false;
  private lastMouseY: number = 0;
  private grindStartY: number = 0;
  
  private messageTimeout: number | null = null;

  constructor(
    forgeCore: ForgeCore,
    sceneManager: SceneManager,
    particleSystem: ParticleSystem
  ) {
    this.forgeCore = forgeCore;
    this.sceneManager = sceneManager;
    this.particleSystem = particleSystem;
    
    this.progressContainer = document.getElementById('progress-container')!;
    this.progressFill = document.querySelector('.progress-fill')!;
    this.progressLabel = document.querySelector('.progress-label')!;
    this.messageBox = document.getElementById('message-box')!;
    this.materialRack = document.getElementById('material-rack')!;
    this.stageIndicator = document.getElementById('stage-indicator')!;
    this.hammerHint = document.getElementById('hammer-hint')!;
    this.grindHint = document.getElementById('grind-hint')!;
    this.inscriptionPanel = document.getElementById('inscription-panel')!;
    this.inscriptionInput = document.getElementById('inscription-input') as HTMLInputElement;
    this.inscriptionSubmit = document.getElementById('inscription-submit')!;
    
    this.initEventListeners();
    this.setupResponsiveLayout();
    
    this.forgeCore.onStateChange((state) => this.handleStateChange(state));
    this.forgeCore.onProgress((state) => this.handleProgressUpdate(state));
    
    this.updateStageIndicator('idle');
    this.showMessage('将材料拖入剑炉开始锻造', 3000);
  }

  private initEventListeners(): void {
    const materialItems = document.querySelectorAll('.material-item');
    materialItems.forEach((item) => {
      item.addEventListener('dragstart', (e) => this.handleDragStart(e as DragEvent));
      item.addEventListener('dragend', (e) => this.handleDragEnd(e as DragEvent));
    });
    
    const canvasContainer = document.getElementById('canvas-container')!;
    canvasContainer.addEventListener('dragover', (e) => this.handleDragOver(e));
    canvasContainer.addEventListener('drop', (e) => this.handleDrop(e));
    
    canvasContainer.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    canvasContainer.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    canvasContainer.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    canvasContainer.addEventListener('click', (e) => this.handleClick(e));
    
    this.inscriptionSubmit.addEventListener('click', () => this.handleInscriptionSubmit());
    this.inscriptionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleInscriptionSubmit();
      }
    });
    
    window.addEventListener('resize', () => this.setupResponsiveLayout());
  }

  private setupResponsiveLayout(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (width <= 1366 || height <= 768) {
      this.materialRack.classList.add('bottom');
    } else {
      this.materialRack.classList.remove('bottom');
    }
  }

  private handleDragStart(e: DragEvent): void {
    if (this.forgeCore.getState().currentState !== 'idle') {
      e.preventDefault();
      return;
    }
    
    const target = e.target as HTMLElement;
    const type = target.dataset.type as MaterialType;
    this.dragMaterialType = type;
    target.classList.add('dragging');
    
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', type);
    }
    
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    } catch {
      // Audio not supported
    }
  }

  private handleDragEnd(e: DragEvent): void {
    const target = e.target as HTMLElement;
    target.classList.remove('dragging');
    this.isDragging = false;
    this.dragMaterialType = null;
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  private handleDrop(e: DragEvent): void {
    e.preventDefault();
    
    const state = this.forgeCore.getState();
    if (state.currentState !== 'idle' || !this.dragMaterialType) return;
    
    const canvasRect = document.getElementById('canvas-container')!.getBoundingClientRect();
    const dropX = e.clientX - canvasRect.left;
    const dropY = e.clientY - canvasRect.top;
    
    const centerX = canvasRect.width / 2;
    const centerY = canvasRect.height / 2;
    
    if (Math.abs(dropX - centerX) < 200 && dropY < centerY + 100) {
      this.startHeating(this.dragMaterialType);
    } else {
      this.showMessage('请将材料拖入剑炉中', 2000, true);
    }
  }

  private startHeating(materialType: MaterialType): void {
    this.forgeCore.setMaterial(materialType);
    this.sceneManager.createMaterialBlock(materialType);
    this.sceneManager.animateMaterialToForge();
    this.forgeCore.enterState('heating');
    
    this.playHeatingSound();
    
    setTimeout(() => {
      this.sceneManager.createHeatedIngot();
      this.sceneManager.moveIngotToAnvil();
      this.showMessage('材料已炼化，请开始锤炼', 2000);
    }, 1000);
  }

  private handleClick(e: MouseEvent): void {
    const state = this.forgeCore.getState();
    
    if (state.currentState === 'hammering') {
      const intersected = this.sceneManager.getIntersectedObject(e);
      if (intersected) {
        this.handleHammerClick();
      }
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    const state = this.forgeCore.getState();
    
    if (state.currentState === 'grinding') {
      const intersected = this.sceneManager.getIntersectedObject(e);
      if (intersected) {
        this.isGrinding = true;
        this.lastMouseY = e.clientY;
        this.grindStartY = e.clientY;
      }
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isGrinding) return;
    
    const state = this.forgeCore.getState();
    if (state.currentState !== 'grinding') return;
    
    const deltaY = e.clientY - this.lastMouseY;
    const totalDelta = e.clientY - this.grindStartY;
    
    const absX = Math.abs(e.movementX);
    const absY = Math.abs(deltaY);
    
    if (absX > absY * 1.5) {
      this.showMessage('请沿剑脊方向（上下）研磨', 1500, true);
      const worldPos = this.sceneManager.getMouseWorldPosition();
      this.particleSystem.emitSparkParticles(
        worldPos,
        new THREE.Vector3(e.movementX, deltaY, 0).normalize(),
        5
      );
      this.lastMouseY = e.clientY;
      return;
    }
    
    if (absY > 5) {
      const progress = Math.min(Math.abs(totalDelta) / 500, 1) * 5;
      const success = this.forgeCore.addGrindingProgress(progress, true);
      
      if (success) {
        this.sceneManager.updateGrindProgress(state.grindingProgress);
        this.playGrindSound();
      }
      
      this.lastMouseY = e.clientY;
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    this.isGrinding = false;
  }

  private handleHammerClick(): void {
    this.forgeCore.addHammerCount();
    this.sceneManager.hammerStrike();
    this.playHammerSound();
    
    const state = this.forgeCore.getState();
    if (state.hammerCount >= 60) {
      this.showMessage('锤炼完成，准备淬火', 2000);
    }
  }

  private handleStateChange(state: ForgeStateData): void {
    this.sceneManager.updateState(state);
    this.updateStageIndicator(state.currentState);
    
    this.hideAllHints();
    
    switch (state.currentState) {
      case 'hammering':
        this.showProgress(state.hammerCount / 60 * 100, `锤击次数: ${state.hammerCount} / 60`);
        this.hammerHint.classList.add('visible');
        this.materialRack.style.opacity = '0.3';
        this.materialRack.style.pointerEvents = 'none';
        break;
        
      case 'quenching':
        this.hideProgress();
        this.sceneManager.moveIngotToWater();
        this.showMessage('正在淬火...', 3000);
        
        setTimeout(() => {
          this.sceneManager.createSwordBlade();
          this.forgeCore.setQuenchingComplete();
        }, 3000);
        break;
        
      case 'grinding':
        this.showProgress(0, '研磨进度: 0%');
        this.grindHint.classList.add('visible');
        this.sceneManager.moveSwordToGrindstone();
        break;
        
      case 'sharpening':
        this.showProgress(0, '开刃进度: 0%');
        this.showMessage('正在开刃...', 3000);
        break;
        
      case 'inscribing':
        this.hideProgress();
        this.inscriptionPanel.classList.add('visible');
        this.inscriptionInput.focus();
        break;
        
      case 'showing':
        this.inscriptionPanel.classList.remove('visible');
        this.hideProgress();
        this.showMessage('宝剑锻造完成！', 5000);
        this.sceneManager.createFinalSword(state.inscription, state.materialType!);
        break;
        
      default:
        this.hideProgress();
        this.materialRack.style.opacity = '1';
        this.materialRack.style.pointerEvents = 'auto';
        break;
    }
  }

  private handleProgressUpdate(state: ForgeStateData): void {
    switch (state.currentState) {
      case 'heating':
        this.showProgress(state.heatingProgress, `加热进度: ${Math.floor(state.heatingProgress)}%  温度: ${Math.floor(state.temperature)}℃`);
        break;
        
      case 'hammering':
        this.showProgress(state.hammerCount / 60 * 100, `锤击次数: ${state.hammerCount} / 60  温度: ${Math.floor(state.temperature)}℃`);
        break;
        
      case 'grinding':
        this.showProgress(state.grindingProgress, `研磨进度: ${Math.floor(state.grindingProgress)}%`);
        this.sceneManager.updateGrindProgress(state.grindingProgress);
        break;
        
      case 'sharpening':
        this.showProgress(state.sharpeningProgress, `开刃进度: ${Math.floor(state.sharpeningProgress)}%`);
        this.sceneManager.updateSharpenProgress(state.sharpeningProgress);
        break;
    }
  }

  private handleInscriptionSubmit(): void {
    const inscription = this.inscriptionInput.value.trim() || '无名';
    this.forgeCore.setInscription(inscription);
  }

  private updateStageIndicator(stage: string): void {
    this.stageIndicator.textContent = stageNames[stage] || '';
    this.stageIndicator.classList.add('visible');
  }

  private showProgress(progress: number, label: string): void {
    this.progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    this.progressLabel.textContent = label;
    this.progressContainer.classList.add('visible');
  }

  private hideProgress(): void {
    this.progressContainer.classList.remove('visible');
  }

  private hideAllHints(): void {
    this.hammerHint.classList.remove('visible');
    this.grindHint.classList.remove('visible');
  }

  private showMessage(text: string, duration: number = 2000, isError: boolean = false): void {
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }
    
    this.messageBox.textContent = text;
    this.messageBox.classList.toggle('error', isError);
    this.messageBox.classList.add('visible');
    
    this.messageTimeout = window.setTimeout(() => {
      this.messageBox.classList.remove('visible');
    }, duration);
  }

  private playHammerSound(): void {
    if (!this.audioContext) return;
    
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(200, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(80, this.audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
    
    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.2);
  }

  private playHeatingSound(): void {
    if (!this.audioContext) return;
    
    const bufferSize = this.audioContext.sampleRate * 2;
    const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.audioContext.createBufferSource();
    noise.buffer = noiseBuffer;
    
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    
    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 1.5);
    
    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    noise.start();
    noise.stop(this.audioContext.currentTime + 1.5);
  }

  private playGrindSound(): void {
    if (!this.audioContext) return;
    
    const bufferSize = this.audioContext.sampleRate * 0.1;
    const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.sin(i * 0.01);
    }
    
    const noise = this.audioContext.createBufferSource();
    noise.buffer = noiseBuffer;
    
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    
    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(0.05, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
    
    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    noise.start();
    noise.stop(this.audioContext.currentTime + 0.1);
  }
}
