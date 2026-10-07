import * as THREE from 'three';
import { EffectManager } from './EffectManager';
import { BookManager, Damage } from './BookManager';

export type MaterialType = 'paper' | 'silk' | 'paste' | 'pigment';

export interface MaterialItem {
  id: string;
  name: string;
  type: MaterialType;
  color: string;
  description: string;
  icon: string;
}

export class UIManager {
  private uiContainer: HTMLElement;
  private camera: THREE.Camera;
  private renderer: THREE.WebGLRenderer;
  private bookManager: BookManager;
  private effectManager: EffectManager;
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private materials: MaterialItem[] = [];
  private draggingMaterial: MaterialItem | null = null;
  private dragGhost: HTMLElement | null = null;
  private hoveredMaterial: HTMLElement | null = null;
  private onBindCallback: (() => void) | null = null;
  private materialShelf: HTMLElement | null = null;
  private bindButton: HTMLElement | null = null;
  private repairProgress: HTMLElement | null = null;
  private lastMouseMoveTime: number = 0;

  constructor(
    uiContainer: HTMLElement,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    bookManager: BookManager,
    effectManager: EffectManager
  ) {
    this.uiContainer = uiContainer;
    this.camera = camera;
    this.renderer = renderer;
    this.bookManager = bookManager;
    this.effectManager = effectManager;
    this.initMaterials();
    this.createUI();
    this.bindEvents();
  }

  private initMaterials(): void {
    this.materials = [
      { id: 'm1', name: '安徽宣纸', type: 'paper', color: '#f5f0e6', description: '产自安徽泾县，质地绵韧，光洁如玉，被誉为"纸寿千年"。用于修补书页缺损。', icon: '📜' },
      { id: 'm2', name: '蜀地笺纸', type: 'paper', color: '#e8dcc8', description: '四川特产，纸面细腻，带有淡淡花纹。用于修复珍贵版本。', icon: '📄' },
      { id: 'm3', name: '高丽皮纸', type: 'paper', color: '#f0e8d8', description: '朝鲜半岛传入，纤维细长，韧性极佳。用于加固书脊。', icon: '📋' },
      { id: 'm4', name: '桑皮纸', type: 'paper', color: '#e6dcc4', description: '以桑树皮为原料，纤维粗长，透气性好。用于修复古旧地图。', icon: '🗒️' },
      { id: 'm5', name: '蚕丝线', type: 'silk', color: '#faf8f0', description: '天然蚕丝纺成，细如发丝，强度极高。用于装订书页。', icon: '🧵' },
      { id: 'm6', name: '五色丝线', type: 'silk', color: '#c41e3a', description: '染以五方正色，寓意五行俱全。用于豪华装裱。', icon: '🎀' },
      { id: 'm7', name: '小麦浆糊', type: 'paste', color: '#e8d4b8', description: '精选小麦淀粉发酵而成，粘合力适中，可逆性好。传统修复首选。', icon: '🥣' },
      { id: 'm8', name: '糯米胶', type: 'paste', color: '#f0e0c0', description: '糯米熬制，粘性更强，耐候性好。用于修复严重破损。', icon: '🍚' },
      { id: 'm9', name: '松烟墨', type: 'pigment', color: '#1a1a1a', description: '松木焚烧烟灰制墨，色黑无光泽，入水不化。用于补描文字。', icon: '🖤' },
      { id: 'm10', name: '油烟墨', type: 'pigment', color: '#2a2a2a', description: '桐油烧烟制墨，黑而有光，细腻温润。用于绘制补全。', icon: '🖌️' },
      { id: 'm11', name: '朱砂', type: 'pigment', color: '#c41e3a', description: '天然矿物颜料，色红如丹，千年不褪。用于印章补色。', icon: '🔴' },
      { id: 'm12', name: '石青', type: 'pigment', color: '#1e90ff', description: '蓝铜矿制成，色泽典雅，稳定性佳。用于补描山水画。', icon: '🔵' }
    ];
  }

  private createUI(): void {
    this.createMaterialShelf();
    this.createBindButton();
    this.createRepairProgress();
    this.createDragGhost();
  }

