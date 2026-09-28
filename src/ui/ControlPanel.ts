import { buildingSystem, BUILDING_COLORS, BuildingData } from '../modules/building/BuildingSystem';
import { trafficSystem, CarData } from '../modules/traffic/TrafficSystem';
import { lightingController, DayNightMode } from '../modules/lighting/LightingController';
import { sceneManager } from '../core/SceneManager';
import * as THREE from 'three';

export class ControlPanel {
  private static _instance: ControlPanel;
  private _container: HTMLElement;
  private _toolbar: HTMLElement;
  private _buildingPanel: HTMLElement;
  private _fpsCounter: HTMLElement;
  private _buildingList: HTMLElement;
  private _selectedBuildings: Set<string> = new Set();
  private _selectedBuildingId: string | null = null;
  private _carInfoCard: HTMLElement | null = null;
  
  private _pendingUiUpdates: Set<string> = new Set();
  private _animationFrameId: number | null = null;

  private constructor() {
    this._container = document.createElement('div');
    this._toolbar = document.createElement('div');
    this._buildingPanel = document.createElement('div');
    this._fpsCounter = document.createElement('div');
    this._buildingList = document.createElement('div');

    this._initStyles();
    this._buildToolbar();
    this._buildBuildingPanel();
    this._buildFpsCounter();
    
    document.body.appendChild(this._container);
    this._container.appendChild(this._toolbar);
    this._container.appendChild(this._buildingPanel);
    this._container.appendChild(this._fpsCounter);

    this._bindEvents();
    this._startFpsUpdate();
    this._checkResponsive();
  }

  public static get instance(): ControlPanel {
    if (!ControlPanel._instance) {
      ControlPanel._instance = new ControlPanel();
    }
    return ControlPanel._instance;
  }

  private _initStyles(): void {
    this._container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    this._toolbar.style.cssText = `
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 12px;
      padding: 12px 24px;
      background: linear-gradient(135deg, rgba(26, 26, 46, 0.9), rgba(22, 33, 62, 0.9));
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      pointer-events: auto;
      transition: all 0.3s ease;
    `;

    this._buildingPanel.style.cssText = `
      position: absolute;
      top: 80px;
      right: 20px;
      width: 280px;
      max-height: calc(100vh - 120px);
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      background: linear-gradient(135deg, rgba(26, 26, 46, 0.9), rgba(22, 33, 62, 0.9));
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      pointer-events: auto;
      overflow-y: auto;
      transition: all 0.3s ease;
    `;

    this._buildingList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 300px;
      overflow-y: auto;
    `;

    this._fpsCounter.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      padding: 8px 16px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      font-family: 'Consolas', monospace;
      font-size: 14px;
      font-weight: bold;
      color: #00ff88;
      pointer-events: none;
      transition: color 0.3s ease;
    `;
  }

  private _buildToolbar(): void {
    const modeButton = this._createButton('🌙 夜晚模式', 'mode-btn');
    const trafficButton = this._createButton('⏸ 暂停车流', 'traffic-btn');
    const sortButton = this._createButton('📊 按高度排序', 'sort-btn');
    const deleteButton = this._createButton('🗑 删除选中', 'delete-btn');

    modeButton.addEventListener('click', () => this._handleModeToggle());
    trafficButton.addEventListener('click', () => this._handleTrafficToggle());
    sortButton.addEventListener('click', () => this._handleSortToggle());
    deleteButton.addEventListener('click', () => this._handleBulkDelete());

    this._toolbar.appendChild(modeButton);
    this._toolbar.appendChild(trafficButton);
    this._toolbar.appendChild(sortButton);
    this._toolbar.appendChild(deleteButton);
  }

  private _createButton(text: string, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = text;
    button.className = className;
    button.style.cssText = `
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255, 255, 255, 0.2)';
      button.style.transform = 'translateY(-1px)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(255, 255, 255, 0.1)';
      button.style.transform = 'translateY(0)';
    });

    return button;
  }

  private _buildBuildingPanel(): void {
    const title = document.createElement('div');
    title.textContent = '建筑列表';
    title.style.cssText = `
      font-size: 16px;
      font-weight: bold;
      color: #ffffff;
      margin-bottom: 4px;
    `;

    const subtitle = document.createElement('div');
    subtitle.textContent = '点击地面放置建筑，点击建筑编辑';
    subtitle.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      margin-bottom: 8px;
    `;

    this._buildingPanel.appendChild(title);
    this._buildingPanel.appendChild(subtitle);
    this._buildingPanel.appendChild(this._buildingList);

    this._refreshBuildingList();
  }

