import { ElementBall, ElementType } from './elements';
import { ParticleSystem } from './particles';

export interface SynthesisLog {
  id: string;
  timestamp: number;
  elements: ElementType[];
  result: string;
  color: string;
}

interface ConflictPair {
  a: ElementType;
  b: ElementType;
  reaction: string;
  color: string;
}

const CONFLICT_PAIRS: ConflictPair[] = [
  { a: 'water', b: 'fire', reaction: '水与火碰撞，产生浓密的蒸汽云', color: '#ffffff' },
  { a: 'wind', b: 'earth', reaction: '风与土交汇，卷起漫天沙尘暴', color: '#d4a54a' },
  { a: 'light', b: 'dark', reaction: '光与暗交融，形成黑洞漩涡', color: '#9932cc' }
];

const FUSION_RESULTS: Record<ElementType, { result: string; color: string }> = {
  fire: { result: '三火合一，召唤出火焰精灵！', color: '#ff6600' },
  water: { result: '三水凝结，生成璀璨冰晶！', color: '#88ddff' },
  wind: { result: '三风凝聚，形成旋风风暴！', color: '#3cb371' },
  earth: { result: '三土聚合，凝聚成坚硬巨石！', color: '#8b5a2b' },
  light: { result: '三光合聚，绽放神圣光芒！', color: '#fffacd' },
  dark: { result: '三暗融合，诞生幽暗深渊！', color: '#8a2be2' }
};

export class Cauldron {
  x: number;
  y: number;
  radius: number;
  balls: ElementBall[] = [];
  private breathePhase: number = 0;
  private breatheSpeed: number = 0.8;
  private particles: ParticleSystem;
  private onSynthesisCallback: ((log: SynthesisLog) => void) | null = null;