  private createMaterialShelf(): void {
    this.materialShelf = document.createElement('div');
    this.materialShelf.style.cssText = `
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      width: 180px;
      padding: 16px 12px;
      background: linear-gradient(135deg, rgba(92, 58, 33, 0.95), rgba(139, 90, 43, 0.9));
      border: 2px solid transparent;
      border-image: linear-gradient(135deg, #5c3a21, #8b5a2b, #5c3a21) 1;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      z-index: 100;
    `;
    const title = document.createElement('div');
    title.textContent = '材料架';
    title.style.cssText = `
      font-family: 'Ma Shan Zheng', serif;
      font-size: 22px;
      color: #f5f0e6;
      text-align: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(245, 240, 230, 0.3);
      letter-spacing: 4px;
    `;
    this.materialShelf.appendChild(title);
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(3, 1fr);
      gap: 8px;
    `;
    this.materials.forEach((material, index) => {
      const cell = this.createMaterialCell(material, index);
      grid.appendChild(cell);
    });
    this.materialShelf.appendChild(grid);
    const labels = document.createElement('div');
    labels.style.cssText = `
      display: flex;
      justify-content: space-around;
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid rgba(245, 240, 230, 0.2);
    `;
    ['纸', '线', '糊', '墨'].forEach((label, i) => {
      const span = document.createElement('span');
      span.textContent = label;
      span.style.cssText = `
        font-family: 'ZCOOL XiaoWei', serif;
        font-size: 12px;
        color: rgba(245, 240, 230, 0.6);
      `;
      labels.appendChild(span);
    });
    this.materialShelf.appendChild(labels);
    this.uiContainer.appendChild(this.materialShelf);
  }

  private createMaterialCell(material: MaterialItem, index: number): HTMLElement {
    const cell = document.createElement('div');
    cell.dataset.materialId = material.id;
    cell.style.cssText = `
      position: relative;
      width: 36px;
      height: 36px;
      cursor: grab;
      transition: all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
      user-select: none;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
      width: 100%;
      height: 100%;
      background: rgba(245, 240, 230, 0.15);
      border: 1px solid rgba(245, 240, 230, 0.3);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
      transition: all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
      font-size: 20px;
    `;
    box.textContent = material.icon;
    cell.appendChild(box);
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: absolute;
      left: 110%;
      top: 50%;
      transform: translateY(-50%) scale(0.8);
      width: 200px;
      padding: 12px;
      background: rgba(40, 25, 15, 0.98);
      border: 1px solid ${material.color};
      border-radius: 6px;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
      z-index: 1000;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    `;
    const tipName = document.createElement('div');
    tipName.textContent = material.name;
    tipName.style.cssText = `
      font-family: 'Ma Shan Zheng', serif;
      font-size: 16px;
      color: ${material.color};
      margin-bottom: 6px;
    `;
    tooltip.appendChild(tipName);
    const tipDesc = document.createElement('div');
    tipDesc.textContent = material.description;
    tipDesc.style.cssText = `
      font-family: 'ZCOOL XiaoWei', serif;
      font-size: 12px;
      color: rgba(245, 240, 230, 0.85);
      line-height: 1.6;
    `;
    tooltip.appendChild(tipDesc);
    cell.appendChild(tooltip);
    cell.addEventListener('mouseenter', (e) => {
      this.onMaterialHover(cell, material, true);
    });
    cell.addEventListener('mouseleave', (e) => {
      this.onMaterialHover(cell, material, false);
    });
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.startDrag(cell, material, e);
    });
    return cell;
  }

  private createBindButton(): void {
    this.bindButton = document.createElement('button');
    this.bindButton.textContent = '装 订 成 卷';
    this.bindButton.style.cssText = `
      position: absolute;
      right: 40px;
      bottom: 60px;
      padding: 16px 48px;
      font-family: 'Ma Shan Zheng', serif;
      font-size: 24px;
      color: #f5f0e6;
      background: linear-gradient(135deg, #5c3a21 0%, #8b5a2b 50%, #5c3a21 100%);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      letter-spacing: 8px;
      transition: all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
      opacity: 0.5;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      z-index: 100;
    `;
    this.bindButton.style.setProperty('--stroke-color', '#8baa9a');
    const style = document.createElement('style');
    style.textContent = `
      @keyframes brushStroke {
        0% { stroke-dashoffset: 200; }
        100% { stroke-dashoffset: 0; }
      }
    `;
    document.head.appendChild(style);
    this.bindButton.addEventListener('click', () => {
      this.onBindClick();
    });
    this.bindButton.addEventListener('mouseenter', (e) => {
      const rect = this.bindButton!.getBoundingClientRect();
      this.effectManager.emitInkWash(
        new THREE.Vector3(
          (rect.left + rect.width / 2) / window.innerWidth * 2 - 1,
          -(rect.top + rect.height / 2) / window.innerHeight * 2 + 1,
          0
        ),
        0x5c3a21
      );
    });
    this.uiContainer.appendChild(this.bindButton);
  }

  private createRepairProgress(): void {
    this.repairProgress = document.createElement('div');
    this.repairProgress.style.cssText = `
      position: absolute;
      top: 30px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 32px;
      background: rgba(92, 58, 33, 0.9);
      border: 1px solid rgba(245, 240, 230, 0.3);
      border-radius: 8px;
      font-family: 'ZCOOL XiaoWei', serif;
      font-size: 16px;
      color: #f5f0e6;
      z-index: 100;
      letter-spacing: 2px;
    `;
    this.updateProgress();
    this.uiContainer.appendChild(this.repairProgress);
  }

  private createDragGhost(): void {
    this.dragGhost = document.createElement('div');
    this.dragGhost.style.cssText = `
      position: fixed;
      pointer-events: none;
      width: 50px;
      height: 50px;
      background: rgba(245, 240, 230, 0.9);
      border: 2px solid #8baa9a;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      z-index: 9999;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.8);
      transition: transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.2s;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(this.dragGhost);
  }

  private bindEvents(): void {
    document.addEventListener('mousemove', (e) => {
      const now = performance.now();
      if (now - this.lastMouseMoveTime < 16) return;
      this.lastMouseMoveTime = now;
      this.onMouseMove(e);
    });
    document.addEventListener('mouseup', (e) => {
      this.onMouseUp(e);
    });
  }

  private onMaterialHover(cell: HTMLElement, material: MaterialItem, isEnter: boolean): void {
    const box = cell.querySelector('div') as HTMLElement;
    const tooltip = cell.querySelector('div:nth-child(2)') as HTMLElement;
    if (isEnter) {
      this.hoveredMaterial = cell;
      box.style.transform = 'scale(1.3)';
      box.style.background = material.color + '40';
      box.style.borderColor = material.color;
      box.style.boxShadow = `0 0 20px ${material.color}60`;
      tooltip.style.opacity = '1';
      tooltip.style.visibility = 'visible';
      tooltip.style.transform = 'translateY(-50%) scale(1)';
      const rect = cell.getBoundingClientRect();
      this.effectManager.emitInkWash(
        new THREE.Vector3(
          (rect.left + rect.width / 2) / window.innerWidth * 2 - 1,
          -(rect.top + rect.height / 2) / window.innerHeight * 2 + 1,
          0
        )
      );
    } else {
      this.hoveredMaterial = null;
      box.style.transform = 'scale(1)';
      box.style.background = 'rgba(245, 240, 230, 0.15)';
      box.style.borderColor = 'rgba(245, 240, 230, 0.3)';
      box.style.boxShadow = 'none';
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
      tooltip.style.transform = 'translateY(-50%) scale(0.8)';
    }
  }

  private startDrag(cell: HTMLElement, material: MaterialItem, e: MouseEvent): void {
    this.draggingMaterial = material;
    if (this.dragGhost) {
      this.dragGhost.textContent = material.icon;
      this.dragGhost.style.left = e.clientX + 'px';
      this.dragGhost.style.top = e.clientY + 'px';
      this.dragGhost.style.opacity = '0.95';
      this.dragGhost.style.transform = 'translate(-50%, -50%) scale(1)';
    }
    cell.style.opacity = '0.5';
  }

  private onMouseMove(e: MouseEvent): void {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    if (this.draggingMaterial && this.dragGhost) {
      const bounceX = Math.sin(performance.now() * 0.01) * 3;
      const bounceY = Math.cos(performance.now() * 0.01) * 2;
      this.dragGhost.style.left = (e.clientX + bounceX) + 'px';
      this.dragGhost.style.top = (e.clientY + bounceY) + 'px';
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.draggingMaterial) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
      const intersectPoint = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, intersectPoint);
      const nearestDamage = this.bookManager.findNearestDamage(intersectPoint, 0.4);
      if (nearestDamage) {
        this.applyMaterialToDamage(nearestDamage, this.draggingMaterial);
      }
      if (this.dragGhost) {
        this.dragGhost.style.opacity = '0';
        this.dragGhost.style.transform = 'translate(-50%, -50%) scale(0.5)';
      }
      if (this.materialShelf) {
        const cell = this.materialShelf.querySelector(`[data-material-id="${this.draggingMaterial.id}"]`) as HTMLElement;
        if (cell) {
          cell.style.opacity = '1';
          cell.style.transition = 'opacity 0.3s';
        }
      }
      this.draggingMaterial = null;
    }
  }

  private applyMaterialToDamage(damage: Damage, material: MaterialItem): void {
    const success = this.bookManager.applyRepair(damage, material.name);
    if (success) {
      this.updateProgress();
    }
  }

  public updateProgress(): void {
    if (!this.repairProgress) return;
    const damages = this.bookManager.getDamages();
    const repaired = damages.filter(d => d.repaired || d.repairProgress > 0).length;
    const total = damages.length;
    const percent = Math.round((repaired / total) * 100);
    this.repairProgress.innerHTML = `
      <span style="color: #8baa9a;">古籍修复进度</span>
      <span style="margin: 0 12px; color: #f5f0e6;">${repaired}/${total}</span>
      <span style="color: #d4c5a9;">(${percent}%)</span>
    `;
    if (this.bindButton) {
      const isComplete = this.bookManager.isComplete();
      this.bindButton.style.opacity = isComplete ? '1' : '0.5';
      this.bindButton.style.pointerEvents = isComplete ? 'auto' : 'none';
      if (isComplete) {
        this.bindButton.style.animation = 'pulse 2s infinite';
        const style = document.createElement('style');
        style.textContent = `
          @keyframes pulse {
            0%, 100% { box-shadow: 0 4px 16px rgba(139, 90, 43, 0.5); }
            50% { box-shadow: 0 4px 32px rgba(139, 90, 43, 0.9), 0 0 40px rgba(139, 170, 154, 0.3); }
          }
        `;
        if (!document.head.querySelector('style[data-pulse]')) {
          style.dataset.pulse = 'true';
          document.head.appendChild(style);
        }
      }
    }
  }

  private onBindClick(): void {
    if (this.onBindCallback) {
      this.onBindCallback();
    }
  }

  public setOnBindCallback(callback: () => void): void {
    this.onBindCallback = callback;
  }

  public hideForScroll(): void {
    if (this.materialShelf) {
      this.materialShelf.style.transition = 'opacity 0.5s';
      this.materialShelf.style.opacity = '0';
      this.materialShelf.style.pointerEvents = 'none';
    }
    if (this.bindButton) {
      this.bindButton.style.transition = 'opacity 0.5s';
      this.bindButton.style.opacity = '0';
      this.bindButton.style.pointerEvents = 'none';
    }
    if (this.repairProgress) {
      this.repairProgress.style.transition = 'opacity 0.5s';
      this.repairProgress.style.opacity = '0';
    }
  }

  public showAfterScroll(): void {
    if (this.materialShelf) {
      this.materialShelf.style.opacity = '1';
      this.materialShelf.style.pointerEvents = 'auto';
    }
    if (this.bindButton) {
      this.bindButton.style.opacity = '1';
      this.bindButton.style.pointerEvents = 'auto';
    }
    if (this.repairProgress) {
      this.repairProgress.innerHTML = `
        <span style="color: #8baa9a;">修复完成</span>
        <span style="margin: 0 12px; color: #c41e3a;">✓</span>
        <span style="color: #d4c5a9;">点击书卷查看详情</span>
      `;
      this.repairProgress.style.opacity = '1';
    }
  }

  public update(deltaTime: number): void {
  }

  public dispose(): void {
    if (this.dragGhost) {
      document.body.removeChild(this.dragGhost);
    }
    if (this.materialShelf) {
      this.uiContainer.removeChild(this.materialShelf);
    }
    if (this.bindButton) {
      this.uiContainer.removeChild(this.bindButton);
    }
    if (this.repairProgress) {
      this.uiContainer.removeChild(this.repairProgress);
    }
  }
}