  private _buildFpsCounter(): void {
    this._fpsCounter.textContent = 'FPS: --';
  }

  private _bindEvents(): void {
    const canvas = sceneManager.domElement;
    
    canvas.addEventListener('click', this._handleCanvasClick.bind(this));
    window.addEventListener('resize', this._checkResponsive.bind(this));
  }

  private _handleCanvasClick(event: MouseEvent): void {
    const ground = sceneManager.getGroundPlane();
    if (!ground) return;

    const buildingMeshes = buildingSystem.getAllBuildingMeshes();
    const carMeshes = trafficSystem.getAllCarMeshes();

    const allObjects = [...buildingMeshes, ...carMeshes, ground];
    
    const hit = sceneManager.raycastFromScreen(event.clientX, event.clientY, allObjects);

    if (hit) {
      const car = trafficSystem.getCarByMesh(hit.object as THREE.Mesh);
      if (car) {
        this._showCarInfo(car, event.clientX, event.clientY);
        return;
      }

      const building = buildingSystem.getBuildingByMesh(hit.object as THREE.Mesh);
      if (building) {
        this._selectBuilding(building.id);
        return;
      }

      if (hit.object === ground) {
        const point = hit.point;
        const snapped = buildingSystem.snapWorldPosition(point.x, point.z);
        const building = buildingSystem.addBuilding(snapped.x, snapped.z);
        if (building) {
          this._requestUiUpdate('buildingList');
        }
        return;
      }
    }

    this._hideCarInfo();
    this._deselectBuilding();
  }

