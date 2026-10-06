import { ElementBall, ElementType } from './elements';
import { Cauldron, SynthesisLog } from './cauldron';
import { ParticleSystem } from './particles';
import { UIManager } from './ui';
import { RuleSet, createDefaultRules } from './rules';
import { SnapshotStore } from './snapshots';
import { RulePanel } from './panel';

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;

  private particles: ParticleSystem;
  private cauldron!: Cauldron;
  private balls: ElementBall[] = [];
  private ui: UIManager;

  private rules: RuleSet;
  private snapshotStore: SnapshotStore;
  private panel!: RulePanel;

  private draggingBall: ElementBall | null = null;

  private lastTime: number = 0;
  private fps: number = 60;
  private frameCount: number = 0;
  private fpsTimer: number = 0;

  private animationId: number = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 Canvas 2D 上下文');
    this.ctx = ctx;

    this.particles = new ParticleSystem();
    this.ui = new UIManager(window.innerWidth, window.innerHeight);
    this.rules = createDefaultRules();
    this.snapshotStore = new SnapshotStore();

    this.resize();
    this.initBalls();
    this.cauldron = new Cauldron(
      this.width / 2,
      this.height / 2 + 30,
      130,
      this.particles,
      this.rules
    );
    this.cauldron.setOnSynthesis((log: SynthesisLog) => this.ui.addLog(log));
    this.cauldron.setOnCompositionChange(() => {
      this.ensureRackStock();
      this.panel.refresh();
    });
    this.cauldron.setOnBallsConsumed((consumed: ElementBall[]) => {
      this.balls = this.balls.filter(ball => !consumed.includes(ball));
      this.ensureRackStock();
    });

    this.panel = new RulePanel(
      {
        getRules: () => this.rules,
        applyRules: (rules: RuleSet) => {
          this.rules = rules;
          this.cauldron.setRules(rules);
        },
        getCounts: () => this.cauldron.getCounts()
      },
      this.snapshotStore
    );

    this.bindEvents();
    this.lastTime = performance.now();
    this.loop();
  }

  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ui.resize(this.width, this.height);
  }

  private initBalls(): void {
    const slots = this.ui.getSlotPositions();
    this.balls = slots.map(slot => new ElementBall(slot.elementType, slot.x, slot.y));
  }

  private ensureRackStock(): void {
    const slots = this.ui.getSlotPositions();
    for (const slot of slots) {
      const hasFree = this.balls.some(
        ball => ball.type === slot.elementType && !ball.inCauldron && !ball.isDragging
      );
      if (!hasFree) {
        this.balls.push(new ElementBall(slot.elementType, slot.x, slot.y));
      }
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.resize();
      const slots = this.ui.getSlotPositions();
      for (const ball of this.balls) {
        if (ball.inCauldron || ball.isDragging) continue;
        const slot = slots.find(s => s.elementType === ball.type);
        if (slot) {
          ball.homeX = slot.x;
          ball.homeY = slot.y;
          ball.x = slot.x;
          ball.y = slot.y;
        }
      }
      this.cauldron.x = this.width / 2;
      this.cauldron.y = this.height / 2 + 30;
    });

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
  }

  private getMousePos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  private onMouseDown(e: MouseEvent): void {
    const { x, y } = this.getMousePos(e);

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (!ball.inCauldron && ball.containsPoint(x, y)) {
        this.draggingBall = ball;
        ball.isDragging = true;
        this.canvas.style.cursor = 'grabbing';
        break;
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const { x, y } = this.getMousePos(e);

    let hovering = false;
    for (const ball of this.balls) {
      if (!ball.inCauldron && !ball.isDragging) {
        ball.isHovered = ball.containsPoint(x, y);
        if (ball.isHovered) hovering = true;
      }
    }
    this.canvas.style.cursor = hovering ? 'grab' : this.draggingBall ? 'grabbing' : 'default';

    if (this.draggingBall) {
      this.draggingBall.x = x;
      this.draggingBall.y = y;
    }
  }

  private onMouseUp(_e?: MouseEvent): void {
    if (this.draggingBall) {
      const ball = this.draggingBall;
      ball.isDragging = false;

      if (this.cauldron.containsPoint(ball.x, ball.y)) {
        this.cauldron.addBall(ball);
      } else {
        ball.x = ball.homeX;
        ball.y = ball.homeY;
      }

      this.draggingBall = null;
      this.canvas.style.cursor = 'default';
    }
  }

  private update(deltaTime: number, time: number): void {
    for (const ball of this.balls) {
      ball.update(deltaTime, time);
    }
    this.cauldron.update(deltaTime);
    this.particles.update(deltaTime);
    this.ui.update(deltaTime);

    this.frameCount++;
    this.fpsTimer += deltaTime;
    if (this.fpsTimer >= 500) {
      this.fps = (this.frameCount * 1000) / this.fpsTimer;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.ui.renderBackground(this.ctx);
    this.ui.renderTitle(this.ctx);

    const occupiedSlots = new Set<ElementType>();
    for (const ball of this.balls) {
      if (ball.inCauldron) occupiedSlots.add(ball.type);
    }
    this.ui.renderElementRack(this.ctx, occupiedSlots);

    this.cauldron.render(this.ctx);
    this.particles.render(this.ctx);

    for (const ball of this.balls) {
      if (!ball.inCauldron) {
        ball.render(this.ctx);
      }
    }

    if (this.draggingBall) {
      this.draggingBall.render(this.ctx);
    }

    this.ui.renderSynthesisLog(this.ctx);
    this.ui.renderFpsCounter(this.ctx, this.fps, this.particles.getCount());
  }

  private loop = (): void => {
    const now = performance.now();
    const deltaTime = Math.min(now - this.lastTime, 50);
    this.lastTime = now;

    this.update(deltaTime, now);
    this.render();

    this.animationId = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    cancelAnimationFrame(this.animationId);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
