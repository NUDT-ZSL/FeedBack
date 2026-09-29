import { AnimationManager } from './animation';

export type PetType = 'cat' | 'dog' | 'dragon';
export type PetAction = 'idle' | 'walking' | 'spinning' | 'jumping' | 'sleeping' | 'sad' | 'eating' | 'playing';
export type ExpressionType = 'normal' | 'happy' | 'hungry' | 'sleepy' | 'sad' | 'asleep' | 'playing';

export interface PetStats {
  hunger: number;
  happiness: number;
  cleanliness: number;
  energy: number;
}

export interface PetState {
  type: PetType;
  name: string;
  level: number;
  exp: number;
  stats: PetStats;
  statCap: number;
  action: PetAction;
  expression: ExpressionType;
  x: number;
  y: number;
  targetX: number;
  facing: 1 | -1;
  bounceInId: number;
  isEntering: boolean;
  lastActionTime: number;
  eatAnimationId: number | null;
  playAnimationId: number | null;
  foodIcon: string | null;
  autoSleepTimer: number;
  autoSleepStarted: boolean;
  sleepRecoverTimer: number;
}

const PET_COLORS: Record<PetType, { body: string; dark: string; light: string; accent: string }> = {
  cat: { body: '#FF8C42', dark: '#E06B1F', light: '#FFAD6B', accent: '#FF6B6B' },
  dog: { body: '#8B5A2B', dark: '#6B4220', light: '#A87142', accent: '#D4A574' },
  dragon: { body: '#9B59B6', dark: '#7D3C98', light: '#BB8FCE', accent: '#00CED1' }
};

export class Pet {
  state: PetState;
  private walkTimer: number = 0;
  private idleTimer: number = 0;
  private spinTimer: number = 0;
  private tearTimer: number = 0;
  private flowerTimer: number = 0;
  private animManager: AnimationManager;
  private yawnTimer: number = 0;
  private breathePhase: number = 0;

  constructor(type: PetType, name: string, animManager: AnimationManager, canvasWidth: number, canvasHeight: number) {
    this.animManager = animManager;
    const enterId = animManager.addAnimation('bounce-in', 600);
    this.state = {
      type,
      name,
      level: 1,
      exp: 0,
      stats: { hunger: 90, happiness: 90, cleanliness: 90, energy: 90 },
      statCap: 100,
      action: 'idle',
      expression: 'normal',
      x: -100,
      y: canvasHeight * 0.62,
      targetX: canvasWidth * 0.5,
      facing: 1,
      bounceInId: enterId,
      isEntering: true,
      lastActionTime: performance.now(),
      eatAnimationId: null,
      playAnimationId: null,
      foodIcon: null,
      autoSleepTimer: 0,
      autoSleepStarted: false,
      sleepRecoverTimer: 0
    };
  }

  update(dt: number, now: number, canvasWidth: number, canvasHeight: number, isNight: boolean, isEvening: boolean): void {
    this.breathePhase += dt * Math.PI * 2 * (this.state.action === 'sleeping' || this.state.expression === 'asleep' ? 1 : 2);

    if (this.state.isEntering) {
      const progress = this.animManager.getAnimationProgress(this.state.bounceInId, now);
      const bounced = this.animManager.getBounceOut(progress);
      const startX = -150;
      const endX = canvasWidth * 0.5;
      this.state.x = startX + (endX - startX) * bounced;
      const jumpHeight = Math.sin(progress * Math.PI * 3) * 40 * (1 - progress);
      this.state.y = canvasHeight * 0.62 - jumpHeight;
      if (progress >= 1) {
        this.state.isEntering = false;
        this.state.x = endX;
        this.state.y = canvasHeight * 0.62;
      }
      this.updateExpression(isNight, isEvening);
      return;
    }

    if (this.state.eatAnimationId !== null) {
      const p = this.animManager.getAnimationProgress(this.state.eatAnimationId, now);
      if (p >= 1) {
        this.state.eatAnimationId = null;
        this.state.foodIcon = null;
        this.state.action = 'idle';
      }
    }
    if (this.state.playAnimationId !== null) {
      const p = this.animManager.getAnimationProgress(this.state.playAnimationId, now);
      if (p >= 1) {
        this.state.playAnimationId = null;
        this.state.action = 'idle';
      }
    }

    this.updateStatsDecay(dt, isNight);
    this.checkAutoSleep(dt, now, isNight);
    this.updateAction(dt, now, canvasWidth, canvasHeight);
    this.updateExpression(isNight, isEvening);

    if (this.areAllStatsAbove(70)) {
      this.flowerTimer += dt;
      if (this.flowerTimer >= 2.5 && this.state.action === 'idle') {
        this.flowerTimer = 0;
        this.triggerHappinessBurst();
      }
    }

    if (this.anyStatBelow(20)) {
      this.tearTimer += dt;
      if (this.tearTimer >= 1.5) {
        this.tearTimer = 0;
        this.animManager.spawnTears(this.state.x, this.state.y - 28);
      }
    }
  }

