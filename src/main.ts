import { TrafficLight, LightState } from './trafficLight';
import { Intersection } from './intersection';

class App {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private trafficLight: TrafficLight;
  private intersection: Intersection;
  private lastTime: number = 0;
  private simTime: number = 0;
  private autoSpawnTimer: number = 0;
  private autoSpawnInterval: number = 2.0;

  constructor() {
    this.canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.trafficLight = new TrafficLight();
    this.intersection = new Intersection(0, 0, 80);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupControls();
    this.requestAnimationFrame();
  }

  private resize(): void {
    const container = document.getElementById('canvas-container')!;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const roadWidth = Math.min(rect.width, rect.height) * 0.12;
    (this.intersection as any).cx = cx;
    (this.intersection as any).cy = cy;
    (this.intersection as any).roadWidth = roadWidth;
    (this.intersection as any).laneWidth = roadWidth / 2;
    (this.intersection as any).stopLineOffset = roadWidth / 2 + 4;
  }

  private setupControls(): void {
    const greenSlider = document.getElementById('green-duration') as HTMLInputElement;
    const redSlider = document.getElementById('red-duration') as HTMLInputElement;
    const greenValue = document.getElementById('green-value')!;
    const redValue = document.getElementById('red-value')!;
    const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
    const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;

    greenSlider.addEventListener('input', () => {
      const val = parseInt(greenSlider.value);
      this.trafficLight.setGreenDuration(val);
      greenValue.textContent = val + 's';
    });

    redSlider.addEventListener('input', () => {
      const val = parseInt(redSlider.value);
      this.trafficLight.setRedDuration(val);
      redValue.textContent = val + 's';
    });

    btnAdd.addEventListener('click', () => {
      for (let i = 0; i < 3; i++) {
        this.intersection.addVehicle();
      }
    });

    btnReset.addEventListener('click', () => {
      this.intersection.reset();
      this.trafficLight.reset();
      this.simTime = 0;
      this.autoSpawnTimer = 0;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'a' || e.key === 'A') {
        this.intersection.addVehicle();
      }
    });
  }

  private updateSignalUI(): void {
    const status = this.trafficLight.getStatus();

    const nsRed = document.getElementById('ns-red')!;
    const nsYellow = document.getElementById('ns-yellow')!;
    const nsGreen = document.getElementById('ns-green')!;
    const ewRed = document.getElementById('ew-red')!;
    const ewYellow = document.getElementById('ew-yellow')!;
    const ewGreen = document.getElementById('ew-green')!;

    nsRed.classList.toggle('active', status.ns === LightState.Red);
    nsYellow.classList.toggle('active', status.ns === LightState.Yellow);
    nsGreen.classList.toggle('active', status.ns === LightState.Green);
    ewRed.classList.toggle('active', status.ew === LightState.Red);
    ewYellow.classList.toggle('active', status.ew === LightState.Yellow);
    ewGreen.classList.toggle('active', status.ew === LightState.Green);
  }

  private updateStatsUI(): void {
    const stats = this.intersection.getStats(this.simTime);
    document.getElementById('stat-vehicles')!.textContent = String(stats.totalVehicles);
    document.getElementById('stat-wait')!.textContent = stats.averageWaitTime.toFixed(1) + 's';
    document.getElementById('stat-passed')!.textContent = String(stats.totalPassed);
  }

  private drawBackground(): void {
    const container = document.getElementById('canvas-container')!;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.ctx.fillStyle = '#0d1117';
    this.ctx.fillRect(0, 0, w, h);

    const cx = (this.intersection as any).cx;
    const cy = (this.intersection as any).cy;

    this.drawTrafficLightOnCanvas(cx, cy);
  }

  private drawTrafficLightOnCanvas(cx: number, cy: number): void {
    const status = this.trafficLight.getStatus();
    const hw = (this.intersection as any).roadWidth / 2;
    const lightSize = 8;
    const spacing = 14;

    const drawLight = (x: number, y: number, state: LightState, isNS: boolean) => {
      const activeNS = isNS ? status.ns : status.ew;
      const colors = [
        { color: '#ff3333', glow: 'rgba(255,51,51,0.5)', state: LightState.Red },
        { color: '#ffcc00', glow: 'rgba(255,204,0,0.5)', state: LightState.Yellow },
        { color: '#33cc33', glow: 'rgba(51,204,51,0.5)', state: LightState.Green },
      ];

      const offsetX = isNS ? -lightSize - 4 : 0;
      const offsetY = isNS ? 0 : -lightSize - 4;

      for (let i = 0; i < colors.length; i++) {
        const lx = x + offsetX;
        const ly = y + offsetY + i * (spacing) - spacing;
        const isActive = activeNS === colors[i].state;

        this.ctx.save();
        if (isActive) {
          this.ctx.shadowColor = colors[i].glow;
          this.ctx.shadowBlur = 12;
        }
        this.ctx.fillStyle = isActive ? colors[i].color : '#1a1a2e';
        this.ctx.beginPath();
        this.ctx.arc(lx, ly, lightSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
      }
    };

    drawLight(cx - hw - 16, cy - hw - 12, status.ns, true);
    drawLight(cx + hw + 16, cy + hw + 12, status.ns, true);
    drawLight(cx - hw - 12, cy + hw + 16, status.ew, false);
    drawLight(cx + hw + 12, cy - hw - 16, status.ew, false);
  }

  private loop = (timestamp: number): void => {
    if (this.lastTime === 0) this.lastTime = timestamp;
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;
    this.simTime += dt;

    this.trafficLight.update(dt);

    this.autoSpawnTimer += dt;
    if (this.autoSpawnTimer >= this.autoSpawnInterval) {
      this.autoSpawnTimer -= this.autoSpawnInterval;
      this.intersection.addVehicle();
    }

    this.intersection.update(dt, this.simTime, this.trafficLight);

    this.drawBackground();
    this.intersection.draw(this.ctx);

    this.updateSignalUI();
    this.updateStatsUI();

    this.requestAnimationFrame();
  };

  private requestAnimationFrame(): void {
    requestAnimationFrame(this.loop);
  }
}

new App();
