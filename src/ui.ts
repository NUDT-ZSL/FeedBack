import * as THREE from 'three';
import type { TerrainData } from './terrain';
import { getHeightAt, calculatePathMetrics } from './terrain';

export interface UIState {
  mode: 'roam' | 'edit';
  elevation: number;
  totalDistance: number;
  avgSlope: number;
  pointCount: number;
}

export type ModeChangeCallback = (mode: 'roam' | 'edit') => void;
export type ChartHoverCallback = (pathIndex: number) => void;

export class UIManager {
  private container: HTMLElement;
  private appElement: HTMLElement;
  private state: UIState;
  private terrainData: TerrainData;
  private onModeChange: ModeChangeCallback;
  private onChartHover?: ChartHoverCallback;

  private controlPanel!: HTMLDivElement;
  private modeButton!: HTMLButtonElement;
  private modeIcon!: HTMLSpanElement;
  private elevationDisplay!: HTMLDivElement;
  private elevationValue!: HTMLSpanElement;
  private statsDisplay!: HTMLDivElement;
  private distanceValue!: HTMLSpanElement;
  private slopeValue!: HTMLSpanElement;
  private pointCountValue!: HTMLSpanElement;
  private fpsDisplay!: HTMLDivElement;
  private chartContainer!: HTMLDivElement;
  private chartCanvas!: HTMLCanvasElement;
  private chartCtx!: CanvasRenderingContext2D;
  private elevationMarker!: HTMLDivElement;
  private elevationPopup!: HTMLDivElement;

  private pathPoints: THREE.Vector3[] = [];
  private smoothedPath: THREE.Vector3[] = [];
  private chartWidth: number = 400;
  private chartHeight: number = 180;
  private padding: { top: number; right: number; bottom: number; left: number } = {
    top: 20, right: 20, bottom: 35, left: 50
  };
  private hoveredChartIndex: number = -1;

  private frameCount: number = 0;
  private lastFpsTime: number = performance.now();

  constructor(
    appElement: HTMLElement,
    terrainData: TerrainData,
    onModeChange: ModeChangeCallback,
    onChartHover?: ChartHoverCallback
  ) {
    this.appElement = appElement;
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    this.appElement.appendChild(this.container);

    this.terrainData = terrainData;
    this.onModeChange = onModeChange;
    this.onChartHover = onChartHover;
    this.state = {
      mode: 'edit',
      elevation: 0,
      totalDistance: 0,
      avgSlope: 0,
      pointCount: 0
    };

    this.createControlPanel();
    this.createFPSDisplay();
    this.createChartPanel();
    this.createElevationMarker();
    this.createCSS();
  }