  private updateStatsDecay(dt: number, isNight: boolean): void {
    const nightMultiplier = isNight ? 0.4 : 1.0;
    const dayMultiplier = !isNight ? 1.2 : 1.0;
    const multiplier = isNight ? nightMultiplier : dayMultiplier;

    this.state.stats.hunger = Math.max(0, this.state.stats.hunger - 0.8 * dt * multiplier);
    this.state.stats.happiness = Math.max(0, this.state.stats.happiness - 0.6 * dt * dayMultiplier);
    this.state.stats.cleanliness = Math.max(0, this.state.stats.cleanliness - 0.5 * dt);
    this.state.stats.energy = Math.max(0, this.state.stats.energy - (isNight ? 0.15 : 0.9) * dt);
  }

  private checkAutoSleep(dt: number, now: number, isNight: boolean): void {
    if (isNight && this.state.expression !== 'asleep' && this.state.action !== 'sleeping') {
      this.state.autoSleepTimer += dt;
      if (this.state.autoSleepTimer >= 10) {
        this.state.autoSleepStarted = true;
        this.state.action = 'sleeping';
        this.state.expression = 'asleep';
        this.state.sleepRecoverTimer = 0;
      }
    } else if (!isNight) {
      this.state.autoSleepTimer = 0;
      if (this.state.autoSleepStarted) {
        this.state.autoSleepStarted = false;
        this.state.action = 'idle';
      }
    }

    if (this.state.autoSleepStarted || this.state.action === 'sleeping') {
      this.state.sleepRecoverTimer += dt;
      const recoverAmount = (dt * 100) / 300;
      this.state.stats.energy = Math.min(this.state.statCap, this.state.stats.energy + recoverAmount);
      if (this.state.stats.energy >= this.state.statCap * 0.6 && !isNight) {
        this.state.autoSleepStarted = false;
        this.state.action = 'idle';
      }
    }
  }

  private updateAction(dt: number, now: number, canvasWidth: number, canvasHeight: number): void {
    if (this.state.eatAnimationId !== null || this.state.playAnimationId !== null) return;
    if (this.state.autoSleepStarted || this.state.action === 'sleeping' || this.anyStatBelow(20)) {
      if (this.anyStatBelow(20) && !this.state.autoSleepStarted) {
        this.state.action = 'sad';
      }
      return;
    }

    const minX = canvasWidth * 0.3;
    const maxX = canvasWidth * 0.7;
    const groundY = canvasHeight * 0.62;

    if (this.state.action === 'walking') {
      this.walkTimer += dt;
      const moveSpeed = 50;
      const dx = this.state.targetX - this.state.x;
      if (Math.abs(dx) < 2) {
        this.state.x = this.state.targetX;
        this.state.action = 'idle';
        this.idleTimer = 0;
      } else {
        this.state.facing = dx > 0 ? 1 : -1;
        this.state.x += Math.sign(dx) * moveSpeed * dt;
        this.state.y = groundY - Math.abs(Math.sin(this.walkTimer * 8)) * 5;
      }
    } else if (this.state.action === 'spinning') {
      this.spinTimer += dt;
      if (this.spinTimer >= 0.8) {
        this.state.action = 'idle';
        this.spinTimer = 0;
      }
    } else if (this.state.action === 'jumping') {
      this.spinTimer += dt;
      const t = this.spinTimer / 0.6;
      if (t >= 1) {
        this.state.action = 'idle';
        this.spinTimer = 0;
        this.state.y = groundY;
      } else {
        this.state.y = groundY - Math.sin(t * Math.PI) * 80;
      }
    } else {
      this.idleTimer += dt;
      if (this.idleTimer >= 2 + Math.random() * 3) {
        this.idleTimer = 0;
        const r = Math.random();
        if (r < 0.5) {
          this.state.action = 'walking';
          this.state.targetX = minX + Math.random() * (maxX - minX);
        } else if (r < 0.75) {
          this.state.action = 'spinning';
          this.spinTimer = 0;
        }
      }
    }
  }

