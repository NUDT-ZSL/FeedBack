import { KLineData, generateKLineData, getStockConfig, computeStatistics, getTooltipData } from './dataHandler';
import { SceneManager } from './sceneManager';

export class UIController {
  private sceneManager: SceneManager;
  private currentStockIndex = 0;
  private currentData: KLineData[] = [];
  private tooltipEl: HTMLElement;
  private stockBtns: NodeListOf<HTMLElement>;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.tooltipEl = document.getElementById('tooltip')!;
    this.stockBtns = document.querySelectorAll('.stock-btn');

    this.setupStockSwitcher();
    this.setupBarCallbacks();
  }

  private setupStockSwitcher() {
    this.stockBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stock!);
        if (idx === this.currentStockIndex) return;
        this.switchStock(idx);
      });
    });
  }

  private setupBarCallbacks() {
    this.sceneManager.setBarHoverCallback((data, screenX, screenY) => {
      if (data) {
        this.showTooltip(data, screenX, screenY);
      } else {
        this.hideTooltip();
      }
    });

    this.sceneManager.setBarClickCallback((data) => {
      if (data) {
        this.showDetailCard(data);
      } else {
        this.hideDetailCard();
      }
    });
  }

  private switchStock(index: number) {
    this.currentStockIndex = index;

    this.stockBtns.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.stock!) === index);
    });

    const newData = generateKLineData(index, 30);
    this.currentData = newData;

    this.sceneManager.transitionToNewData(newData);

    setTimeout(() => {
      this.updateOverviewPanel();
      this.updateVolumeChart();
    }, 500);
  }

  private showTooltip(data: KLineData, x: number, y: number) {
    const info = getTooltipData(data);
    const isUp = data.changePercent >= 0;
    const cls = isUp ? 'up' : 'down';

    document.getElementById('tt-date')!.textContent = info.date;
    document.getElementById('tt-open')!.textContent = info.open;
    document.getElementById('tt-open')!.className = 'tt-value';
    document.getElementById('tt-close')!.textContent = info.close;
    document.getElementById('tt-close')!.className = `tt-value ${cls}`;
    document.getElementById('tt-high')!.textContent = info.high;
    document.getElementById('tt-high')!.className = 'tt-value';
    document.getElementById('tt-low')!.textContent = info.low;
    document.getElementById('tt-low')!.className = 'tt-value';
    document.getElementById('tt-change')!.textContent = info.changePercent;
    document.getElementById('tt-change')!.className = `tt-value ${cls}`;

    const padding = 16;
    const tw = this.tooltipEl.offsetWidth;
    const th = this.tooltipEl.offsetHeight;
    let left = x + padding;
    let top = y - th / 2;

    if (left + tw > window.innerWidth) left = x - tw - padding;
    if (top < 0) top = padding;
    if (top + th > window.innerHeight) top = window.innerHeight - th - padding;

    this.tooltipEl.style.left = left + 'px';
    this.tooltipEl.style.top = top + 'px';
    this.tooltipEl.classList.add('visible');
  }

  private hideTooltip() {
    this.tooltipEl.classList.remove('visible');
  }

  private showDetailCard(data: KLineData) {
    const card = document.getElementById('detail-card')!;
    card.style.display = 'block';

    const isUp = data.changePercent >= 0;
    const cls = isUp ? 'up' : 'down';

    document.getElementById('detail-date')!.textContent = data.date;
    document.getElementById('detail-open')!.textContent = data.open.toFixed(2);
    document.getElementById('detail-close')!.textContent = data.close.toFixed(2);
    document.getElementById('detail-close')!.className = `stat-value ${cls}`;
    document.getElementById('detail-high')!.textContent = data.high.toFixed(2);
    document.getElementById('detail-low')!.textContent = data.low.toFixed(2);
    document.getElementById('detail-change')!.textContent = data.changePercent.toFixed(2) + '%';
    document.getElementById('detail-change')!.className = `stat-value ${cls}`;
    document.getElementById('detail-volume')!.textContent = this.formatVolume(data.volume);

    const badge = document.getElementById('detail-badge')!;
    badge.textContent = isUp ? '涨' : '跌';
    badge.className = `card-badge ${cls}`;
  }

  private hideDetailCard() {
    document.getElementById('detail-card')!.style.display = 'none';
  }

  private updateOverviewPanel() {
    const stats = computeStatistics(this.currentData);
    if (!stats) return;

    const config = getStockConfig(this.currentStockIndex);
    const isUp = stats.changePercent >= 0;
    const cls = isUp ? 'up' : 'down';

    document.getElementById('stat-stock')!.textContent = config.name;
    document.getElementById('stat-close')!.textContent = stats.latestClose.toFixed(2);
    document.getElementById('stat-close')!.className = `stat-value ${cls}`;
    document.getElementById('stat-change')!.textContent = stats.changePercent.toFixed(2) + '%';
    document.getElementById('stat-change')!.className = `stat-value ${cls}`;
    document.getElementById('stat-high')!.textContent = stats.highest.toFixed(2);
    document.getElementById('stat-low')!.textContent = stats.lowest.toFixed(2);

    const badge = document.getElementById('overview-badge')!;
    badge.textContent = isUp ? '涨' : '跌';
    badge.className = `card-badge ${cls}`;
  }

  private updateVolumeChart() {
    const container = document.getElementById('volume-chart')!;
    container.innerHTML = '';

    const stats = computeStatistics(this.currentData);
    if (!stats) return;

    const maxVol = Math.max(...stats.volumes);
    stats.volumes.forEach(vol => {
      const bar = document.createElement('div');
      bar.className = 'volume-bar';
      bar.style.height = Math.max((vol / maxVol) * 55 + 5, 3) + 'px';
      container.appendChild(bar);
    });
  }

  private formatVolume(v: number): string {
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
    return v.toString();
  }

  initialize(stockIndex: number) {
    this.currentStockIndex = stockIndex;
    this.currentData = generateKLineData(stockIndex, 30);
    this.sceneManager.loadKLineData(this.currentData);
    this.updateOverviewPanel();
    this.updateVolumeChart();
  }

  getCurrentData(): KLineData[] {
    return this.currentData;
  }
}