  private createCSS(): void {
    const style = document.createElement('style');
    style.textContent = `
      .hike-btn {
        cursor: pointer;
        transition: all 0.2s ease;
        pointer-events: auto;
        border: none;
        outline: none;
        background: rgba(255,255,255,0.05);
        color: #fff;
      }
      .hike-btn:hover {
        transform: scale(1.1);
        background: rgba(255,255,255,0.1);
      }
      .hike-btn:active {
        transform: scale(0.95);
      }
      @keyframes floatIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.2); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  private createControlPanel(): void {
    this.controlPanel = document.createElement('div');
    this.controlPanel.style.cssText = `
      position: absolute;
      top: 20px;
      left: 20px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      pointer-events: auto;
      min-width: 220px;
      animation: floatIn 0.4s ease;
    `;
    this.container.appendChild(this.controlPanel);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:16px;color:#fff;letter-spacing:0.5px;';
    title.textContent = '徒步路线控制';
    this.controlPanel.appendChild(title);

    this.createModeButton();
    this.createElevationDisplay();
    this.createStatsDisplay();
  }

  private createModeButton(): void {
    const modeContainer = document.createElement('div');
    modeContainer.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
    this.controlPanel.appendChild(modeContainer);

    this.modeButton = document.createElement('button');
    this.modeButton.className = 'hike-btn';
    this.modeButton.style.cssText = `
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    `;

    this.modeIcon = document.createElement('span');
    this.modeIcon.style.cssText = 'transition: transform 0.3s ease;display:inline-block;';
    this.modeIcon.textContent = '✏️';
    this.modeButton.appendChild(this.modeIcon);

    this.modeButton.addEventListener('click', () => {
      const newMode = this.state.mode === 'edit' ? 'roam' : 'edit';
      this.setMode(newMode);
      this.onModeChange(newMode);
    });

    modeContainer.appendChild(this.modeButton);

    const modeLabel = document.createElement('div');
    modeLabel.style.cssText = 'display:flex;flex-direction:column;';
    const modeText = document.createElement('div');
    modeText.id = 'mode-text';
    modeText.style.cssText = 'font-size:13px;font-weight:500;color:#fff;';
    modeText.textContent = '编辑模式';
    const modeHint = document.createElement('div');
    modeHint.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;';
    modeHint.textContent = '点击切换模式';
    modeLabel.appendChild(modeText);
    modeLabel.appendChild(modeHint);
    modeContainer.appendChild(modeLabel);
  }

  private createElevationDisplay(): void {
    this.elevationDisplay = document.createElement('div');
    this.elevationDisplay.style.cssText = `
      padding: 12px 14px;
      background: rgba(0,0,0,0.2);
      border-radius: 10px;
      margin-bottom: 12px;
    `;
    this.controlPanel.appendChild(this.elevationDisplay);

    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;';
    label.textContent = '当前海拔';
    this.elevationDisplay.appendChild(label);

    const valueContainer = document.createElement('div');
    valueContainer.style.cssText = 'display:flex;align-items:baseline;gap:4px;';
    this.elevationDisplay.appendChild(valueContainer);

    this.elevationValue = document.createElement('span');
    this.elevationValue.style.cssText = `
      font-size: 24px;
      font-weight: 700;
      color: #4caf50;
      transition: all 0.2s ease;
      font-variant-numeric: tabular-nums;
    `;
    this.elevationValue.textContent = '0';

    const unit = document.createElement('span');
    unit.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.6);';
    unit.textContent = '米';

    valueContainer.appendChild(this.elevationValue);
    valueContainer.appendChild(unit);
  }

  private createStatsDisplay(): void {
    this.statsDisplay = document.createElement('div');
    this.statsDisplay.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    this.controlPanel.appendChild(this.statsDisplay);

    const distanceStat = this.createStatItem('总距离', 'distance', '米');
    const slopeStat = this.createStatItem('平均坡度', 'slope', '%');
    const pointStat = this.createStatItem('路径点', 'points', '个');

    this.statsDisplay.appendChild(distanceStat.container);
    this.statsDisplay.appendChild(slopeStat.container);
    this.statsDisplay.appendChild(pointStat.container);

    this.distanceValue = distanceStat.value;
    this.slopeValue = slopeStat.value;
    this.pointCountValue = pointStat.value;
  }

  private createStatItem(label: string, id: string, unit: string): {
    container: HTMLDivElement;
    value: HTMLSpanElement;
  } {
    const container = document.createElement('div');
    container.style.cssText = `
      padding: 10px;
      background: rgba(0,0,0,0.15);
      border-radius: 8px;
    `;

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px;';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const valContainer = document.createElement('div');
    valContainer.style.cssText = 'display:flex;align-items:baseline;gap:2px;';
    container.appendChild(valContainer);

    const valueEl = document.createElement('span');
    valueEl.style.cssText = 'font-size:16px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums;';
    valueEl.textContent = '0';
    valContainer.appendChild(valueEl);

    const unitEl = document.createElement('span');
    unitEl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);';
    unitEl.textContent = unit;
    valContainer.appendChild(unitEl);

    return { container, value: valueEl };
  }

  private createFPSDisplay(): void {
    this.fpsDisplay = document.createElement('div');
    this.fpsDisplay.style.cssText = `
      position: absolute;
      top: 12px;
      right: 16px;
      font-size: 10px;
      color: rgba(255,255,255,0.7);
      font-family: 'Courier New', monospace;
      pointer-events: none;
      font-variant-numeric: tabular-nums;
    `;
    this.fpsDisplay.textContent = 'FPS: 0';
    this.container.appendChild(this.fpsDisplay);
  }

  private createChartPanel(): void {
    this.chartContainer = document.createElement('div');
    this.chartContainer.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      pointer-events: auto;
      animation: floatIn 0.4s ease;
    `;
    this.container.appendChild(this.chartContainer);

    const chartTitle = document.createElement('div');
    chartTitle.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;color:#fff;';
    chartTitle.textContent = '坡度分析';
    this.chartContainer.appendChild(chartTitle);

    this.chartCanvas = document.createElement('canvas');
    this.chartCanvas.width = this.chartWidth;
    this.chartCanvas.height = this.chartHeight;
    this.chartCanvas.style.cssText = 'display:block;border-radius:8px;';
    this.chartContainer.appendChild(this.chartCanvas);

    const ctx = this.chartCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.chartCtx = ctx;

    this.chartCanvas.addEventListener('mousemove', this.onChartMouseMove);
    this.chartCanvas.addEventListener('mouseleave', this.onChartMouseLeave);

    this.drawEmptyChart();
  }