  private updateExpression(isNight: boolean, isEvening: boolean): void {
    if (this.state.autoSleepStarted || this.state.action === 'sleeping') {
      this.state.expression = 'asleep';
      return;
    }

    if (this.state.playAnimationId !== null) {
      this.state.expression = 'playing';
      return;
    }

    if (this.anyStatBelow(20)) {
      this.state.expression = 'sad';
      return;
    }

    if (this.state.stats.hunger < 30) {
      this.state.expression = 'hungry';
      return;
    }

    if (isEvening && !isNight && this.state.stats.energy < 60) {
      this.yawnTimer += 0.016;
      this.state.expression = 'sleepy';
      return;
    }

    if (this.areAllStatsAbove(70)) {
      this.state.expression = 'happy';
      return;
    }

    this.state.expression = 'normal';
  }

  areAllStatsAbove(threshold: number): boolean {
    return this.state.stats.hunger >= threshold &&
           this.state.stats.happiness >= threshold &&
           this.state.stats.cleanliness >= threshold &&
           this.state.stats.energy >= threshold;
  }

  anyStatBelow(threshold: number): boolean {
    return this.state.stats.hunger < threshold ||
           this.state.stats.happiness < threshold ||
           this.state.stats.cleanliness < threshold ||
           this.state.stats.energy < threshold;
  }

  private triggerHappinessBurst(): void {
    this.state.action = 'jumping';
    this.spinTimer = 0;
    setTimeout(() => {
      this.animManager.spawnFlowerBurst(this.state.x, this.state.y - 40, 25);
    }, 150);
  }

  feed(foodType: string, now: number): boolean {
    if (this.state.eatAnimationId !== null) return false;
    const amounts: Record<string, number> = { '小鱼干': 12, '骨头棒': 10, '魔法浆果': 15 };
    const amount = amounts[foodType] ?? 12;
    this.state.stats.hunger = Math.min(this.state.statCap, this.state.stats.hunger + amount);
    this.state.stats.happiness = Math.min(this.state.statCap, this.state.stats.happiness + 3);
    this.state.foodIcon = foodType;
    this.state.action = 'eating';
    this.state.eatAnimationId = this.animManager.addAnimation('eat', 300);
    this.addExp(20);
    return true;
  }

  play(now: number): boolean {
    if (this.state.playAnimationId !== null || this.state.stats.energy < 10) return false;
    this.state.stats.happiness = Math.min(this.state.statCap, this.state.stats.happiness + 15);
    this.state.stats.energy = Math.max(0, this.state.stats.energy - 10);
    this.state.stats.hunger = Math.max(0, this.state.stats.hunger - 5);
    this.state.action = 'jumping';
    this.spinTimer = 0;
    this.state.playAnimationId = this.animManager.addAnimation('eat', 600);
    this.animManager.spawnSparkles(this.state.x, this.state.y - 40);
    this.addExp(30);
    return true;
  }

  clean(now: number): boolean {
    if (this.state.eatAnimationId !== null) return false;
    this.state.stats.cleanliness = this.state.statCap;
    this.state.stats.happiness = Math.min(this.state.statCap, this.state.stats.happiness + 8);
    this.animManager.spawnSparkles(this.state.x, this.state.y - 30);
    this.addExp(15);
    return true;
  }

  sleep(now: number): boolean {
    if (this.state.action === 'sleeping' || this.state.autoSleepStarted) return false;
    this.state.action = 'sleeping';
    this.state.expression = 'asleep';
    this.state.autoSleepStarted = true;
    this.state.sleepRecoverTimer = 0;
    this.addExp(10);
    return true;
  }

  wakeUp(): void {
    if (this.state.stats.energy >= 50) {
      this.state.action = 'idle';
      this.state.autoSleepStarted = false;
    }
  }

  addExp(amount: number): boolean {
    this.state.exp += amount;
    const expNeeded = this.state.level * 500;
    if (this.state.exp >= expNeeded) {
      this.state.exp -= expNeeded;
      this.levelUp();
      return true;
    }
    return false;
  }

