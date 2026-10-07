import { ElementBall, ElementType } from './elements';
import { ParticleSystem } from './particles';
import {
  ConflictPair,
  Counts,
  RuleSet,
  TriggerResult,
  defaultRules,
  emptyCounts,
  findTrigger,
  pairKey
} from './rules';

export interface SynthesisLog {
  id: string;
  timestamp: number;
  elements: ElementType[];
  result: string;
  color: string;
  ruleLabel?: string;
}

export class Cauldron {
  x: number;
  y: number;
  radius: number;
  balls: ElementBall[] = [];
  private breathePhase: number = 0;
  private breatheSpeed: number = 0.8;
  private particles: ParticleSystem;
  private rules: RuleSet = defaultRules();
  private onSynthesisCallback: ((log: SynthesisLog) => void) | null = null;
  private onContentsChangeCallback: (() => void) | null = null;

  constructor(x: number, y: number, radius: number, particles: ParticleSystem) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.particles = particles;
  }

  setOnSynthesis(callback: (log: SynthesisLog) => void): void {
    this.onSynthesisCallback = callback;
  }

  setOnContentsChange(callback: () => void): void {
    this.onContentsChangeCallback = callback;
  }

  setRules(rules: RuleSet): void {
    this.rules = rules;
  }

  getRules(): RuleSet {
    return this.rules;
  }

  getCounts(): Counts {
    const counts = emptyCounts();
    for (const ball of this.balls) counts[ball.type] += 1;
    return counts;
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
    this.notifyContentsChange();

    setTimeout(() => this.checkReactions(), 100);
  }

  private notifyContentsChange(): void {
    if (this.onContentsChangeCallback) this.onContentsChangeCallback();
  }

  private checkReactions(): void {
    if (this.balls.length === 0) return;
    const trigger = findTrigger(this.rules, this.getCounts());
    if (!trigger) return;

    if (trigger.rule.kind === 'fusion') {
      this.triggerFusion(trigger);
    } else {
      const pair = this.rules.pairs.find(p => p.id === trigger.rule.pairId);
      if (pair) this.triggerConflict(pair, trigger);
    }
    this.notifyContentsChange();
  }

  private ballsOfType(type: ElementType, count: number): ElementBall[] {
    return this.balls.filter(b => b.type === type).slice(0, count);
  }

  private triggerFusion(trigger: TriggerResult): void {
    const type = trigger.rule.element as ElementType;
    const balls = this.ballsOfType(type, trigger.consume[type]);
    if (balls.length === 0) return;

    this.particles.createFusionAura(this.x, this.y, trigger.color);

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
      case 'dark': {
        const posBalls = balls.map(b => ({ x: b.x, y: b.y }));
        this.particles.createBlackhole(this.x, this.y, posBalls);
        break;
      }
    }

    this.removeBalls(balls);
    this.addLog(balls.map(b => b.type), trigger.result, trigger.color, trigger.rule.label);
  }

  private triggerConflict(pair: ConflictPair, trigger: TriggerResult): void {
    const key = pairKey(pair.a, pair.b);

    if (key === 'fire|water') {
      this.particles.createSteam(this.x, this.y);
    } else if (key === 'earth|wind') {
      this.particles.createSandstorm(this.x, this.y);
    } else if (key === 'dark|light') {
      const posBalls = this.balls.map(b => ({ x: b.x, y: b.y }));
      this.particles.createBlackhole(this.x, this.y, posBalls);
      this.balls.forEach(b => setTimeout(() => b.reset(), 2000));
      this.balls = [];
      this.addLog([pair.a, pair.b], trigger.result, trigger.color, trigger.rule.label);
      return;
    } else {
      this.particles.createFusionAura(this.x, this.y, pair.color);
    }

    const ballA = this.balls.find(b => b.type === pair.a);
    let ballB: ElementBall | undefined;
    if (pair.a === pair.b) {
      ballB = this.balls.find(b => b.type === pair.b && b !== ballA);
    } else {
      ballB = this.balls.find(b => b.type === pair.b);
    }
    const consumed = [ballA, ballB].filter((b): b is ElementBall => Boolean(b));
    this.removeBalls(consumed);
    this.addLog([pair.a, pair.b], trigger.result, trigger.color, trigger.rule.label);
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

  private addLog(elements: ElementType[], result: string, color: string, ruleLabel?: string): void {
    if (this.onSynthesisCallback) {
      this.onSynthesisCallback({
        id: Math.random().toString(36).slice(2),
        timestamp: Date.now(),
        elements,
        result,
        color,
        ruleLabel
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
