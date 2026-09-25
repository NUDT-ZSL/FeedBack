interface LeaderboardEntry {
  name: string;
  score: number;
  date: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
}

export class UIManager {
  private startScreen: HTMLElement;
  private gameHUD: HTMLElement;
  private endScreen: HTMLElement;

  private scoreDisplay: HTMLElement;
  private healthContainer: HTMLElement;
  private beatFill: HTMLElement;
  private finalScoreEl: HTMLElement;
  private leaderboardEl: HTMLElement;

  private spectrumCanvas: HTMLCanvasElement;
  private spectrumCtx: CanvasRenderingContext2D | null = null;

  private particlesCanvas: HTMLCanvasElement;
  private particlesCtx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private particleCount: number = 200;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private animationId: number = 0;

  private nameInput: HTMLInputElement;
  private startBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;

  private onStartCallback: ((name: string) => void) | null = null;
  private onRestartCallback: (() => void) | null = null;

  private readonly LEADERBOARD_KEY = 'rhythm_runner_leaderboard';
  private readonly MAX_ENTRIES = 10;

  constructor() {
    this.startScreen = document.getElementById('start-screen')!;
    this.gameHUD = document.getElementById('game-hud')!;
    this.endScreen = document.getElementById('end-screen')!;

    this.scoreDisplay = document.getElementById('score-display')!;
    this.healthContainer = document.getElementById('health-display')!;
    this.beatFill = document.getElementById('beat-fill')!;
    this.finalScoreEl = document.getElementById('final-score')!;
    this.leaderboardEl = document.getElementById('leaderboard')!;

    this.spectrumCanvas = document.getElementById('spectrum-canvas') as HTMLCanvasElement;
    this.spectrumCtx = this.spectrumCanvas.getContext('2d');

    this.particlesCanvas = document.getElementById('particles-canvas') as HTMLCanvasElement;
    this.particlesCtx = this.particlesCanvas.getContext('2d');

    this.nameInput = document.getElementById('name-input') as HTMLInputElement;
    this.startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    this.restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;

    this.setupEventListeners();
    this.resizeCanvases();
    this.initParticles();
    this.initHearts();

    window.addEventListener('resize', () => this.resizeCanvases());
  }