  private createElevationMarker(): void {
    this.elevationMarker = document.createElement('div');
    this.elevationMarker.style.cssText = `
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ff6f00;
      border: 2px solid #fff;
      pointer-events: none;
      display: none;
      z-index: 20;
      box-shadow: 0 0 10px rgba(255,111,0,0.6);
    `;
    this.appElement.appendChild(this.elevationMarker);

    this.elevationPopup = document.createElement('div');
    this.elevationPopup.style.cssText = `
      position: absolute;
      padding: 4px 8px;
      background: rgba(0,0,0,0.8);
      color: #fff;
      font-size: 11px;
      border-radius: 4px;
      pointer-events: none;
      display: none;
      z-index: 21;
      white-space: nowrap;
      transform: translate(-50%, -100%);
      margin-top: -12px;
    `;
    this.appElement.appendChild(this.elevationPopup);
  }

  public setMode(mode: 'roam' | 'edit'): void {
    this.state.mode = mode;
    this.modeIcon.style.transform = mode === 'roam' ? 'rotate(180deg)' : 'rotate(0deg)';
    this.modeIcon.textContent = mode === 'roam' ? '🚶' : '✏️';
    const modeText = document.getElementById('mode-text');
    if (modeText) {
      modeText.textContent = mode === 'roam' ? '漫游模式' : '编辑模式';
    }
  }

  public updateElevation(point: THREE.Vector3 | null): void {
    if (point) {
      const elevation = getHeightAt(point.x, point.z, this.terrainData);
      this.state.elevation = elevation;
      this.elevationValue.textContent = Math.round(elevation).toString();
    }
  }

  public updatePathData(pathPoints: THREE.Vector3[], smoothedPath: THREE.Vector3[]): void {
    this.pathPoints = pathPoints;
    this.smoothedPath = smoothedPath;
    this.state.pointCount = pathPoints.length;
    this.pointCountValue.textContent = pathPoints.length.toString();

    if (smoothedPath.length >= 2) {
      const metrics = calculatePathMetrics(smoothedPath);
      this.state.totalDistance = metrics.totalDistance;
      this.state.avgSlope = metrics.avgSlope;
      this.distanceValue.textContent = Math.round(metrics.totalDistance).toString();
      this.slopeValue.textContent = metrics.avgSlope.toFixed(1);
      this.drawSlopeChart(metrics);
    } else {
      this.distanceValue.textContent = '0';
      this.slopeValue.textContent = '0';
      this.drawEmptyChart();
    }
  }

  private onChartMouseMove = (e: MouseEvent): void => {
    if (this.smoothedPath.length < 2) return;
    const rect = this.chartCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const chartInnerWidth = this.chartWidth - this.padding.left - this.padding.right;
    const ratio = (x - this.padding.left) / chartInnerWidth;

    if (ratio >= 0 && ratio <= 1) {
      const index = Math.floor(ratio * (this.smoothedPath.length - 1));
      this.hoveredChartIndex = index;
      if (this.onChartHover) {
        this.onChartHover(index);
      }
      this.highlightChartPoint();
    }
  };

  private onChartMouseLeave = (): void => {
    this.hoveredChartIndex = -1;
    if (this.onChartHover) {
      this.onChartHover(-1);
    }
  };