  constructor(x: number, y: number, radius: number, particles: ParticleSystem) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.particles = particles;
  }

  setOnSynthesis(callback: (log: SynthesisLog) => void): void {
    this.onSynthesisCallback = callback;
  }

  update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    this.breathePhase += dt * this.breatheSpeed;
  }

  get breatheAlpha(): number {
    return 0.5 + Math.sin(this.breathePhase) * 0.15;
  }

  containsPoint(px: number, py: number): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }

  addBall(ball: ElementBall): void {
    if (ball.inCauldron) return;

    ball.inCauldron = true;
    ball.x = this.x + (Math.random() - 0.5) * this.radius * 0.4;
    ball.y = this.y + (Math.random() - 0.5) * this.radius * 0.2;
    this.balls.push(ball);

    this.particles.createSplash(ball.x, ball.y, ball.config.colorEnd);

    setTimeout(() => this.checkReactions(), 100);
  }

  private checkReactions(): void {
    if (this.balls.length < 2) return;

    const typeCounts = new Map<ElementType, ElementBall[]>();
    for (const ball of this.balls) {
      if (!typeCounts.has(ball.type)) typeCounts.set(ball.type, []);
      typeCounts.get(ball.type)!.push(ball);
    }

    for (const [type, balls] of typeCounts) {
      if (balls.length >= 3) {
        this.triggerFusion(type, balls.slice(0, 3));
        return;
      }
    }

    for (const pair of CONFLICT_PAIRS) {
      const ballsA = typeCounts.get(pair.a);
      const ballsB = typeCounts.get(pair.b);
      if (ballsA && ballsA.length > 0 && ballsB && ballsB.length > 0) {
        this.triggerConflict(pair, ballsA[0], ballsB[0]);
        return;
      }
    }
  }

  private triggerFusion(type: ElementType, balls: ElementBall[]): void {
    const info = FUSION_RESULTS[type];
    this.particles.createFusionAura(this.x, this.y, info.color);

    switch (type) {
      case 'fire':
        this.particles.createFireSpirit(this.x, this.y);
        break;
      case 'water':
        this.particles.createIceCrystal(this.x, this.y);
        break;
      case 'earth':
        this.particles.createStone(this.x, this.y);
        break;
      case 'wind':
        this.particles.createSandstorm(this.x, this.y);
        break;
      case 'light':
        this.particles.createFireSpirit(this.x, this.y);
        break;
      case 'dark':
        const posBalls = balls.map(b => ({ x: b.x, y: b.y }));
        this.particles.createBlackhole(this.x, this.y, posBalls);
        break;
    }

    this.removeBalls(balls);
    this.addLog(balls.map(b => b.type), info.result, info.color);
  }

  private triggerConflict(pair: ConflictPair, ballA: ElementBall, ballB: ElementBall): void {
    if (pair.a === 'water' && pair.b === 'fire') {
      this.particles.createSteam(this.x, this.y);
    } else if (pair.a === 'wind' && pair.b === 'earth') {
      this.particles.createSandstorm(this.x, this.y);
    } else if (pair.a === 'light' && pair.b === 'dark') {
      const posBalls = this.balls.map(b => ({ x: b.x, y: b.y }));
      this.particles.createBlackhole(this.x, this.y, posBalls);
      this.balls.forEach(b => {
        setTimeout(() => b.reset(), 2000);
      });
      this.balls = [];
      this.addLog([pair.a, pair.b], pair.reaction, pair.color);
      return;
    }

    this.removeBalls([ballA, ballB]);
    this.addLog([pair.a, pair.b], pair.reaction, pair.color);
  }

  private removeBalls(balls: ElementBall[]): void {
    for (const ball of balls) {
      const idx = this.balls.indexOf(ball);
      if (idx >= 0) {
        this.balls.splice(idx, 1);
        setTimeout(() => ball.reset(), 50);
      }
    }
  }

  private addLog(elements: ElementType[], result: string, color: string): void {
    if (this.onSynthesisCallback) {
      this.onSynthesisCallback({
        id: Math.random().toString(36).slice(2),
        timestamp: Date.now(),
        elements,
        result,
        color
      });
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    const shadowGradient = ctx.createRadialGradient(
      this.x, this.y + this.radius * 0.3, this.radius * 0.5,
      this.x, this.y + this.radius * 0.3, this.radius * 1.3
    );
    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    shadowGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = shadowGradient;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.radius * 0.3, this.radius * 1.1, this.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyGradient = ctx.createRadialGradient(
      this.x - this.radius * 0.3, this.y - this.radius * 0.3, 0,
      this.x, this.y, this.radius
    );
    bodyGradient.addColorStop(0, 'rgba(180, 200, 220, 0.25)');
    bodyGradient.addColorStop(0.5, 'rgba(100, 140, 180, 0.15)');
    bodyGradient.addColorStop(1, 'rgba(60, 100, 140, 0.2)');

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    const alpha = this.breatheAlpha;
    ctx.strokeStyle = `rgba(150, 200, 255, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = `rgba(150, 200, 255, ${alpha * 0.8})`;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = `rgba(200, 220, 255, ${alpha * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius - 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(30, 20, 15, 0.9)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.radius * 0.88, this.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const innerGlow = ctx.createRadialGradient(
      this.x, this.y, 0,
      this.x, this.y, this.radius * 0.8
    );
    innerGlow.addColorStop(0, 'rgba(100, 150, 200, 0.15)');
    innerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.85, 0, Math.PI * 2);
    ctx.fill();

    this.renderBallsInCauldron(ctx);

    ctx.restore();
  }

  private renderBallsInCauldron(ctx: CanvasRenderingContext2D): void {
    for (const ball of this.balls) {
      const r = ball.baseRadius * 0.8;
      const gradient = ctx.createRadialGradient(
        ball.x - r * 0.3, ball.y - r * 0.3, 0,
        ball.x, ball.y, r
      );
      gradient.addColorStop(0, ball.config.colorEnd + 'aa');
      gradient.addColorStop(0.5, ball.config.colorStart + '77');
      gradient.addColorStop(1, ball.config.colorStart + '44');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = ball.config.colorEnd + '66';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