  private setupEventListeners(): void {
    this.startBtn.addEventListener('click', () => {
      const name = this.nameInput.value.trim() || '玩家';
      if (this.onStartCallback) {
        this.onStartCallback(name);
      }
    });

    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.startBtn.click();
      }
    });

    this.restartBtn.addEventListener('click', () => {
      if (this.onRestartCallback) {
        this.onRestartCallback();
      }
    });

    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  private resizeCanvases(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.spectrumCanvas.width = width;
    this.spectrumCanvas.height = height;

    this.particlesCanvas.width = width;
    this.particlesCanvas.height = height;
  }

  private initParticles(): void {
    this.particles = [];
    const colors = ['#00ffff', '#ff00ff', '#ffff00', '#ff6600'];

    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        x: Math.random() * this.particlesCanvas.width,
        y: Math.random() * this.particlesCanvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 3 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: Math.random()
      });
    }
  }

  private initHearts(): void {
    this.healthContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const heart = document.createElement('div');
      heart.className = 'heart';
      heart.innerHTML = this.getHeartSVG();
      this.healthContainer.appendChild(heart);
    }
  }

  private getHeartSVG(): string {
    return `
      <svg viewBox="0 0 24 24" fill="#ff3366" style="filter: drop-shadow(0 0 4px #ff3366);">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      </svg>
    `;
  }

  startParticleAnimation(): void {
    const animate = () => {
      this.updateParticles();
      this.drawParticles();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  stopParticleAnimation(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  private updateParticles(): void {
    const canvas = this.particlesCanvas;
    const attractForce = 0.0005;

    for (const p of this.particles) {
      const dx = this.mouseX - p.x;
      const dy = this.mouseY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 150 && dist > 0) {
        p.vx += (dx / dist) * attractForce * (150 - dist);
        p.vy += (dy / dist) * attractForce * (150 - dist);
      }

      p.vx *= 0.99;
      p.vy *= 0.99;

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
    }
  }

  private drawParticles(): void {
    if (!this.particlesCtx) return;
    const ctx = this.particlesCtx;
    const canvas = this.particlesCanvas;

    ctx.fillStyle = 'rgba(10, 0, 32, 0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fill();

      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 80) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(0, 255, 255, ${(1 - dist / 80) * 0.3})`;
          ctx.lineWidth = 0.5;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      }
    }

    ctx.shadowBlur = 0;
  }

  drawSpectrum(frequencyData: Uint8Array, beatIntensity: number): void {
    if (!this.spectrumCtx) return;
    const ctx = this.spectrumCtx;
    const canvas = this.spectrumCanvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barCount = frequencyData.length;
    const barWidth = canvas.width / barCount;
    const centerY = canvas.height * 0.7;

    for (let i = 0; i < barCount; i++) {
      const value = frequencyData[i];
      const barHeight = (value / 255) * canvas.height * 0.5;

      const hue = 180 + (i / barCount) * 120 + beatIntensity * 60;
      const color = `hsla(${hue}, 100%, 60%, 0.6)`;

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;

      const x = i * barWidth;
      const y = centerY - barHeight / 2;

      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }

    ctx.shadowBlur = 0;
  }

  showStartScreen(): void {
    this.startScreen.classList.remove('hidden');
    this.gameHUD.classList.add('hidden');
    this.endScreen.classList.add('hidden');
    this.startParticleAnimation();
  }

  showGameHUD(): void {
    this.startScreen.classList.add('hidden');
    this.gameHUD.classList.remove('hidden');
    this.endScreen.classList.add('hidden');
    this.stopParticleAnimation();
  }

  showEndScreen(score: number, playerName: string): void {
    this.endScreen.classList.remove('hidden');
    this.gameHUD.classList.add('hidden');

    this.finalScoreEl.textContent = score.toLocaleString();

    this.saveScore(playerName, score);
    this.renderLeaderboard(playerName);
  }

  updateScore(score: number): void {
    this.scoreDisplay.textContent = score.toLocaleString();
  }

  updateHealth(health: number): void {
    const hearts = this.healthContainer.querySelectorAll('.heart');
    hearts.forEach((heart, index) => {
      if (index < health) {
        heart.classList.remove('lost');
      } else {
        heart.classList.add('lost');
      }
    });
  }

  updateBeatIntensity(intensity: number): void {
    const percentage = Math.min(100, intensity * 100);
    this.beatFill.style.width = `${percentage}%`;
  }

  private saveScore(name: string, score: number): void {
    const entries = this.loadLeaderboard();
    entries.push({
      name,
      score,
      date: new Date().toISOString()
    });

    entries.sort((a, b) => b.score - a.score);
    const topEntries = entries.slice(0, this.MAX_ENTRIES);

    localStorage.setItem(this.LEADERBOARD_KEY, JSON.stringify(topEntries));
  }

  private loadLeaderboard(): LeaderboardEntry[] {
    try {
      const data = localStorage.getItem(this.LEADERBOARD_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed to load leaderboard:', e);
    }
    return [];
  }

  private renderLeaderboard(currentName: string): void {
    const entries = this.loadLeaderboard();
    this.leaderboardEl.innerHTML = '';

    if (entries.length === 0) {
      this.leaderboardEl.innerHTML = '<div style="color: #666; padding: 20px;">暂无记录</div>';
      return;
    }

    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.style.animationDelay = `${index * 0.05}s`;

      if (entry.name === currentName) {
        row.classList.add('current-player');
      }

      row.innerHTML = `
        <span class="leaderboard-rank">#${index + 1}</span>
        <span class="leaderboard-name">${this.escapeHtml(entry.name)}</span>
        <span class="leaderboard-score">${entry.score.toLocaleString()}</span>
      `;

      this.leaderboardEl.appendChild(row);
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  setOnStartCallback(callback: (name: string) => void): void {
    this.onStartCallback = callback;
  }

  setOnRestartCallback(callback: () => void): void {
    this.onRestartCallback = callback;
  }

  getPlayerName(): string {
    return this.nameInput.value.trim() || '玩家';
  }

  setPlayerName(name: string): void {
    this.nameInput.value = name;
  }
}