  levelUp(): void {
    this.state.level++;
    this.state.statCap = Math.min(100, this.state.statCap + 5);
    this.state.stats.hunger = Math.min(this.state.statCap, this.state.stats.hunger + 10);
    this.state.stats.happiness = Math.min(this.state.statCap, this.state.stats.happiness + 10);
    this.state.stats.cleanliness = Math.min(this.state.statCap, this.state.stats.cleanliness + 10);
    this.state.stats.energy = Math.min(this.state.statCap, this.state.stats.energy + 10);
    this.animManager.spawnUpgradeConfetti(this.state.x, this.state.y - 50);
    this.animManager.addAnimation('upgrade-ring', 2000);
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const colors = PET_COLORS[this.state.type];
    let drawX = this.state.x;
    let drawY = this.state.y;
    let scale = 1;
    let rotation = 0;

    if (this.state.action === 'spinning') {
      rotation = (this.spinTimer / 0.8) * Math.PI * 2;
    }

    const breatheOffset = Math.sin(this.breathePhase) * 1.5;

    if (this.state.eatAnimationId !== null) {
      const p = this.animManager.getAnimationProgress(this.state.eatAnimationId, now);
      scale = 1 + Math.sin(p * Math.PI * 2) * 0.1;
    }

    ctx.save();
    ctx.translate(drawX, drawY + breatheOffset);
    ctx.rotate(rotation);
    ctx.scale(this.state.facing * scale, scale);

    if (this.state.action === 'sad' || (this.anyStatBelow(20) && !this.state.autoSleepStarted)) {
      this.drawSadPet(ctx, colors);
    } else if (this.state.action === 'sleeping' || this.state.expression === 'asleep') {
      this.drawSleepingPet(ctx, colors, now);
    } else {
      this.drawPet(ctx, colors, now);
    }

    ctx.restore();

    if (this.state.foodIcon && this.state.eatAnimationId !== null) {
      const p = this.animManager.getAnimationProgress(this.state.eatAnimationId, now);
      const fy = this.state.y - 70 - (1 - p) * 30;
      const fscale = p < 0.5 ? 1 + p : (1 - p) * 2;
      this.drawFoodIcon(ctx, this.state.x, fy, fscale, this.state.foodIcon);
    }

    if (this.state.expression === 'sleepy') {
      this.yawnTimer += 0.016;
      if (Math.sin(this.yawnTimer * 2) > 0.9) {
        this.drawZzz(ctx, this.state.x + 30, this.state.y - 60, now);
      }
    }
  }

  private drawPet(ctx: CanvasRenderingContext2D, colors: { body: string; dark: string; light: string; accent: string }, now: number): void {
    const px = 5;
    const patterns: Record<PetType, number[][]> = {
      cat: [
        [0,0,1,0,0,1,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,2,1,1,2,1,1],
        [1,1,1,1,1,1,1,1],
        [1,1,3,1,1,3,1,1],
        [0,1,1,4,4,1,1,0],
        [0,0,1,1,1,1,0,0],
        [0,1,0,0,0,0,1,0],
      ],
      dog: [
        [0,1,0,0,0,0,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,2,1,1,2,1,1],
        [1,1,1,1,1,1,1,1],
        [1,3,1,1,1,1,3,1],
        [0,1,1,4,4,1,1,0],
        [0,0,1,1,1,1,0,0],
        [0,1,1,0,0,1,1,0],
      ],
      dragon: [
        [0,4,0,1,1,0,4,0],
        [0,1,1,1,1,1,1,0],
        [1,1,2,1,1,2,1,1],
        [1,1,1,3,3,1,1,1],
        [1,1,1,1,1,1,1,1],
        [0,1,1,1,1,1,1,0],
        [0,0,1,1,1,1,0,0],
        [0,1,0,1,1,0,1,0],
      ]
    };

    const pattern = patterns[this.state.type];
    const offsetX = -4 * px;
    const offsetY = -6 * px;

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

    this.drawExpression(ctx, px, colors);
  }

