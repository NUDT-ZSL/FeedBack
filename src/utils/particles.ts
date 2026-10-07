class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.8;
    this.vy = (Math.random() - 0.5) * 0.8;
    this.size = Math.random() * 30 + 10;
    this.opacity = Math.random() * 0.3 + 0.1;
    this.life = 1;
  }
}

export class ParticleSystem {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private animationId: number | null = null;

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  emit(count: number): void {
    if (!this.canvas) return;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    for (let i = 0; i < count; i++) {
      const offsetX = (Math.random() - 0.5) * 200;
      const offsetY = (Math.random() - 0.5) * 200;
      this.particles.push(new Particle(centerX + offsetX, centerY + offsetY));
    }
  }

  update(): void {
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.opacity = Math.max(0, p.opacity - 0.002);
      p.life -= 0.003;
      p.size += 0.05;
    });
  }

  render(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.forEach(p => {
      this.ctx!.beginPath();
      this.ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      const gradient = this.ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${p.opacity})`);
      gradient.addColorStop(0.6, `rgba(255, 255, 255, ${p.opacity * 0.5})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      this.ctx!.fillStyle = gradient;
      this.ctx!.fill();
    });
  }

  private animate = (): void => {
    this.update();
    this.render();
    if (this.particles.length > 0) {
      this.animationId = requestAnimationFrame(this.animate);
    }
  };

  start(): void {
    if (this.animationId === null) {
      this.animate();
    }
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener('resize', this.resize);
    this.particles = [];
  }
}
