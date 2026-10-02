export interface JoystickOutput {
  x: number;
  y: number;
  active: boolean;
}

export class UI {
  livesContainer: HTMLElement;
  starCountEl: HTMLElement;
  scoreEl: HTMLElement;
  damageOverlay: HTMLElement;
  messageEl: HTMLElement;
  joystickCanvas: HTMLCanvasElement;
  joystickCtx: CanvasRenderingContext2D;

  lives: number = 5;
  stars: number = 0;
  score: number = 0;
  lastScoreDigits: string = '0';

  joystick: {
    active: boolean;
    pointerId: number | null;
    centerX: number;
    centerY: number;
    knobX: number;
    knobY: number;
    output: JoystickOutput;
    radius: number;
    particles: Array<{ x: number; y: number; life: number; vx: number; vy: number }>;
  };

  onJoystickChange?: (output: JoystickOutput) => void;

  constructor() {
    this.livesContainer = document.getElementById('lives')!;
    this.starCountEl = document.getElementById('star-count')!;
    this.scoreEl = document.getElementById('score')!;
    this.damageOverlay = document.getElementById('damage-overlay')!;
    this.messageEl = document.getElementById('message')!;
    this.joystickCanvas = document.getElementById('joystick-canvas') as HTMLCanvasElement;
    this.joystickCtx = this.joystickCanvas.getContext('2d')!;

    this.joystick = {
      active: false,
      pointerId: null,
      centerX: this.joystickCanvas.width / 2,
      centerY: this.joystickCanvas.height / 2,
      knobX: this.joystickCanvas.width / 2,
      knobY: this.joystickCanvas.height / 2,
      output: { x: 0, y: 0, active: false },
      radius: 90,
      particles: []
    };

    this.initLives();
    this.updateScore(0);
    this.bindJoystickEvents();
    this.drawJoystick();
  }

  initLives(): void {
    this.livesContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const heart = document.createElement('div');
      heart.className = 'heart';
      heart.innerHTML = `<svg viewBox="0 0 24 24" fill="#ff3c50"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
      this.livesContainer.appendChild(heart);
    }
  }

  setLives(count: number): void {
    this.lives = Math.max(0, count);
    const hearts = this.livesContainer.querySelectorAll('.heart');
    hearts.forEach((h, i) => {
      if (i < this.lives) h.classList.remove('lost');
      else h.classList.add('lost');
    });
  }

  showDamageFlash(): void {
    this.damageOverlay.classList.add('active');
    setTimeout(() => this.damageOverlay.classList.remove('active'), 200);
  }

  setStars(count: number): void {
    this.stars = count;
    this.starCountEl.textContent = String(count);
  }

  addScore(points: number): void {
    this.updateScore(this.score + points);
  }

  updateScore(score: number): void {
    const oldStr = String(this.score).padStart(5, '0');
    this.score = score;
    const newStr = String(score).padStart(5, '0');

    let html = '';
    for (let i = 0; i < newStr.length; i++) {
      const changed = oldStr[i] !== newStr[i];
      html += `<span class="digit${changed ? ' flip' : ''}">${newStr[i]}</span>`;
    }
    this.scoreEl.innerHTML = html;
  }

  showMessage(text: string, sub?: string, duration: number = 3000): void {
    this.messageEl.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : '');
    this.messageEl.classList.add('show');
    if (duration > 0) {
      setTimeout(() => this.messageEl.classList.remove('show'), duration);
    }
  }

  hideMessage(): void {
    this.messageEl.classList.remove('show');
  }

  bindJoystickEvents(): void {
    const canvas = this.joystickCanvas;

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joystick.active = true;
      this.joystick.pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      const pos = getPos(e);
      this.updateJoystickPos(pos.x, pos.y);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.joystick.active || e.pointerId !== this.joystick.pointerId) return;
      e.preventDefault();
      const pos = getPos(e);
      this.updateJoystickPos(pos.x, pos.y);
    });

    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== this.joystick.pointerId) return;
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.knobX = this.joystick.centerX;
      this.joystick.knobY = this.joystick.centerY;
      this.joystick.output = { x: 0, y: 0, active: false };
      this.onJoystickChange?.(this.joystick.output);
      this.drawJoystick();
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', endDrag);
  }

  updateJoystickPos(x: number, y: number): void {
    const dx = x - this.joystick.centerX;
    const dy = y - this.joystick.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = this.joystick.radius;

    if (dist > maxDist) {
      this.joystick.knobX = this.joystick.centerX + (dx / dist) * maxDist;
      this.joystick.knobY = this.joystick.centerY + (dy / dist) * maxDist;
    } else {
      this.joystick.knobX = x;
      this.joystick.knobY = y;
    }

    if (this.joystick.active && dist > 5) {
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 2;
        this.joystick.particles.push({
          x: this.joystick.knobX,
          y: this.joystick.knobY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1
        });
      }
    }

    this.joystick.output = {
      x: (this.joystick.knobX - this.joystick.centerX) / maxDist,
      y: (this.joystick.knobY - this.joystick.centerY) / maxDist,
      active: true
    };

    this.onJoystickChange?.(this.joystick.output);
    this.drawJoystick();
  }

  drawJoystick(): void {
    const ctx = this.joystickCtx;
    const w = this.joystickCanvas.width;
    const h = this.joystickCanvas.height;

    ctx.clearRect(0, 0, w, h);

    this.joystick.particles = this.joystick.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.04;
      if (p.life > 0) {
        ctx.fillStyle = `rgba(255, 140, 0, ${p.life * 0.6})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
        ctx.fill();
        return true;
      }
      return false;
    });

    const baseRadius = this.joystick.radius + 10;
    const gradient = ctx.createRadialGradient(
      this.joystick.centerX, this.joystick.centerY, 10,
      this.joystick.centerX, this.joystick.centerY, baseRadius
    );
    gradient.addColorStop(0, 'rgba(42, 42, 53, 0.7)');
    gradient.addColorStop(1, 'rgba(42, 42, 53, 0.3)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.joystick.centerX, this.joystick.centerY, baseRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 140, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.joystick.centerX, this.joystick.centerY, this.joystick.radius, 0, Math.PI * 2);
    ctx.stroke();

    const knobRadius = this.joystick.active ? 38 : 32;
    const knobGradient = ctx.createRadialGradient(
      this.joystick.knobX - 8, this.joystick.knobY - 8, 4,
      this.joystick.knobX, this.joystick.knobY, knobRadius
    );
    knobGradient.addColorStop(0, '#ff8c00');
    knobGradient.addColorStop(1, '#a05000');

    ctx.fillStyle = knobGradient;
    ctx.beginPath();
    ctx.arc(this.joystick.knobX, this.joystick.knobY, knobRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 200, 100, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  animateJoystick(): void {
    if (this.joystick.particles.length > 0) {
      this.drawJoystick();
    }
  }
}
