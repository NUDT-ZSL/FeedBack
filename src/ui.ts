import { AnimalType, ANIMAL_CONFIG, PREDATION_MAP, FOOD_CHAIN_NODES, ALL_ANIMALS } from './types';
import { Ecosystem } from './ecosystem';

export class UIManager {
  private ecosystem: Ecosystem;
  private tempSlider: HTMLInputElement;
  private rainSlider: HTMLInputElement;
  private lightSlider: HTMLInputElement;
  private pollutionSlider: HTMLInputElement;
  private tempValue: HTMLElement;
  private rainValue: HTMLElement;
  private lightValue: HTMLElement;
  private pollutionValue: HTMLElement;
  private foodChainContent: HTMLElement;
  private foodChainSvg: SVGSVGElement;
  private toggleBtn: HTMLElement;
  private chartContainer: HTMLElement;
  private isExpanded: boolean = false;
  private lastSoundTime: number = 0;

  constructor(container: HTMLElement, ecosystem: Ecosystem) {
    this.ecosystem = ecosystem;

    this.tempSlider = container.querySelector('#tempSlider') as HTMLInputElement;
    this.rainSlider = container.querySelector('#rainSlider') as HTMLInputElement;
    this.lightSlider = container.querySelector('#lightSlider') as HTMLInputElement;
    this.pollutionSlider = container.querySelector('#pollutionSlider') as HTMLInputElement;

    this.tempValue = container.querySelector('#tempValue') as HTMLElement;
    this.rainValue = container.querySelector('#rainValue') as HTMLElement;
    this.lightValue = container.querySelector('#lightValue') as HTMLElement;
    this.pollutionValue = container.querySelector('#pollutionValue') as HTMLElement;

    this.foodChainContent = container.querySelector('#foodChainContent') as HTMLElement;
    this.foodChainSvg = container.querySelector('#foodChainSvg') as SVGSVGElement;
    this.toggleBtn = container.querySelector('#toggleBtn') as HTMLElement;
    this.chartContainer = container.querySelector('#chartContainer') as HTMLElement;

    this.initEventListeners();
    this.initFoodChainSvg();
    this.initChartBars();
  }

  private initEventListeners(): void {
    this.tempSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.tempValue.textContent = `${value}°C`;
      this.ecosystem.setParams({ temperature: value });
      this.playSoundWithThrottle('temperature', value);
    });

    this.rainSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.rainValue.textContent = `${value}mm`;
      this.ecosystem.setParams({ precipitation: value });
      this.playSoundWithThrottle('precipitation', value);
    });

    this.lightSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.lightValue.textContent = `${value}%`;
      this.ecosystem.setParams({ light: value });
      this.playSoundWithThrottle('light', value);
    });

    this.pollutionSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.pollutionValue.textContent = `${value}%`;
      this.ecosystem.setParams({ pollution: value });
      this.playSoundWithThrottle('pollution', value);
    });

    const foodChainHeader = document.querySelector('#foodChainHeader');
    foodChainHeader?.addEventListener('click', () => {
      this.toggleFoodChain();
    });
  }

  private playSoundWithThrottle(paramType: string, value: number): void {
    const now = Date.now();
    if (now - this.lastSoundTime > 50) {
      this.ecosystem.playParamSound(paramType, this.normalizeValue(paramType, value));
      this.lastSoundTime = now;
    }
  }

  private normalizeValue(paramType: string, value: number): number {
    switch (paramType) {
      case 'temperature':
        return ((value + 10) / 60) * 100;
      case 'precipitation':
        return (value / 500) * 100;
      case 'light':
      case 'pollution':
        return value;
      default:
        return 50;
    }
  }

  private initFoodChainSvg(): void {
    const svg = this.foodChainSvg;

    for (const [predator, preys] of Object.entries(PREDATION_MAP)) {
      const predatorNode = FOOD_CHAIN_NODES.find(n => n.type === predator);
      if (!predatorNode) continue;

      for (const prey of preys) {
        const preyNode = FOOD_CHAIN_NODES.find(n => n.type === prey);
        if (!preyNode) continue;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(predatorNode.x));
        line.setAttribute('y1', String(predatorNode.y + 15));
        line.setAttribute('x2', String(preyNode.x));
        line.setAttribute('y2', String(preyNode.y - 15));
        line.setAttribute('stroke', '#4caf50');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('marker-end', 'url(#arrowhead)');
        line.setAttribute('opacity', '0.6');
        svg.appendChild(line);
      }
    }

    for (const node of FOOD_CHAIN_NODES) {
      const config = ANIMAL_CONFIG[node.type];

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(node.x));
      circle.setAttribute('cy', String(node.y));
      circle.setAttribute('r', '14');
      circle.setAttribute('fill', config.color);
      circle.setAttribute('stroke', 'white');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(node.x));
      text.setAttribute('y', String(node.y + 32));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', 'white');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-family', '"Noto Sans SC", sans-serif');
      text.textContent = config.name;
      svg.appendChild(text);
    }
  }

  private initChartBars(): void {
    this.chartContainer.innerHTML = '';
    const maxPop = this.ecosystem.getMaxPopulation();

    for (const type of ALL_ANIMALS) {
      const config = ANIMAL_CONFIG[type];
      const count = this.ecosystem.getPopulationStats()[type] || 0;
      const heightPercent = maxPop > 0 ? (count / maxPop) * 100 : 0;

      const barWrapper = document.createElement('div');
      barWrapper.className = 'chart-bar';
      barWrapper.style.backgroundColor = config.color;
      barWrapper.style.height = `${Math.max(heightPercent, 2)}%`;
      barWrapper.dataset.type = type;

      const barValue = document.createElement('div');
      barValue.className = 'chart-bar-value';
      barValue.textContent = String(count);

      const barLabel = document.createElement('div');
      barLabel.className = 'chart-bar-label';
      barLabel.textContent = config.name;

      barWrapper.appendChild(barValue);
      barWrapper.appendChild(barLabel);
      this.chartContainer.appendChild(barWrapper);
    }
  }

  toggleFoodChain(): void {
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) {
      this.foodChainContent.classList.add('expanded');
      this.toggleBtn.classList.add('expanded');
    } else {
      this.foodChainContent.classList.remove('expanded');
      this.toggleBtn.classList.remove('expanded');
    }
  }

  updatePopulation(): void {
    const stats = this.ecosystem.getPopulationStats();
    const maxPop = this.ecosystem.getMaxPopulation();

    const bars = this.chartContainer.querySelectorAll<HTMLElement>('.chart-bar');
    bars.forEach((bar) => {
      const type = bar.dataset.type as AnimalType;
      if (!type) return;

      const count = stats[type] || 0;
      const heightPercent = maxPop > 0 ? (count / maxPop) * 100 : 0;

      bar.style.height = `${Math.max(heightPercent, 2)}%`;

      const valueEl = bar.querySelector('.chart-bar-value');
      if (valueEl) valueEl.textContent = String(count);
    });
  }

  updateFromEcosystemParams(): void {
    const params = this.ecosystem.getParams();
    this.tempSlider.value = String(params.temperature);
    this.rainSlider.value = String(params.precipitation);
    this.lightSlider.value = String(params.light);
    this.pollutionSlider.value = String(params.pollution);

    this.tempValue.textContent = `${params.temperature}°C`;
    this.rainValue.textContent = `${params.precipitation}mm`;
    this.lightValue.textContent = `${params.light}%`;
    this.pollutionValue.textContent = `${params.pollution}%`;
  }
}