  private drawEmptyChart(): void {
    const ctx = this.chartCtx;
    ctx.clearRect(0, 0, this.chartWidth, this.chartHeight);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, this.chartWidth, this.chartHeight);

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('添加路径点后显示坡度分析', this.chartWidth / 2, this.chartHeight / 2);
  }

  private drawSlopeChart(metrics: ReturnType<typeof calculatePathMetrics>): void {
    const ctx = this.chartCtx;
    const { distances, slopes, maxSlopeIndex } = metrics;

    ctx.clearRect(0, 0, this.chartWidth, this.chartHeight);

    const innerW = this.chartWidth - this.padding.left - this.padding.right;
    const innerH = this.chartHeight - this.padding.top - this.padding.bottom;

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, this.chartWidth, this.chartHeight);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = this.padding.top + (innerH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(this.padding.left, y);
      ctx.lineTo(this.chartWidth - this.padding.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = this.padding.top + (innerH / 4) * (4 - i);
      const value = (100 / 4) * i;
      ctx.fillText(value.toFixed(0) + '%', this.padding.left - 6, y);
    }

    const maxDist = distances[distances.length - 1] || 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const x = this.padding.left + (innerW / 4) * i;
      const value = (maxDist / 4) * i;
      ctx.fillText(value.toFixed(0) + 'm', x, this.chartHeight - this.padding.bottom + 6);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('距离', this.chartWidth / 2, this.chartHeight - 8);

    ctx.save();
    ctx.translate(12, this.chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('坡度 %', 0, 0);
    ctx.restore();

    ctx.beginPath();
    ctx.strokeStyle = '#ff6f00';
    ctx.lineWidth = 2;

    for (let i = 0; i < slopes.length; i++) {
      const x = this.padding.left + (distances[i] / maxDist) * innerW;
      const y = this.padding.top + innerH - (Math.min(slopes[i], 100) / 100) * innerH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.beginPath();
    const lastX = this.padding.left + innerW;
    const bottomY = this.padding.top + innerH;
    ctx.lineTo(this.padding.left, bottomY);
    for (let i = 0; i < slopes.length; i++) {
      const x = this.padding.left + (distances[i] / maxDist) * innerW;
      const y = this.padding.top + innerH - (Math.min(slopes[i], 100) / 100) * innerH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(lastX, bottomY);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, this.padding.top, 0, this.padding.top + innerH);
    gradient.addColorStop(0, 'rgba(255,111,0,0.4)');
    gradient.addColorStop(1, 'rgba(255,111,0,0.05)');
    ctx.fillStyle = gradient;
    ctx.fill();

    if (maxSlopeIndex >= 0 && maxSlopeIndex < slopes.length) {
      const mx = this.padding.left + (distances[maxSlopeIndex] / maxDist) * innerW;
      const my = this.padding.top + innerH - (Math.min(slopes[maxSlopeIndex], 100) / 100) * innerH;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3333';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    this.highlightChartPoint();
  }

  private highlightChartPoint(): void {
    if (this.hoveredChartIndex < 0 || this.smoothedPath.length < 2) return;

    const ctx = this.chartCtx;
    const metrics = calculatePathMetrics(this.smoothedPath);
    const { distances, slopes } = metrics;
    const maxDist = distances[distances.length - 1] || 1;
    const innerW = this.chartWidth - this.padding.left - this.padding.right;
    const innerH = this.chartHeight - this.padding.top - this.padding.bottom;

    const idx = Math.min(Math.max(this.hoveredChartIndex, 0), slopes.length - 1);
    const x = this.padding.left + (distances[idx] / maxDist) * innerW;
    const y = this.padding.top + innerH - (Math.min(slopes[idx], 100) / 100) * innerH;

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#ff6f00';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  public showElevationMarker(screenX: number, screenY: number, elevation: number, distance?: number, slope?: number): void {
    this.elevationMarker.style.display = 'block';
    this.elevationMarker.style.left = (screenX - 4) + 'px';
    this.elevationMarker.style.top = (screenY - 4) + 'px';

    this.elevationPopup.style.display = 'block';
    this.elevationPopup.style.left = screenX + 'px';
    this.elevationPopup.style.top = screenY + 'px';

    let html = `<div style="font-weight:600;">海拔: ${Math.round(elevation)}m</div>`;
    if (distance !== undefined) {
      html += `<div style="opacity:0.8;">距离: ${Math.round(distance)}m</div>`;
    }
    if (slope !== undefined) {
      html += `<div style="opacity:0.8;">坡度: ${slope.toFixed(1)}%</div>`;
    }
    this.elevationPopup.innerHTML = html;
  }

  public hideElevationMarker(): void {
    this.elevationMarker.style.display = 'none';
    this.elevationPopup.style.display = 'none';
  }

  public updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.fpsDisplay.textContent = `FPS: ${fps}`;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  public getScreenPosition(
    worldPosition: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number
  ): { x: number; y: number; visible: boolean } {
    const vector = worldPosition.clone().project(camera);
    return {
      x: (vector.x * 0.5 + 0.5) * width,
      y: (-vector.y * 0.5 + 0.5) * height,
      visible: vector.z < 1 && vector.z > -1
    };
  }
}
