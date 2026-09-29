import { Pet, PetType } from './pet';
import { AnimationManager } from './animation';
import { UIManager } from './ui';
import confetti from 'canvas-confetti';

type GameState = 'adopt_select' | 'adopt_name' | 'playing';

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animManager: AnimationManager;
  private uiManager: UIManager;
  private pet: Pet | null = null;
  private gameState: GameState = 'adopt_select';
  private selectedPetType: PetType | null = null;
  private petNameInput: string = '';
  private lastTime: number = 0;
  private animationId: number = 0;
  private hoveredPetCard: number = -1;
  private inputActive: boolean = false;
  private nameError: string = '';
  private toastMessage: string = '';
  private toastTimer: number = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.animManager = new AnimationManager();
    this.uiManager = new UIManager(this.canvas, this.animManager);

    this.setupEventListeners();
    this.startLoop();
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  private get logicalWidth(): number {
    const dpr = window.devicePixelRatio || 1;
    return this.canvas.width / dpr;
  }

  private get logicalHeight(): number {
    const dpr = window.devicePixelRatio || 1;
    return this.canvas.height / dpr;
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const now = performance.now();

    if (this.gameState === 'adopt_select') {
      this.handleAdoptSelectClick(mx, my);
    } else if (this.gameState === 'adopt_name') {
      this.handleAdoptNameClick(mx, my);
    } else if (this.gameState === 'playing' && this.pet) {
      const result = this.uiManager.handleClick(mx, my, now);
      if (result) {
        this.handleGameAction(result);
      }
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (this.gameState === 'adopt_select') {
      const cardWidth = 180;
      const cardHeight = 220;
      const gap = 40;
      const totalWidth = 3 * cardWidth + 2 * gap;
      const startX = (this.logicalWidth - totalWidth) / 2;
      const startY = (this.logicalHeight - cardHeight) / 2 + 20;

      this.hoveredPetCard = -1;
      for (let i = 0; i < 3; i++) {
        const cx = startX + i * (cardWidth + gap);
        const cy = startY;
        if (mx >= cx && mx <= cx + cardWidth && my >= cy && my <= cy + cardHeight) {
          this.hoveredPetCard = i;
          break;
        }
      }
    } else if (this.gameState === 'playing') {
      this.uiManager.handleHover(mx, my);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.gameState === 'adopt_name') {
      if (e.key === 'Backspace') {
        this.petNameInput = this.petNameInput.slice(0, -1);
        this.nameError = '';
      } else if (e.key === 'Enter') {
        this.confirmName();
      } else if (e.key.length === 1 && this.petNameInput.length < 10) {
        this.petNameInput += e.key;
        this.nameError = '';
      }
    }
  }

  private handleAdoptSelectClick(mx: number, my: number): void {
    const types: PetType[] = ['cat', 'dog', 'dragon'];
    const cardWidth = 180;
    const cardHeight = 220;
    const gap = 40;
    const totalWidth = 3 * cardWidth + 2 * gap;
    const startX = (this.logicalWidth - totalWidth) / 2;
    const startY = (this.logicalHeight - cardHeight) / 2 + 20;

    for (let i = 0; i < 3; i++) {
      const cx = startX + i * (cardWidth + gap);
      const cy = startY;
      if (mx >= cx && mx <= cx + cardWidth && my >= cy && my <= cy + cardHeight) {
        this.selectedPetType = types[i];
        this.gameState = 'adopt_name';
        this.petNameInput = '';
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { x: (cx + cardWidth / 2) / this.logicalWidth, y: (cy + cardHeight / 2) / this.logicalHeight },
          colors: ['#FF8C42', '#8B5A2B', '#9B59B6', '#F5A623', '#4A90D9']
        });
        break;
      }
    }
  }

  private handleAdoptNameClick(mx: number, my: number): void {
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    const inputBoxX = w / 2 - 200;
    const inputBoxY = h / 2 + 20;
    const inputBoxW = 400;
    const inputBoxH = 50;

    if (mx >= inputBoxX && mx <= inputBoxX + inputBoxW && my >= inputBoxY && my <= inputBoxY + inputBoxH) {
      this.inputActive = true;
    }

    const btnX = w / 2 - 75;
    const btnY = h / 2 + 100;
    const btnW = 150;
    const btnH = 50;
    if (mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH) {
      this.confirmName();
    }

    const backBtnX = w / 2 - 200;
    const backBtnY = h / 2 + 100;
    const backBtnW = 100;
    const backBtnH = 50;
    if (mx >= backBtnX && mx <= backBtnX + backBtnW && my >= backBtnY && my <= backBtnY + backBtnH) {
      this.gameState = 'adopt_select';
      this.selectedPetType = null;
      this.petNameInput = '';
    }
  }

  private confirmName(): void {
    const trimmed = this.petNameInput.trim();
    if (trimmed.length === 0) {
      this.nameError = '请输入宠物名字！';
      return;
    }
    if (trimmed.length > 10) {
      this.nameError = '名字不能超过10个字符！';
      return;
    }

    this.startGame(this.selectedPetType!, trimmed);
  }

  private startGame(type: PetType, name: string): void {
    this.pet = new Pet(type, name, this.animManager, this.logicalWidth, this.logicalHeight);
    this.uiManager.setPet(this.pet);
    this.gameState = 'playing';

    setTimeout(() => {
      this.showToast(`欢迎 ${name} 来到新家！`);
    }, 700);
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    this.toastTimer = 3;
  }

  private handleGameAction(result: { action: string; data?: any }): void {
    if (!this.pet) return;
    const now = performance.now();

    switch (result.action) {
      case 'feed': {
        const food = result.data?.food || '小鱼干';
        if (this.uiManager.canPerformAction('feed', now)) {
          const success = this.pet.feed(food, now);
          if (success) {
            (this.uiManager as any).buttons[0].usedToday++;
            this.showToast(`喂食了 ${food}！饱腹度+~${food === '魔法浆果' ? 15 : food === '小鱼干' ? 12 : 10}`);
            confetti({
              particleCount: 30,
              spread: 40,
              origin: { x: 0.5, y: 0.5 },
              colors: ['#FFB74D', '#FF8A65', '#FFD54F']
            });
          }
        } else {
          this.showToast('今天喂食次数已满！');
        }
        break;
      }
      case 'play': {
        if (this.pet.state.stats.energy < 10) {
          this.showToast('宠物太累了，让它休息一下吧！');
          return;
        }
        if (this.uiManager.canPerformAction('play', now)) {
          const success = this.pet.play(now);
          if (success) {
            (this.uiManager as any).buttons[1].usedToday++;
            (this.uiManager as any).buttons[1].cooldownRemaining = 2;
            this.showToast('一起玩耍！快乐度+15');
            confetti({
              particleCount: 40,
              spread: 50,
              origin: { x: 0.5, y: 0.4 },
              colors: ['#FF80AB', '#EA80FC', '#B388FF']
            });
          }
        } else {
          this.showToast('今天玩耍次数已满或冷却中！');
        }
        break;
      }
      case 'clean': {
        if (this.uiManager.canPerformAction('clean', now)) {
          const success = this.pet.clean(now);
          if (success) {
            (this.uiManager as any).buttons[2].usedToday++;
            (this.uiManager as any).buttons[2].cooldownRemaining = 5;
            this.showToast('洗得干干净净！清洁度已满');
            confetti({
              particleCount: 35,
              spread: 45,
              origin: { x: 0.5, y: 0.5 },
              colors: ['#4DD0E1', '#4FC3F7', '#81D4FA']
            });
          }
        } else {
          this.showToast('今天清洁次数已满或冷却中！');
        }
        break;
      }
      case 'sleep': {
        if (this.uiManager.canPerformAction('sleep', now)) {
          const success = this.pet.sleep(now);
          if (success) {
            this.showToast('晚安~ 进入睡眠恢复精力');
            confetti({
              particleCount: 20,
              spread: 30,
              origin: { x: 0.5, y: 0.4 },
              colors: ['#9575CD', '#7986CB', '#9FA8DA']
            });
          }
        } else {
          this.showToast('睡眠需要间隔2小时！');
        }
        break;
      }
      case 'open_feed_menu': {
        this.showToast('点击喂食按钮选择食物~');
        break;
      }
    }

    const oldLevel = this.pet.state.level;
    setTimeout(() => {
      if (this.pet && this.pet.state.level > oldLevel) {
        this.uiManager.triggerUpgradeRing();
        this.showToast(`🎉 升级了！现在是 Lv.${this.pet.state.level}`);
      }
    }, 100);
  }

  private startLoop(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt, now);
      this.draw(now);
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  private update(dt: number, now: number): void {
    this.animManager.update(dt, now);
    this.uiManager.update(dt, now);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
    }

    if (this.gameState === 'playing' && this.pet) {
      const { isNight, isEvening } = this.uiManager.getTimeOfDay();
      this.pet.update(dt, now, this.logicalWidth, this.logicalHeight, isNight, isEvening);
    }
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    ctx.clearRect(0, 0, w, h);

    if (this.gameState === 'adopt_select') {
      this.drawAdoptSelectScreen(ctx, w, h, now);
    } else if (this.gameState === 'adopt_name') {
      this.drawAdoptNameScreen(ctx, w, h, now);
    } else if (this.gameState === 'playing') {
      this.uiManager.draw(ctx, now);
      if (this.pet) {
        this.pet.draw(ctx, now);
      }
      this.animManager.draw(ctx, now);
      this.drawToast(ctx, w, h);
    }
  }

  private drawAdoptSelectScreen(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#E3F2FD');
    bgGrad.addColorStop(1, '#FFF8E1');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#4A90D9';
    ctx.font = 'bold 32px "Microsoft YaHei", "Press Start 2P", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('🐾 选择你的像素宠物', w / 2, 60);

    ctx.fillStyle = '#666666';
    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.fillText('从下方选择一只宠物来领养它吧~', w / 2, 110);

    const types: PetType[] = ['cat', 'dog', 'dragon'];
    const names: string[] = ['小橘猫', '旺财狗', '神秘龙'];
    const colors: Record<PetType, { body: string; dark: string; light: string; accent: string }> = {
      cat: { body: '#FF8C42', dark: '#E06B1F', light: '#FFAD6B', accent: '#FF6B6B' },
      dog: { body: '#8B5A2B', dark: '#6B4220', light: '#A87142', accent: '#D4A574' },
      dragon: { body: '#9B59B6', dark: '#7D3C98', light: '#BB8FCE', accent: '#00CED1' }
    };

    const cardWidth = 180;
    const cardHeight = 220;
    const gap = 40;
    const totalWidth = 3 * cardWidth + 2 * gap;
    const startX = (w - totalWidth) / 2;
    const startY = (h - cardHeight) / 2 + 20;

    for (let i = 0; i < 3; i++) {
      const cx = startX + i * (cardWidth + gap);
      const cy = startY;
      const isHovered = this.hoveredPetCard === i;
      const scale = isHovered ? 1.05 : 1.0;
      const floatY = Math.sin(now / 500 + i * 1.5) * 5;

      ctx.save();
      ctx.translate(cx + cardWidth / 2, cy + cardHeight / 2 + floatY);
      ctx.scale(scale, scale);
      ctx.translate(-cardWidth / 2, -cardHeight / 2);

      ctx.shadowColor = isHovered ? '#F5A623' : 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = isHovered ? 25 : 15;
      ctx.shadowOffsetY = isHovered ? 10 : 5;
      ctx.fillStyle = '#FFFFFF';
      this.roundRect(ctx, 0, 0, cardWidth, cardHeight, 20);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.strokeStyle = isHovered ? '#F5A623' : '#4A90D9';
      ctx.lineWidth = isHovered ? 4 : 2;
      this.roundRect(ctx, 0, 0, cardWidth, cardHeight, 20);
      ctx.stroke();

      const previewBg = ctx.createLinearGradient(0, 20, 0, 140);
      previewBg.addColorStop(0, colors[types[i]].light + '66');
      previewBg.addColorStop(1, '#FFFFFF');
      ctx.fillStyle = previewBg;
      this.roundRect(ctx, 15, 20, cardWidth - 30, 120, 12);
      ctx.fill();

      this.drawPetPreview(ctx, cardWidth / 2, 85, types[i], colors[types[i]]);

      ctx.fillStyle = '#333333';
      ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(names[i], cardWidth / 2, 155);

      ctx.fillStyle = colors[types[i]].dark;
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.fillText(`初始状态：各90%`, cardWidth / 2, 185);

      ctx.fillStyle = '#4A90D9';
      ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
      ctx.fillText(isHovered ? '✨ 点击领养 ✨' : '点击选择', cardWidth / 2, 205);

      ctx.restore();
    }

    ctx.fillStyle = '#999999';
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('每种宠物都有独特的像素形象哦~', w / 2, h - 40);
  }

  private drawPetPreview(ctx: CanvasRenderingContext2D, x: number, y: number, type: PetType, colors: { body: string; dark: string; light: string; accent: string }): void {
    const px = 8;
    const patterns: Record<PetType, number[][]> = {
      cat: [
        [0,0,1,0,0,1,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,2,1,1,2,1,1],
        [1,1,1,1,1,1,1,1],
        [1,1,3,1,1,3,1,1],
        [0,1,1,4,4,1,1,0],
        [0,0,1,1,1,1,0,0],
      ],
      dog: [
        [0,1,0,0,0,0,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1],
        [1,1,2,1,1,2,1,1],
        [1,1,1,1,1,1,1,1],
        [1,3,1,1,1,1,3,1],
        [0,1,1,4,4,1,1,0],
        [0,0,1,1,1,1,0,0],
      ],
      dragon: [
        [0,4,0,1,1,0,4,0],
        [0,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,2,1,1,2,1,1],
        [1,1,1,3,3,1,1,1],
        [1,1,1,1,1,1,1,1],
        [0,1,1,1,1,1,1,0],
        [0,0,1,1,1,1,0,0],
      ]
    };

    const pattern = patterns[type];
    const offsetX = x - 4 * px;
    const offsetY = y - 4 * px;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const v = pattern[row][col];
        if (v === 0) continue;
        let color = colors.body;
        if (v === 2) color = '#000000';
        else if (v === 3) color = colors.accent;
        else if (v === 4) color = colors.light;
        ctx.fillStyle = color;
        ctx.fillRect(offsetX + col * px, offsetY + row * px, px, px);
      }
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    const eyeY = y - 1.5 * px;
    ctx.beginPath();
    ctx.arc(x - px, eyeY, px * 0.6, Math.PI * 0.1, Math.PI * 0.9, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + px, eyeY, px * 0.6, Math.PI * 0.1, Math.PI * 0.9, true);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y + 1.5 * px, px * 0.7, 0, Math.PI);
    ctx.stroke();
  }

  private drawAdoptNameScreen(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#E3F2FD');
    bgGrad.addColorStop(1, '#FFF8E1');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#4A90D9';
    ctx.font = 'bold 28px "Microsoft YaHei", "Press Start 2P", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('💕 给你的宠物起个名字', w / 2, 60);

    const previewY = h / 2 - 100;
    const colors: Record<PetType, { body: string; dark: string; light: string; accent: string }> = {
      cat: { body: '#FF8C42', dark: '#E06B1F', light: '#FFAD6B', accent: '#FF6B6B' },
      dog: { body: '#8B5A2B', dark: '#6B4220', light: '#A87142', accent: '#D4A574' },
      dragon: { body: '#9B59B6', dark: '#7D3C98', light: '#BB8FCE', accent: '#00CED1' }
    };
    const bounce = Math.sin(now / 200) * 8;
    this.drawPetPreview(ctx, w / 2, previewY + bounce, this.selectedPetType!, colors[this.selectedPetType!]);

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 4;
    const inputBoxX = w / 2 - 200;
    const inputBoxY = h / 2 + 20;
    const inputBoxW = 400;
    const inputBoxH = 50;
    this.roundRect(ctx, inputBoxX, inputBoxY, inputBoxW, inputBoxH, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = this.nameError ? '#F44336' : (this.inputActive ? '#F5A623' : '#4A90D9');
    ctx.lineWidth = this.inputActive ? 3 : 2;
    this.roundRect(ctx, inputBoxX, inputBoxY, inputBoxW, inputBoxH, 12);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (this.petNameInput.length === 0) {
      ctx.fillStyle = '#BDBDBD';
      ctx.font = '16px "Microsoft YaHei", sans-serif';
      ctx.fillText('输入宠物名字（1-10个字符）', inputBoxX + 18, inputBoxY + inputBoxH / 2);
    } else {
      ctx.fillStyle = '#333333';
      ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
      ctx.fillText(this.petNameInput, inputBoxX + 18, inputBoxY + inputBoxH / 2);
    }

    if (this.inputActive && Math.floor(now / 500) % 2 === 0) {
      ctx.fillStyle = '#333333';
      const textWidth = ctx.measureText(this.petNameInput).width;
      ctx.fillRect(inputBoxX + 22 + textWidth, inputBoxY + 15, 2, 20);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#999999';
    ctx.font = '11px monospace';
    ctx.fillText(`${this.petNameInput.length}/10`, inputBoxX + inputBoxW - 15, inputBoxY + inputBoxH / 2);

    if (this.nameError) {
      ctx.fillStyle = '#F44336';
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.nameError, w / 2, inputBoxY + inputBoxH + 22);
    }

    const btnY = h / 2 + 100;
    const backBtnX = w / 2 - 200;
    const backBtnW = 100;
    const backBtnH = 50;
    ctx.fillStyle = '#E0E0E0';
    this.roundRect(ctx, backBtnX, btnY, backBtnW, backBtnH, 12);
    ctx.fill();
    ctx.strokeStyle = '#9E9E9E';
    ctx.lineWidth = 2;
    this.roundRect(ctx, backBtnX, btnY, backBtnW, backBtnH, 12);
    ctx.stroke();
    ctx.fillStyle = '#666666';
    ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('← 返回', backBtnX + backBtnW / 2, btnY + backBtnH / 2);

    const confirmBtnX = w / 2 + 25;
    const confirmBtnW = 175;
    const confirmBtnH = 50;
    const confirmGrad = ctx.createLinearGradient(0, btnY, 0, btnY + confirmBtnH);
    confirmGrad.addColorStop(0, '#F5A623');
    confirmGrad.addColorStop(1, '#FF8F00');
    ctx.fillStyle = confirmGrad;
    this.roundRect(ctx, confirmBtnX, btnY, confirmBtnW, confirmBtnH, 12);
    ctx.fill();
    ctx.strokeStyle = '#FF6F00';
    ctx.lineWidth = 2;
    this.roundRect(ctx, confirmBtnX, btnY, confirmBtnW, confirmBtnH, 12);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('确认领养 ✨', confirmBtnX + confirmBtnW / 2, btnY + confirmBtnH / 2);

    ctx.fillStyle = '#999999';
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('提示：按 Enter 键可快速确认', w / 2, h - 50);
  }

  private drawToast(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.toastTimer <= 0 || !this.toastMessage) return;
    const alpha = Math.min(1, this.toastTimer);
    const toastY = 100 - (1 - alpha) * 30;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    const text = this.toastMessage;
    ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
    const textWidth = ctx.measureText(text).width;
    const padding = 20;
    const toastX = w / 2 - (textWidth + padding * 2) / 2;
    const toastW = textWidth + padding * 2;
    const toastH = 44;
    this.roundRect(ctx, toastX, toastY, toastW, toastH, 12);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, toastY + toastH / 2);

    ctx.restore();
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
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    new Game();
  } catch (err) {
    console.error('Failed to start game:', err);
  }
});
