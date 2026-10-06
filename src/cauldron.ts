import { ElementBall, ElementType, ELEMENT_CONFIGS } from './elements';
import { ParticleSystem } from './particles';
import { RuleSet, ConflictPair, pairKey } from './rules';
import { Counts, ResolvedReaction, countElements, emptyCounts, resolveNextReaction } from './deduction';

export interface SynthesisLog {
  id: string;
  timestamp: number;
  elements: ElementType[];
  result: string;
  color: string;
  ruleId: string;
  ruleLabel: string;
}

const CN_NUMERALS: Record<number, string> = { 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八' };
const ELEMENT_CHARS: Record<ElementType, string> = {
  fire: '火', water: '水', wind: '风', earth: '土', light: '光', dark: '暗'
};
const FUSION_SUFFIX: Record<ElementType, string> = {
  fire: '合一，召唤出火焰精灵！',
  water: '凝结，生成璀璨冰晶！',
  wind: '凝聚，形成旋风风暴！',
  earth: '聚合，凝聚成坚硬巨石！',
  light: '合聚，绽放神圣光芒！',
  dark: '融合，诞生幽暗深渊！'
};

export function fusionResultText(element: ElementType, threshold: number): string {
  const num = CN_NUMERALS[threshold] ?? String(threshold);
  return `${num}${ELEMENT_CHARS[element]}${FUSION_SUFFIX[element]}`;
}

export class Cauldron {
  x: number;
  y: number;
  radius: number;
  balls: ElementBall[] = [];
  private rules: RuleSet;
  private breathePhase: number = 0;
  private breatheSpeed: number = 0.8;
  private particles: ParticleSystem;
  private onSynthesisCallback: ((log: SynthesisLog) => void) | null = null;
  private onCompositionCallback: (() => void) | null = null;
  private onBallsConsumedCallback: ((balls: ElementBall[]) => void) | null = null;

  constructor(x: number, y: number, radius: number, particles: ParticleSystem, rules: RuleSet) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.particles = particles;
    this.rules = rules;
  }

  getRules(): RuleSet {
    return this.rules;
  }

  setRules(rules: RuleSet): void {
    this.rules = rules;
  }

  setOnSynthesis(callback: (log: SynthesisLog) => void): void {
    this.onSynthesisCallback = callback;
  }

  setOnCompositionChange(callback: () => void): void {
    this.onCompositionCallback = callback;
  }

  setOnBallsConsumed(callback: (balls: ElementBall[]) => void): void {
    this.onBallsConsumedCallback = callback;
  }

  getCounts(): Counts {
    if (this.balls.length === 0) return emptyCounts();
    return countElements(this.balls.map(ball => ball.type));
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
    this.notifyComposition();

    setTimeout(() => this.checkReactions(), 100);
  }

  private notifyComposition(): void {
    if (this.onCompositionCallback) this.onCompositionCallback();
  }

  private checkReactions(): void {
    if (this.balls.length === 0) return;

    const resolution = resolveNextReaction(this.getCounts(), this.rules);
    if (!resolution.reaction) return;

    const reaction = resolution.reaction;
    if (reaction.kind === 'fusion' && reaction.element) {
      this.triggerFusion(reaction, reaction.element);
    } else if (reaction.kind === 'conflict' && reaction.pair) {
      this.triggerConflict(reaction, reaction.pair);
    }
  }

  private takeBallsOfType(type: ElementType, count: number): ElementBall[] {
    return this.balls.filter(ball => ball.type === type).slice(0, count);
  }

  private triggerFusion(reaction: ResolvedReaction, element: ElementType): void {
    const threshold = this.rules.fusionThreshold;
    const balls = this.takeBallsOfType(element, threshold);
    if (balls.length < threshold) return;

    const info = ELEMENT_CONFIGS[element];
    const text = fusionResultText(element, threshold);

    this.particles.createFusionAura(this.x, this.y, info.colorEnd);

    switch (element) {
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
    this.addLog(balls.map(b => b.type), text, info.colorEnd, reaction);
  }

  private triggerConflict(reaction: ResolvedReaction, pair: ConflictPair): void {
    const ballsA = this.takeBallsOfType(pair.a, pair.a === pair.b ? 2 : 1);
    if (pair.a !== pair.b && ballsA.length === 0) return;
    let ballsB: ElementBall[] = [];
    if (pair.a === pair.b) {
      if (ballsA.length < 2) return;
    } else {
      ballsB = this.takeBallsOfType(pair.b, 1);
      if (ballsB.length === 0) return;
    }
    const consumed = [...ballsA, ...ballsB];

    const key = pairKey(pair.a, pair.b);
    if (key === pairKey('water', 'fire')) {
      this.particles.createSteam(this.x, this.y);
    } else if (key === pairKey('wind', 'earth')) {
      this.particles.createSandstorm(this.x, this.y);
    } else if (key === pairKey('light', 'dark')) {
      const posBalls = consumed.map(b => ({ x: b.x, y: b.y }));
      this.particles.createBlackhole(this.x, this.y, posBalls);
    } else {
      this.particles.createFusionAura(this.x, this.y, pair.color);
      this.particles.createSteam(this.x, this.y);
    }

    this.removeBalls(consumed);
    this.addLog(consumed.map(b => b.type), pair.reaction, pair.color, reaction);
  }

  private removeBalls(balls: ElementBall[]): void {
    for (const ball of balls) {
      const idx = this.balls.indexOf(ball);
      if (idx >= 0) {
        this.balls.splice(idx, 1);
      }
    }
    if (this.onBallsConsumedCallback) this.onBallsConsumedCallback(balls);
    this.notifyComposition();
  }

  private addLog(elements: ElementType[], result: string, color: string, reaction: ResolvedReaction): void {
    if (this.onSynthesisCallback) {
      this.onSynthesisCallback({
        id: Math.random().toString(36).slice(2),
        timestamp: Date.now(),
        elements,
        result,
        color,
        ruleId: reaction.id,
        ruleLabel: reaction.label
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