  private _showCarInfo(car: CarData, x: number, y: number): void {
    this._hideCarInfo();

    const card = document.createElement('div');
    card.style.cssText = `
      position: fixed;
      left: ${x + 10}px;
      top: ${y + 10}px;
      padding: 12px 16px;
      background: rgba(26, 26, 46, 0.95);
      backdrop-filter: blur(8px);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      font-size: 13px;
      pointer-events: auto;
      z-index: 200;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    `;

    const colorHex = trafficSystem.getColorHex(car.color);

    card.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 6px;">🚗 ${car.id}</div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span>颜色:</span>
        <div style="width: 16px; height: 16px; background: ${colorHex}; border-radius: 3px;"></div>
        <span style="color: rgba(255,255,255,0.7);">${colorHex}</span>
      </div>
      <div style="margin-top: 4px; color: rgba(255,255,255,0.7);">
        速度: ${car.speed.toFixed(1)} 单位/秒
      </div>
    `;

    document.body.appendChild(card);
    this._carInfoCard = card;

    const closeHandler = (e: MouseEvent) => {
      if (!card.contains(e.target as Node)) {
        this._hideCarInfo();
        document.removeEventListener('click', closeHandler, true);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeHandler, true);
    }, 10);
  }

  private _hideCarInfo(): void {
    if (this._carInfoCard) {
      this._carInfoCard.remove();
      this._carInfoCard = null;
    }
  }

  private _selectBuilding(id: string): void {
    this._selectedBuildingId = id;
    this._requestUiUpdate('buildingList');
  }

  private _deselectBuilding(): void {
    this._selectedBuildingId = null;
    this._requestUiUpdate('buildingList');
  }

  private _toggleBuildingSelection(id: string): void {
    if (this._selectedBuildings.has(id)) {
      this._selectedBuildings.delete(id);
    } else {
      this._selectedBuildings.add(id);
    }
    this._requestUiUpdate('buildingList');
  }

  private _handleModeToggle(): void {
    const newMode = lightingController.toggleMode();
    const btn = this._toolbar.querySelector('.mode-btn') as HTMLButtonElement;
    if (btn) {
      btn.textContent = newMode === 'night' ? '☀️ 白天模式' : '🌙 夜晚模式';
    }
  }

  private _handleTrafficToggle(): void {
    const isRunning = trafficSystem.toggle();
    const btn = this._toolbar.querySelector('.traffic-btn') as HTMLButtonElement;
    if (btn) {
      btn.textContent = isRunning ? '⏸ 暂停车流' : '▶ 恢复车流';
    }
  }

  private _handleSortToggle(): void {
    const currentSort = buildingSystem.getSortByHeight();
    let newSort: 'asc' | 'desc' | null;

    if (currentSort === null) {
      newSort = 'asc';
    } else if (currentSort === 'asc') {
      newSort = 'desc';
    } else {
      newSort = null;
    }

    buildingSystem.setSortByHeight(newSort);
    
    const btn = this._toolbar.querySelector('.sort-btn') as HTMLButtonElement;
    if (btn) {
      if (newSort === null) {
        btn.textContent = '📊 按高度排序';
      } else if (newSort === 'asc') {
        btn.textContent = '📊 高度升序 ↑';
      } else {
        btn.textContent = '📊 高度降序 ↓';
      }
    }

    this._requestUiUpdate('buildingList');
  }

  private _handleBulkDelete(): void {
    if (this._selectedBuildings.size === 0) {
      alert('请先选中要删除的建筑');
      return;
    }

    const confirmed = confirm(`确定要删除选中的 ${this._selectedBuildings.size} 栋建筑吗？`);
    if (confirmed) {
      const ids = Array.from(this._selectedBuildings);
      buildingSystem.removeBuildings(ids);
      this._selectedBuildings.clear();
      this._selectedBuildingId = null;
      this._requestUiUpdate('buildingList');
    }
  }

  private _refreshBuildingList(): void {
    const buildings = buildingSystem.getBuildings();
    
    this._buildingList.innerHTML = '';

    const countInfo = document.createElement('div');
    countInfo.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 8px;
    `;
    countInfo.textContent = `共 ${buildings.length} 栋建筑 (最多100)`;
    this._buildingList.appendChild(countInfo);

    if (buildings.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        padding: 20px;
        text-align: center;
        color: rgba(255, 255, 255, 0.4);
        font-size: 13px;
      `;
      empty.textContent = '暂无建筑\n点击地面放置建筑';
      empty.style.whiteSpace = 'pre-line';
      this._buildingList.appendChild(empty);
      return;
    }

    for (const building of buildings) {
      const item = this._createBuildingItem(building);
      this._buildingList.appendChild(item);
    }
  }

  private _createBuildingItem(building: BuildingData): HTMLElement {
    const item = document.createElement('div');
    const isSelected = this._selectedBuildings.has(building.id);
    const isActive = this._selectedBuildingId === building.id;

    item.style.cssText = `
      padding: 10px 12px;
      background: ${isActive ? 'rgba(52, 152, 219, 0.3)' : 'rgba(255, 255, 255, 0.05)'};
      border-radius: 8px;
      border: 1px solid ${isSelected ? 'rgba(52, 152, 219, 0.8)' : 'rgba(255, 255, 255, 0.1)'};
      cursor: pointer;
      transition: all 0.2s ease;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    `;

    const left = document.createElement('div');
    left.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isSelected;
    checkbox.style.cssText = 'cursor: pointer;';
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleBuildingSelection(building.id);
    });

    const colorDot = document.createElement('div');
    colorDot.style.cssText = `
      width: 12px;
      height: 12px;
      background: #${building.color.toString(16).padStart(6, '0')};
      border-radius: 50%;
      flex-shrink: 0;
    `;

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 500;
    `;
    nameSpan.textContent = building.id;

    left.appendChild(checkbox);
    left.appendChild(colorDot);
    left.appendChild(nameSpan);

    const heightSpan = document.createElement('span');
    heightSpan.style.cssText = `
      color: rgba(255, 255, 255, 0.6);
      font-size: 12px;
    `;
    heightSpan.textContent = `${building.height.toFixed(0)}m`;

    header.appendChild(left);
    header.appendChild(heightSpan);

    const controls = document.createElement('div');
    controls.style.cssText = `
      display: ${isActive ? 'block' : 'none'};
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

    const sliderLabel = document.createElement('div');
    sliderLabel.style.cssText = `
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 6px;
    `;
    sliderLabel.innerHTML = `<span>高度</span><span id="height-value-${building.id}">${building.height.toFixed(0)}m</span>`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '5';
    slider.max = '100';
    slider.value = building.height.toString();
    slider.style.cssText = `
      width: 100%;
      margin-bottom: 10px;
      accent-color: #3498db;
    `;
    slider.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      buildingSystem.updateHeight(building.id, value);
      const valEl = controls.querySelector(`#height-value-${building.id}`);
      if (valEl) valEl.textContent = `${value.toFixed(0)}m`;
    });

    const colorsLabel = document.createElement('div');
    colorsLabel.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 6px;
    `;
    colorsLabel.textContent = '颜色';

    const colorsContainer = document.createElement('div');
    colorsContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    `;

