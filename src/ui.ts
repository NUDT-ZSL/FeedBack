import { Pet, PetType } from './pet';
import { AnimationManager } from './animation';

export interface UIButton {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  icon: string;
  action: 'feed' | 'play' | 'clean' | 'sleep';
  gradient: [string, string];
  hovered: boolean;
  cooldownRemaining: number;
  maxDaily: number;
  usedToday: number;
}

export interface FoodOption {
  x: number;
  y: number;
  radius: number;
  name: string;
  color: string;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export class UIManager {
  private canvas: HTMLCanvasElement;
  private buttons: UIButton[] = [];
  private foodOptions: FoodOption[] = [];
  private showFoodMenu: boolean = false;
  private foodMenuAnimId: number | null = null;
  private hoveredPanel: 'hunger' | 'happiness' | 'cleanliness' | 'energy' | null = null;
  private pulseTime: number = 0;
  private lastResetDate: string = '';
  private lastSleepTime: number = 0;
  private upgradeRingId: number | null = null;
  private pet: Pet | null = null;
  private animManager: AnimationManager;

  constructor(canvas: HTMLCanvasElement, animManager: AnimationManager) {
    this.canvas = canvas;
    this.animManager = animManager;
    this.initializeButtons();
    this.initializeFoodOptions();
  }

  setPet(pet: Pet): void {
    this.pet = pet;
  }

  private initializeButtons(): void {
    const actions: Array<{ action: UIButton['action']; label: string; icon: string; gradient: [string, string]; max: number }> = [
      { action: 'feed', label: '喂食', icon: '🍖', gradient: ['#FF9A56', '#FF6B35'], max: 5 },
      { action: 'play', label: '玩耍', icon: '🎾', gradient: ['#FF85A2', '#FF5C8A'], max: 4 },
      { action: 'clean', label: '清洁', icon: '🛁', gradient: ['#5ED5E0', '#26C6DA'], max: 3 },
      { action: 'sleep', label: '睡觉', icon: '💤', gradient: ['#9575CD', '#7E57C2'], max: 999 },
    ];
    const now = performance.now();
    this.buttons = actions.map((a, i) => ({
      x: 0, y: 0, width: 90, height: 90,
      label: a.label, icon: a.icon, action: a.action,
      gradient: a.gradient, hovered: false,
      cooldownRemaining: 0, maxDaily: a.max, usedToday: 0
    }));
  }

  private initializeFoodOptions(): void {
    const foods = [
      { name: '小鱼干', color: '#FFB74D' },
      { name: '骨头棒', color: '#D7CCC8' },
      { name: '魔法浆果', color: '#CE93D8' },
    ];
    this.foodOptions = foods.map((f, i) => ({
      x: 0, y: 0, radius: 32, name: f.name, color: f.color
    }));
  }

  private checkDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.lastResetDate = today;
      for (const btn of this.buttons) {
        btn.usedToday = 0;
      }
    }
  }

  getTimeOfDay(): { timeOfDay: TimeOfDay; displayText: string; isNight: boolean; isEvening: boolean } {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return { timeOfDay: 'morning', displayText: '☀️ 上午', isNight: false, isEvening: false };
    } else if (hour >= 12 && hour < 17) {
      return { timeOfDay: 'afternoon', displayText: '🌤️ 下午', isNight: false, isEvening: false };
    } else if (hour >= 17 && hour < 20) {
      return { timeOfDay: 'evening', displayText: '🌅 傍晚', isNight: false, isEvening: true };
    } else {
      return { timeOfDay: 'night', displayText: '🌙 夜晚', isNight: true, isEvening: true };
    }
  }

  getBackgroundColors(): { top: string; bottom: string } {
    const { timeOfDay } = this.getTimeOfDay();
    switch (timeOfDay) {
      case 'morning': return { top: '#FFF8E1', bottom: '#FFECB3' };
      case 'afternoon': return { top: '#E3F2FD', bottom: '#FFF8E1' };
      case 'evening': return { top: '#FFCCBC', bottom: '#FFE0B2' };
      case 'night': return { top: '#1A237E', bottom: '#283593' };
    }
  }

  update(dt: number, now: number): void {
    this.pulseTime += dt;
    this.checkDailyReset();

    for (const btn of this.buttons) {
      if (btn.cooldownRemaining > 0) {
        btn.cooldownRemaining = Math.max(0, btn.cooldownRemaining - dt);
      }
    }

    if (this.foodMenuAnimId !== null) {
      if (this.animManager.isAnimationFinished(this.foodMenuAnimId)) {
        if (!this.showFoodMenu) {
          this.foodMenuAnimId = null;
        }
      }
    }

    if (this.upgradeRingId !== null) {
      if (this.animManager.isAnimationFinished(this.upgradeRingId)) {
        this.upgradeRingId = null;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.pet) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    this.updateButtonPositions(w, h);
    this.updateFoodPositions(w, h);

    this.drawRoomBackground(ctx, w, h);
    this.drawFloor(ctx, w, h);
    this.drawRoomDecor(ctx, w, h);
    this.drawStatusPanel(ctx, w, h, now);
    this.drawTopBar(ctx, w, h, now);
    this.drawInteractionPanel(ctx, w, h, now);

    if (this.showFoodMenu || this.foodMenuAnimId !== null) {
      this.drawFoodMenu(ctx, w, h, now);
    }

    this.drawUsageCounters(ctx, w, h);
  }

  private updateButtonPositions(w: number, h: number): void {
    const startX = w - 440;
    const startY = h - 130;
    const gap = 110;
    this.buttons.forEach((btn, i) => {
      btn.x = startX + i * gap;
      btn.y = startY;
    });
  }

  private updateFoodPositions(w: number, h: number): void {
    const baseY = h - 250;
    const startX = w - 430;
    const gap = 100;
    this.foodOptions.forEach((f, i) => {
      f.x = startX + i * gap;
      f.y = baseY;
    });
  }

  private drawRoomBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const colors = this.getBackgroundColors();
    const { isNight } = this.getTimeOfDay();

    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    grad.addColorStop(0, colors.top);
    grad.addColorStop(1, colors.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (isNight) {
      ctx.fillStyle = '#FFFFFF';
      const starSeed = 12345;
      for (let i = 0; i < 50; i++) {
        const sx = ((i * starSeed) % w);
        const sy = ((i * starSeed * 3) % Math.floor(h * 0.5));
        const size = (i % 3) + 1;
        const twinkle = Math.sin(this.pulseTime * 2 + i) * 0.4 + 0.6;
        ctx.globalAlpha = twinkle;
        ctx.fillRect(sx, sy, size, size);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#FFF9C4';
      ctx.beginPath();
      ctx.arc(w - 120, 100, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.top;
      ctx.beginPath();
      ctx.arc(w - 108, 92, 32, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const sunX = 100;
      const sunY = 80;
      ctx.fillStyle = '#FFD54F';
      ctx.beginPath();
      ctx.arc(sunX, sunY, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF176';
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawFloor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const floorY = h * 0.75;
    const { isNight } = this.getTimeOfDay();

    const floorGrad = ctx.createLinearGradient(0, floorY, 0, h);
    if (isNight) {
      floorGrad.addColorStop(0, '#3949AB');
      floorGrad.addColorStop(1, '#283593');
    } else {
      floorGrad.addColorStop(0, '#BCAAA4');
      floorGrad.addColorStop(1, '#8D6E63');
    }
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, floorY, w, h - floorY);

    ctx.strokeStyle = isNight ? '#1A237E' : '#6D4C41';
    ctx.lineWidth = 1;
    const tileWidth = 60;
    for (let x = 0; x < w; x += tileWidth) {
      ctx.beginPath();
      ctx.moveTo(x, floorY);
      ctx.lineTo(x - 30, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(w, floorY);
    ctx.stroke();
  }

  private drawRoomDecor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const { isNight } = this.getTimeOfDay();
    const windowX = w * 0.28;
    const windowY = h * 0.18;
    const windowW = 140;
    const windowH = 110;

    ctx.fillStyle = isNight ? '#0D1442' : '#B3E5FC';
    this.roundRect(ctx, windowX, windowY, windowW, windowH, 8);
    ctx.fill();

    ctx.strokeStyle = '#795548';
    ctx.lineWidth = 5;
    this.roundRect(ctx, windowX, windowY, windowW, windowH, 8);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(windowX + windowW / 2, windowY);
    ctx.lineTo(windowX + windowW / 2, windowY + windowH);
    ctx.moveTo(windowX, windowY + windowH / 2);
    ctx.lineTo(windowX + windowW, windowY + windowH / 2);
    ctx.stroke();

    const pictureX = w * 0.72;
    const pictureY = h * 0.2;
    const pictureW = 100;
    const pictureH = 80;

    ctx.fillStyle = '#FFCC80';
    this.roundRect(ctx, pictureX, pictureY, pictureW, pictureH, 4);
    ctx.fill();

    ctx.fillStyle = '#81C784';
    ctx.fillRect(pictureX + 10, pictureY + 40, 80, 30);
    ctx.fillStyle = '#64B5F6';
    ctx.fillRect(pictureX + 10, pictureY + 10, 80, 30);
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(pictureX + 75, pictureY + 25, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#5D4037';
    ctx.lineWidth = 4;
    this.roundRect(ctx, pictureX, pictureY, pictureW, pictureH, 4);
    ctx.stroke();

    const rugY = h * 0.78;
    ctx.fillStyle = isNight ? '#5C6BC0' : '#EF5350';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, rugY, 180, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isNight ? '#3F51B5' : '#E53935';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, rugY, 150, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isNight ? '#7986CB' : '#FFCDD2';
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(w * 0.5 + i * 30 - 5, rugY - 3, 10, 6);
    }
  }

  private drawStatusPanel(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    if (!this.pet) return;
    const stats = this.pet.state.stats;
    const cap = this.pet.state.statCap;

    const panelX = 110;
    const panelY = h * 0.5;
    const panelR = 85;

    if (this.upgradeRingId !== null) {
      const p = this.animManager.getAnimationProgress(this.upgradeRingId, now);
      const ringR = panelR + 25 + Math.sin(p * Math.PI * 4) * 5;
      const hue = (p * 360) % 360;
      ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${1 - p * 0.5})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(panelX, panelY, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(panelX, panelY, panelR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#4A90D9';
    ctx.lineWidth = 4;
    ctx.stroke();

    const arcs: Array<{ key: keyof typeof stats; startAngle: number; endAngle: number; colors: [string, string]; label: string }> = [
      { key: 'hunger', startAngle: -Math.PI / 2 - Math.PI / 4, endAngle: -Math.PI / 2 + Math.PI / 4, colors: ['#FFB74D', '#FF6F00'], label: '饱' },
      { key: 'happiness', startAngle: Math.PI / 4, endAngle: 3 * Math.PI / 4, colors: ['#FF80AB', '#C51162'], label: '乐' },
      { key: 'cleanliness', startAngle: 3 * Math.PI / 4, endAngle: 5 * Math.PI / 4, colors: ['#4DD0E1', '#00838F'], label: '净' },
      { key: 'energy', startAngle: -3 * Math.PI / 4, endAngle: -Math.PI / 4, colors: ['#9575CD', '#4527A0'], label: '力' },
    ];

    for (const arc of arcs) {
      const value = stats[arc.key] / cap;
      const isLow = value < 0.3;
      const pulse = isLow ? (Math.sin(this.pulseTime * 10) * 0.1 + 1) : 1;

      const bgGradient = ctx.createLinearGradient(0, 0, panelR * 2, panelR * 2);
      bgGradient.addColorStop(0, '#E0E0E0');
      bgGradient.addColorStop(1, '#BDBDBD');
      ctx.strokeStyle = bgGradient;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(panelX, panelY, panelR - 18, arc.startAngle, arc.endAngle);
      ctx.stroke();

      const angleRange = arc.endAngle - arc.startAngle;
      const filledAngle = arc.startAngle + angleRange * value;
      if (value > 0.01) {
        const gradient = ctx.createLinearGradient(0, 0, panelR * 2, panelR * 2);
        gradient.addColorStop(0, arc.colors[0]);
        gradient.addColorStop(1, arc.colors[1]);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = (isLow && this.pulseTime % 0.6 < 0.3) ? 15 * pulse : 12;
        ctx.beginPath();
        ctx.arc(panelX, panelY, panelR - 18, arc.startAngle, filledAngle);
        ctx.stroke();
      }

      const iconAngle = arc.startAngle + angleRange / 2;
      const iconRadius = panelR - 3;
      const ix = panelX + Math.cos(iconAngle) * iconRadius;
      const iy = panelY + Math.sin(iconAngle) * iconRadius;

      const iconShake = isLow ? Math.sin(this.pulseTime * 20) * 3 : 0;

      ctx.fillStyle = isLow ? '#9E9E9E' : arc.colors[1];
      ctx.beginPath();
      ctx.arc(ix + iconShake, iy, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isLow ? '#616161' : arc.colors[0];
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arc.label, ix + iconShake, iy);

      const pct = Math.round(value * 100);
      ctx.fillStyle = isLow ? '#F44336' : '#333333';
      ctx.font = 'bold 9px monospace';
      const midAngle = arc.startAngle + angleRange / 2;
      const midR = panelR - 40;
      const mx = panelX + Math.cos(midAngle) * midR;
      const my = panelY + Math.sin(midAngle) * midR;
      ctx.fillText(`${pct}%`, mx, my);
    }

    ctx.fillStyle = '#F5A623';
    ctx.beginPath();
    ctx.arc(panelX, panelY, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('状态', panelX, panelY - 5);
    ctx.fillStyle = '#4A90D9';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`Lv.${this.pet.state.level}`, panelX, panelY + 10);
  }

  private drawTopBar(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    if (!this.pet) return;
    const { isNight, displayText } = this.getTimeOfDay();

    const barY = 20;
    const barHeight = 55;
    const barPadding = 20;

    ctx.fillStyle = isNight ? 'rgba(26, 35, 126, 0.85)' : 'rgba(255, 255, 255, 0.9)';
    this.roundRect(ctx, barPadding, barY, 300, barHeight, 12);
    ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    this.roundRect(ctx, barPadding, barY, 300, barHeight, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = '#4A90D9';
    ctx.lineWidth = 2;
    this.roundRect(ctx, barPadding, barY, 300, barHeight, 12);
    ctx.stroke();

    ctx.fillStyle = isNight ? '#FFFFFF' : '#333333';
    ctx.font = 'bold 14px "Microsoft YaHei", "Press Start 2P", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`🏷️ ${this.pet.state.name}`, barPadding + 15, barY + 12);

    const expNeeded = this.pet.state.level * 500;
    const expPct = this.pet.state.exp / expNeeded;
    ctx.fillStyle = isNight ? '#5C6BC0' : '#E0E0E0';
    this.roundRect(ctx, barPadding + 15, barY + 35, 200, 10, 5);
    ctx.fill();
    const expGrad = ctx.createLinearGradient(0, 0, 200, 0);
    expGrad.addColorStop(0, '#F5A623');
    expGrad.addColorStop(1, '#FFD54F');
    ctx.fillStyle = expGrad;
    this.roundRect(ctx, barPadding + 15, barY + 35, 200 * expPct, 10, 5);
    ctx.fill();

    ctx.fillStyle = isNight ? '#BDBDBD' : '#666666';
    ctx.font = '10px monospace';
    ctx.fillText(`${this.pet.state.exp}/${expNeeded} EXP`, barPadding + 225, barY + 35);

    ctx.fillStyle = isNight ? 'rgba(26, 35, 126, 0.85)' : 'rgba(255, 255, 255, 0.9)';
    this.roundRect(ctx, w / 2 - 80, barY, 160, barHeight, 12);
    ctx.fill();
    ctx.strokeStyle = '#4A90D9';
    ctx.lineWidth = 2;
    this.roundRect(ctx, w / 2 - 80, barY, 160, barHeight, 12);
    ctx.stroke();

    ctx.fillStyle = isNight ? '#FFFFFF' : '#333333';
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, w / 2, barY + barHeight / 2);

    const currentTime = new Date();
    const timeStr = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
    ctx.fillStyle = isNight ? '#BDBDBD' : '#666666';
    ctx.font = '11px monospace';
    ctx.fillText(timeStr, w / 2, barY + barHeight - 10);
  }

  private drawInteractionPanel(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    const panelX = this.buttons[0].x - 20;
    const panelY = this.buttons[0].y - 20;
    const panelW = 4 * 110 + 30;
    const panelH = 130;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 16);
    ctx.fill();

    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = '#F5A623';
    ctx.lineWidth = 2;
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 16);
    ctx.stroke();

    for (const btn of this.buttons) {
      this.drawButton(ctx, btn, now);
    }
  }

  private drawButton(ctx: CanvasRenderingContext2D, btn: UIButton, now: number): void {
    const scale = btn.hovered ? 1.1 : 1.0;
    const cx = btn.x + btn.width / 2;
    const cy = btn.y + btn.height / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    const shadowBlur = btn.hovered ? 20 : 10;
    const shadowOffset = btn.hovered ? 8 : 4;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetY = shadowOffset;

    const grad = ctx.createLinearGradient(btn.x, btn.y, btn.x, btn.y + btn.height);
    grad.addColorStop(0, btn.gradient[0]);
    grad.addColorStop(1, btn.gradient[1]);
    ctx.fillStyle = grad;
    this.roundRect(ctx, btn.x, btn.y, btn.width, btn.height, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, btn.x, btn.y, btn.width, btn.height, 16);
    ctx.stroke();

    if (btn.cooldownRemaining > 0 || (btn.action !== 'sleep' && btn.usedToday >= btn.maxDaily)) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      this.roundRect(ctx, btn.x, btn.y, btn.width, btn.height, 16);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (btn.cooldownRemaining > 0) {
        ctx.fillText(`${Math.ceil(btn.cooldownRemaining)}s`, cx, cy);
      } else {
        ctx.fillText('已满', cx, cy);
      }
    }

    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(btn.icon, cx, cy - 12);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.fillText(btn.label, cx, cy + 25);

    ctx.restore();
  }

  private drawFoodMenu(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    let progress = 1;
    if (this.foodMenuAnimId !== null) {
      progress = this.animManager.getAnimationProgress(this.foodMenuAnimId, now);
      if (!this.showFoodMenu) progress = 1 - progress;
    }

    ctx.save();
    ctx.globalAlpha = progress;

    const menuX = this.foodOptions[0].x - 30;
    const menuY = this.foodOptions[0].y - 50;
    const menuW = 3 * 100 + 20;
    const menuH = 100;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    this.roundRect(ctx, menuX, menuY, menuW, menuH, 16);
    ctx.fill();
    ctx.strokeStyle = '#F5A623';
    ctx.lineWidth = 3;
    this.roundRect(ctx, menuX, menuY, menuW, menuH, 16);
    ctx.stroke();

    ctx.fillStyle = '#333333';
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('选择食物', menuX + menuW / 2, menuY + 18);

    for (const food of this.foodOptions) {
      this.drawFoodOption(ctx, food, progress);
    }

    ctx.restore();
  }

  private drawFoodOption(ctx: CanvasRenderingContext2D, food: FoodOption, scale: number): void {
    ctx.save();
    ctx.translate(food.x, food.y);
    ctx.scale(scale, scale);

    ctx.fillStyle = food.color;
    ctx.beginPath();
    ctx.arc(0, 0, food.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (food.name === '小鱼干') ctx.fillText('🐟', 0, -5);
    else if (food.name === '骨头棒') ctx.fillText('🦴', 0, -5);
    else ctx.fillText('🫐', 0, -5);

    ctx.fillStyle = '#333333';
    ctx.font = 'bold 10px "Microsoft YaHei", sans-serif';
    ctx.fillText(food.name, 0, 28);

    ctx.restore();
  }

  private drawUsageCounters(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    let y = h - 165;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    this.roundRect(ctx, w - 440, y, 430, 22, 8);
    ctx.fill();

    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const labels: Array<[string, number, number, string]> = [
      ['喂食', this.buttons[0].usedToday, this.buttons[0].maxDaily, '#FF6F00'],
      ['玩耍', this.buttons[1].usedToday, this.buttons[1].maxDaily, '#C51162'],
      ['清洁', this.buttons[2].usedToday, this.buttons[2].maxDaily, '#00838F'],
    ];
    let x = w - 430;
    for (const [label, used, max, color] of labels) {
      ctx.fillStyle = color;
      ctx.fillText(`${label}: ${used}/${max === 999 ? '∞' : max}`, x, y + 11);
      x += 100;
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  handleClick(mx: number, my: number, now: number): { action: string; data?: any } | null {
    for (const food of this.foodOptions) {
      if (this.showFoodMenu) {
        const dx = mx - food.x;
        const dy = my - food.y;
        if (dx * dx + dy * dy <= food.radius * food.radius) {
          this.showFoodMenu = false;
          this.foodMenuAnimId = this.animManager.addAnimation('eat', 200);
          return { action: 'feed', data: { food: food.name } };
        }
      }
    }

    for (const btn of this.buttons) {
      if (mx >= btn.x && mx <= btn.x + btn.width && my >= btn.y && my <= btn.y + btn.height) {
        if (btn.cooldownRemaining > 0) return null;
        if (btn.action !== 'sleep' && btn.usedToday >= btn.maxDaily) return null;

        if (btn.action === 'feed') {
          this.showFoodMenu = !this.showFoodMenu;
          this.foodMenuAnimId = this.animManager.addAnimation('eat', 200);
          return null;
        } else if (btn.action === 'sleep') {
          const elapsed = (now - this.lastSleepTime) / 1000 / 60 / 60;
          if (this.lastSleepTime > 0 && elapsed < 2) {
            btn.cooldownRemaining = (2 - elapsed) * 60 * 60;
            return null;
          }
          this.lastSleepTime = now;
          return { action: 'sleep' };
        } else {
          btn.usedToday++;
          if (btn.action === 'play') btn.cooldownRemaining = 2;
          else if (btn.action === 'clean') btn.cooldownRemaining = 5;
          return { action: btn.action };
        }
      }
    }

    const panelX = 110;
    const panelY = (this.canvas?.height || 600) * 0.5;
    const panelR = 85;
    const ddx = mx - panelX;
    const ddy = my - panelY;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dist <= panelR) {
      const angle = Math.atan2(ddy, ddx);
      const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
      if (normalized >= Math.PI * 0.375 && normalized < Math.PI * 0.625) {
        return { action: 'open_feed_menu' };
      } else if (normalized >= Math.PI * 0.875 || normalized < Math.PI * 0.125) {
        return { action: 'play' };
      } else if (normalized >= Math.PI * 0.125 && normalized < Math.PI * 0.375) {
        return { action: 'clean' };
      } else if (normalized >= Math.PI * 0.625 && normalized < Math.PI * 0.875) {
        return { action: 'sleep' };
      }
    }

    return null;
  }

  handleHover(mx: number, my: number): void {
    for (const btn of this.buttons) {
      btn.hovered = mx >= btn.x && mx <= btn.x + btn.width && my >= btn.y && my <= btn.y + btn.height;
    }
  }

  triggerUpgradeRing(): void {
    this.upgradeRingId = this.animManager.addAnimation('upgrade-ring', 2000);
  }

  canPerformAction(action: string, now: number): boolean {
    const btn = this.buttons.find(b => b.action === action);
    if (!btn) return false;
    if (btn.cooldownRemaining > 0) return false;
    if (btn.action !== 'sleep' && btn.usedToday >= btn.maxDaily) return false;
    return true;
  }
}