  private drawExpression(ctx: CanvasRenderingContext2D, px: number, colors: { body: string; dark: string; light: string; accent: string }): void {
    const expr = this.state.expression;
    const eyeY = -4 * px;
    const leftEyeX = -1.5 * px;
    const rightEyeX = 1.5 * px;

    ctx.fillStyle = '#FFFFFF';

    if (expr === 'happy' || expr === 'playing') {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(leftEyeX, eyeY + px * 0.5, px * 0.8, Math.PI * 0.1, Math.PI * 0.9, true);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rightEyeX, eyeY + px * 0.5, px * 0.8, Math.PI * 0.1, Math.PI * 0.9, true);
      ctx.stroke();
      ctx.fillStyle = '#FF6B9D';
      ctx.fillRect(leftEyeX - px, eyeY + px * 2, px, px);
      ctx.fillRect(rightEyeX, eyeY + px * 2, px, px);
    } else if (expr === 'hungry') {
      const pulse = Math.sin(performance.now() / 300) * 2;
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('X', leftEyeX, eyeY + px + pulse);
      ctx.fillText('X', rightEyeX, eyeY + px + pulse);
    } else if (expr === 'sleepy') {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leftEyeX - px, eyeY + px * 0.5);
      ctx.lineTo(leftEyeX + px, eyeY + px * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightEyeX - px, eyeY + px * 0.5);
      ctx.lineTo(rightEyeX + px, eyeY + px * 0.3);
      ctx.stroke();
    } else if (expr === 'sad') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(leftEyeX - px * 0.4, eyeY, px * 0.8, px * 0.8);
      ctx.fillRect(rightEyeX - px * 0.4, eyeY, px * 0.8, px * 0.8);
      ctx.fillStyle = '#000000';
      ctx.fillRect(leftEyeX - px * 0.2, eyeY + px * 0.2, px * 0.4, px * 0.4);
      ctx.fillRect(rightEyeX - px * 0.2, eyeY + px * 0.2, px * 0.4, px * 0.4);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, px * 2.5, px, Math.PI * 0.1, Math.PI * 0.9, true);
      ctx.stroke();
    } else {
      ctx.fillRect(leftEyeX - px * 0.6, eyeY, px * 1.2, px * 1.2);
      ctx.fillRect(rightEyeX - px * 0.6, eyeY, px * 1.2, px * 1.2);
      ctx.fillStyle = '#000000';
      ctx.fillRect(leftEyeX - px * 0.2, eyeY + px * 0.2, px * 0.5, px * 0.6);
      ctx.fillRect(rightEyeX - px * 0.2, eyeY + px * 0.2, px * 0.5, px * 0.6);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(leftEyeX, eyeY + px * 0.1, px * 0.2, px * 0.2);
      ctx.fillRect(rightEyeX, eyeY + px * 0.1, px * 0.2, px * 0.2);
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (expr === 'happy' || expr === 'playing') {
      ctx.arc(0, px * 2, px * 0.9, 0, Math.PI);
    } else if (expr === 'hungry') {
      ctx.ellipse(0, px * 2.3, px * 0.8, px * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#FF6B6B';
      ctx.fill();
    } else if (expr === 'sleepy') {
      ctx.ellipse(0, px * 2, px * 1.2, px * 0.8, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(0, px * 2.2, px * 0.6, 0.2, Math.PI - 0.2);
    }
    ctx.stroke();
  }

  private drawSadPet(ctx: CanvasRenderingContext2D, colors: { body: string; dark: string; light: string; accent: string }): void {
    const px = 5;
    const patterns: Record<PetType, number[][]> = {
      cat: [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,2,1,1,2,1,1],
        [1,1,1,1,1,1,1,1],
        [1,1,3,1,1,3,1,1],
        [0,1,1,4,4,1,1,0],
        [1,0,1,1,1,1,0,1],
      ],
      dog: [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [1,1,1,1,1,1,1,1],
        [1,1,2,1,1,2,1,1],
        [1,1,1,1,1,1,1,1],
        [1,3,1,1,1,1,3,1],
        [0,1,1,4,4,1,1,0],
        [1,1,0,1,1,0,1,1],
      ],
      dragon: [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,2,1,1,2,1,1],
        [1,1,1,3,3,1,1,1],
        [1,1,1,1,1,1,1,1],
        [0,1,1,1,1,1,1,0],
        [1,1,0,1,1,0,1,1],
      ]
    };

    const pattern = patterns[this.state.type];
    const offsetX = -4 * px;
    const offsetY = -4 * px;

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

    const px2 = px;
    const eyeY = -2 * px2;
    const leftEyeX = -1.5 * px2;
    const rightEyeX = 1.5 * px2;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(leftEyeX - px2 * 0.5, eyeY, px2, px2);
    ctx.fillRect(rightEyeX - px2 * 0.5, eyeY, px2, px2);
    ctx.fillStyle = '#000000';
    ctx.fillRect(leftEyeX - px2 * 0.2, eyeY + px2 * 0.3, px2 * 0.4, px2 * 0.4);
    ctx.fillRect(rightEyeX - px2 * 0.2, eyeY + px2 * 0.3, px2 * 0.4, px2 * 0.4);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, px2 * 0.5, px2 * 0.7, Math.PI * 0.1, Math.PI * 0.9, true);
    ctx.stroke();
  }

  private drawSleepingPet(ctx: CanvasRenderingContext2D, colors: { body: string; dark: string; light: string; accent: string }, now: number): void {
    const px = 5;
    const patterns: Record<PetType, number[][]> = {
      cat: [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1],
        [1,1,1,3,3,1,1,1],
        [0,1,1,1,1,1,1,0],
        [1,0,1,1,1,1,0,1],
      ],
      dog: [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1],
        [1,3,1,1,1,1,3,1],
        [0,1,1,1,1,1,1,0],
        [1,1,0,1,1,0,1,1],
      ],
      dragon: [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [0,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1],
        [1,1,1,3,3,1,1,1],
        [1,1,1,1,1,1,1,1],
        [0,1,1,1,1,1,1,0],
        [1,1,0,1,1,0,1,1],
      ]
    };

    const pattern = patterns[this.state.type];
    const offsetX = -4 * px;
    const offsetY = -4 * px;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const v = pattern[row][col];
        if (v === 0) continue;
        let color = colors.body;
        if (v === 3) color = colors.accent;
        ctx.fillStyle = color;
        ctx.fillRect(offsetX + col * px, offsetY + row * px, px, px);
      }
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    const eyeY = -2 * px;
    ctx.beginPath();
    ctx.moveTo(-2 * px, eyeY);
    ctx.lineTo(-1 * px, eyeY);
    ctx.moveTo(1 * px, eyeY);
    ctx.lineTo(2 * px, eyeY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, px * 0.5, px * 0.4, 0, Math.PI);
    ctx.stroke();

    const zzzOffset = (now / 200) % 60;
    ctx.fillStyle = '#81D4FA';
    ctx.font = 'bold 14px monospace';
    ctx.globalAlpha = Math.max(0, 1 - zzzOffset / 60);
    ctx.fillText('z', 25 - zzzOffset * 0.3, -20 - zzzOffset * 0.5);
    ctx.fillText('Z', 35 - zzzOffset * 0.4, -35 - zzzOffset * 0.8);
    ctx.globalAlpha = 1;
  }

  private drawZzz(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
    const t = (now % 1000) / 1000;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = '#81D4FA';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('z', x + t * 20, y - t * 30);
    ctx.fillText('Z', x + 10 + t * 25, y - 15 - t * 40);
    ctx.restore();
  }

  private drawFoodIcon(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, food: string): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const px = 3;
    if (food === '小鱼干') {
      ctx.fillStyle = '#FFB74D';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(22, -8);
      ctx.lineTo(22, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.fillRect(-8, -2, 3, 3);
    } else if (food === '骨头棒') {
      ctx.fillStyle = '#F5F5DC';
      ctx.fillRect(-18, -4, 30, 8);
      ctx.beginPath();
      ctx.arc(-18, 0, 7, 0, Math.PI * 2);
      ctx.arc(12, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#D7CCC8';
      ctx.fillRect(-18, -1, 30, 2);
    } else if (food === '魔法浆果') {
      ctx.fillStyle = '#9C27B0';
      ctx.beginPath();
      ctx.arc(-5, 3, 8, 0, Math.PI * 2);
      ctx.arc(5, 3, 8, 0, Math.PI * 2);
      ctx.arc(0, -5, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(-2, -15, 4, 8);
      ctx.fillRect(-6, -12, 4, 4);
      ctx.fillRect(2, -12, 4, 4);
      ctx.fillStyle = '#E1BEE7';
      ctx.fillRect(-8, -2, 2, 2);
    }
    ctx.restore();
  }

  getSpinProgress(): number {
    if (this.state.action !== 'spinning') return 0;
    return this.spinTimer / 0.8;
  }
}