    for (let i = 0; i < BUILDING_COLORS.length; i++) {
      const colorBtn = document.createElement('div');
      colorBtn.style.cssText = `
        width: 24px;
        height: 24px;
        background: #${BUILDING_COLORS[i].toString(16).padStart(6, '0')};
        border-radius: 4px;
        cursor: pointer;
        border: 2px solid ${building.color === BUILDING_COLORS[i] ? '#fff' : 'transparent'};
        transition: all 0.2s ease;
        box-sizing: border-box;
      `;
      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        buildingSystem.updateColor(building.id, i);
        colorDot.style.background = `#${BUILDING_COLORS[i].toString(16).padStart(6, '0')}`;
        
        const allColorBtns = colorsContainer.querySelectorAll('div');
        allColorBtns.forEach((btn, idx) => {
          (btn as HTMLElement).style.border = idx === i ? '2px solid #fff' : '2px solid transparent';
        });
      });
      colorsContainer.appendChild(colorBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '删除建筑';
    deleteBtn.style.cssText = `
      width: 100%;
      margin-top: 10px;
      padding: 6px 12px;
      background: rgba(231, 76, 60, 0.3);
      border: 1px solid rgba(231, 76, 60, 0.5);
      border-radius: 6px;
      color: #ff8888;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('确定删除这栋建筑吗？')) {
        buildingSystem.removeBuilding(building.id);
        this._selectedBuildings.delete(building.id);
        if (this._selectedBuildingId === building.id) {
          this._selectedBuildingId = null;
        }
        this._requestUiUpdate('buildingList');
      }
    });

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.background = 'rgba(231, 76, 60, 0.5)';
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.background = 'rgba(231, 76, 60, 0.3)';
    });

    controls.appendChild(sliderLabel);
    controls.appendChild(slider);
    controls.appendChild(colorsLabel);
    controls.appendChild(colorsContainer);
    controls.appendChild(deleteBtn);

    item.appendChild(header);
    item.appendChild(controls);

    item.addEventListener('click', () => {
      if (this._selectedBuildingId === building.id) {
        this._selectedBuildingId = null;
      } else {
        this._selectedBuildingId = building.id;
      }
      this._requestUiUpdate('buildingList');
    });

    item.addEventListener('mouseenter', () => {
      if (!isActive) {
        item.style.background = 'rgba(255, 255, 255, 0.1)';
      }
    });
    item.addEventListener('mouseleave', () => {
      if (!isActive) {
        item.style.background = 'rgba(255, 255, 255, 0.05)';
      }
    });

    return item;
  }

  private _requestUiUpdate(type: string): void {
    this._pendingUiUpdates.add(type);
    
    if (this._animationFrameId === null) {
      this._animationFrameId = requestAnimationFrame(() => {
        this._processUiUpdates();
        this._animationFrameId = null;
      });
    }
  }

  private _processUiUpdates(): void {
    if (this._pendingUiUpdates.has('buildingList')) {
      this._refreshBuildingList();
    }
    
    this._pendingUiUpdates.clear();
  }

  private _startFpsUpdate(): void {
    const updateFps = () => {
      const fps = sceneManager.fps;
      this._fpsCounter.textContent = `FPS: ${fps}`;

      if (fps < 30) {
        this._fpsCounter.style.color = '#ff4444';
        this._fpsCounter.style.animation = 'fps-blink 1s ease-in-out infinite';
      } else {
        this._fpsCounter.style.color = '#00ff88';
        this._fpsCounter.style.animation = 'none';
      }

      requestAnimationFrame(updateFps);
    };

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fps-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);

    updateFps();
  }

  private _checkResponsive(): void {
    const isMobile = window.innerWidth < 768;

    if (isMobile) {
      this._toolbar.style.flexDirection = 'column';
      this._toolbar.style.gap = '8px';
      this._toolbar.style.padding = '10px 16px';
      
      this._buildingPanel.style.width = '224px';
      this._buildingPanel.style.transform = 'scale(0.8)';
      this._buildingPanel.style.transformOrigin = 'top right';
    } else {
      this._toolbar.style.flexDirection = 'row';
      this._toolbar.style.gap = '12px';
      this._toolbar.style.padding = '12px 24px';
      
      this._buildingPanel.style.width = '280px';
      this._buildingPanel.style.transform = 'scale(1)';
    }
  }

  public updateBuildingList(): void {
    this._requestUiUpdate('buildingList');
  }

  public dispose(): void {
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
    }
    this._container.remove();
  }
}

export const controlPanel = ControlPanel.instance;
