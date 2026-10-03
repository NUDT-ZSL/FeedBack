import { Rng } from './sim/rng';
import type { SimEvent } from './sim/types';

export interface FishGene {
  h: number;
  s: number;
  v: number;
  size: number;
  speed: number;
}

export interface Fish {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: { h: number; s: number; v: number };
  size: number;
  baseSize: number;
  gene: FishGene;
  speed: number;
  gender: 'male' | 'female';
  state: 'swim' | 'chaseFood' | 'mate' | 'heartbeat';
  targetX: number | null;
  targetY: number | null;
  mateTargetId: number | null;
  phase: number;
  swimFreq: number;
  blinkTimer: number;
  isBlinking: boolean;
  blinkDuration: number;
  heartbeatTimer: number;
  canMate: boolean;
  mateCooldown: number;
  eatenCount: number;
}

export interface Food {
  id: number;
  x: number;
  y: number;
  vy: number;
  life: number;
}

interface PendingBirth {
  timer: number;
  parent1Id: number;
  parent2Id: number;
}

/** 心跳动画开始后，小鱼出生的延迟（秒）。原为 setTimeout(1500)，现改为模拟时间驱动 */
const BREED_DELAY = 1.5;

export class FishManager {
  private fishIdCounter = 0;
  private foodIdCounter = 0;
  private width: number;
  private height: number;
  private rng: Rng;
  private pendingBirths: PendingBirth[] = [];
  /** 上一次 update() 期间产生的模拟事件，由 Simulation 逐步取走 */
  private eventSink: SimEvent[] = [];
  public fishes: Fish[] = [];
  public foods: Food[] = [];
  public readonly MAX_FISH = 30;
  public readonly INITIAL_FISH = 10;

  constructor(width: number, height: number, rng: Rng) {
    this.width = width;
    this.height = height;
    this.rng = rng;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** 取走并清空自上次调用以来累积的模拟事件 */
  drainEvents(): SimEvent[] {
    const events = this.eventSink;
    this.eventSink = [];
    return events;
  }

  private emit(event: SimEvent): void {
    this.eventSink.push(event);
  }

  private hsvToRgb(h: number, s: number, v: number): string {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return `rgb(${Math.floor((r + m) * 255)},${Math.floor((g + m) * 255)},${Math.floor((b + m) * 255)})`;
  }

  colorToCss(h: number, s: number, v: number): string {
    return this.hsvToRgb(h, s, v);
  }

  private createRandomGene(): FishGene {
    return {
      h: this.rng.next() * 360,
      s: 0.6 + this.rng.next() * 0.4,
      v: 0.7 + this.rng.next() * 0.3,
      size: 24 + this.rng.next() * 16,
      speed: 30 + this.rng.next() * 50
    };
  }

  private createFish(gene: FishGene, x?: number, y?: number, isBaby = false): Fish {
    const angle = this.rng.next() * Math.PI * 2;
    const speed = gene.speed * (isBaby ? 1.2 : 1);
    const baseSize = isBaby ? gene.size * 0.5 : gene.size;
    return {
      id: this.fishIdCounter++,
      x: x ?? this.rng.next() * (this.width - 100) + 50,
      y: y ?? this.rng.next() * (this.height - 200) + 80,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.6,
      color: { h: gene.h, s: gene.s, v: gene.v },
      size: baseSize,
      baseSize: baseSize,
      gene: { ...gene },
      speed: speed,
      gender: this.rng.next() > 0.5 ? 'male' : 'female',
      state: 'swim',
      targetX: null,
      targetY: null,
      mateTargetId: null,
      phase: this.rng.next() * Math.PI * 2,
      swimFreq: 1 + this.rng.next() * 2,
      blinkTimer: this.rng.next() * 3,
      isBlinking: false,
      blinkDuration: 0,
      heartbeatTimer: 0,
      canMate: !isBaby,
      mateCooldown: isBaby ? 8 : this.rng.next() * 5,
      eatenCount: 0
    };
  }

  initialize(count: number = this.INITIAL_FISH): void {
    this.fishes = [];
    this.foods = [];
    this.pendingBirths = [];
    for (let i = 0; i < count; i++) {
      this.fishes.push(this.createFish(this.createRandomGene()));
    }
  }

  /** 撒食：返回本批生成的食物（位置由 rng 确定性散布） */
  addFood(x: number, y: number): Food[] {
    const created: Food[] = [];
    for (let i = 0; i < 3; i++) {
      const food: Food = {
        id: this.foodIdCounter++,
        x: x + (this.rng.next() - 0.5) * 40,
        y: y + (this.rng.next() - 0.5) * 20,
        vy: 15 + this.rng.next() * 10,
        life: 15
      };
      this.foods.push(food);
      created.push(food);
    }
    return created;
  }

  private inheritGene(p1: FishGene, p2: FishGene): FishGene {
    const mix = (a: number, b: number, mutate: number) => {
      const base = this.rng.next() > 0.5 ? a : b;
      return base + (this.rng.next() - 0.5) * mutate;
    };
    return {
      h: (mix(p1.h, p2.h, 40) + 360) % 360,
      s: Math.max(0.4, Math.min(1, mix(p1.s, p2.s, 0.1))),
      v: Math.max(0.5, Math.min(1, mix(p1.v, p2.v, 0.1))),
      size: Math.max(16, Math.min(56, mix(p1.size, p2.size, 6))),
      speed: Math.max(20, Math.min(100, mix(p1.speed, p2.speed, 15)))
    };
  }

  private breedFish(parent1: Fish, parent2: Fish): void {
    if (this.fishes.length >= this.MAX_FISH) {
      this.emit({ type: 'breedBlocked', parent1Id: parent1.id, parent2Id: parent2.id, reason: 'maxFishReached' });
      return;
    }
    const babyGene = this.inheritGene(parent1.gene, parent2.gene);
    const midX = (parent1.x + parent2.x) / 2;
    const midY = (parent1.y + parent2.y) / 2;
    const baby = this.createFish(babyGene, midX, midY, true);
    this.fishes.push(baby);
    parent1.mateCooldown = 10;
    parent2.mateCooldown = 10;
    parent1.canMate = false;
    parent2.canMate = false;
    this.emit({ type: 'breed', babyId: baby.id, parent1Id: parent1.id, parent2Id: parent2.id, x: midX, y: midY });
  }

  /** 处理到期的繁殖计划（FIFO，保证同一步内多个繁殖的顺序稳定） */
  private processPendingBirths(dt: number): void {
    if (this.pendingBirths.length === 0) return;
    for (const birth of this.pendingBirths) {
      birth.timer -= dt;
    }
    const due = this.pendingBirths.filter(b => b.timer <= 0);
    this.pendingBirths = this.pendingBirths.filter(b => b.timer > 0);
    for (const birth of due) {
      const parent1 = this.fishes.find(f => f.id === birth.parent1Id);
      const parent2 = this.fishes.find(f => f.id === birth.parent2Id);
      if (!parent1 || !parent2) {
        this.emit({ type: 'breedBlocked', parent1Id: birth.parent1Id, parent2Id: birth.parent2Id, reason: 'parentUnavailable' });
        continue;
      }
      this.breedFish(parent1, parent2);
    }
  }

  update(dt: number): void {
    this.processPendingBirths(dt);

    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.y > this.height - 50 || f.life <= 0) {
        this.foods.splice(i, 1);
        this.emit({ type: 'foodRemoved', foodId: f.id, reason: f.life <= 0 ? 'expired' : 'sank' });
      }
    }

    for (const fish of this.fishes) {
      fish.phase += fish.swimFreq * Math.PI * 2 * dt;

      if (fish.isBlinking) {
        fish.blinkDuration -= dt;
        if (fish.blinkDuration <= 0) {
          fish.isBlinking = false;
          fish.blinkTimer = 2 + this.rng.next() * 3;
        }
      } else {
        fish.blinkTimer -= dt;
        if (fish.blinkTimer <= 0) {
          fish.isBlinking = true;
          fish.blinkDuration = 0.1;
        }
      }

      if (fish.heartbeatTimer > 0) {
        fish.heartbeatTimer -= dt;
        fish.size = fish.baseSize * (0.8 + 0.4 * (0.5 + 0.5 * Math.sin(fish.heartbeatTimer * Math.PI * 4)));
        if (fish.heartbeatTimer <= 0) {
          fish.size = fish.baseSize;
          fish.state = 'swim';
        }
        continue;
      }

      if (!fish.canMate) {
        fish.mateCooldown -= dt;
        if (fish.mateCooldown <= 0) {
          fish.canMate = true;
        }
      }

      if (fish.baseSize < fish.gene.size) {
        fish.baseSize = Math.min(fish.gene.size, fish.baseSize + 5 * dt);
        if (fish.state !== 'heartbeat') fish.size = fish.baseSize;
      }

      let nearestFood: Food | null = null;
      let nearestFoodDist = Infinity;
      for (const f of this.foods) {
        const dx = f.x - fish.x;
        const dy = f.y - fish.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 250 && d < nearestFoodDist) {
          nearestFoodDist = d;
          nearestFood = f;
        }
      }

      if (nearestFood) {
        fish.state = 'chaseFood';
        fish.targetX = nearestFood.x;
        fish.targetY = nearestFood.y;
      } else {
        fish.state = 'swim';
        fish.targetX = null;
        fish.targetY = null;
      }

      if (fish.canMate && fish.state !== 'chaseFood') {
        let nearestMate: Fish | null = null;
        let nearestMateDist = Infinity;
        for (const other of this.fishes) {
          if (other.id === fish.id) continue;
          if (!other.canMate) continue;
          if (other.gender === fish.gender) continue;
          if (other.state === 'heartbeat') continue;
          const dx = other.x - fish.x;
          const dy = other.y - fish.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 180 && d < nearestMateDist) {
            nearestMateDist = d;
            nearestMate = other;
          }
        }
        if (nearestMate && nearestMateDist < 30) {
          fish.state = 'heartbeat';
          nearestMate.state = 'heartbeat';
          fish.heartbeatTimer = 2;
          nearestMate.heartbeatTimer = 2;
          fish.mateTargetId = nearestMate.id;
          nearestMate.mateTargetId = fish.id;
          // 原为 setTimeout(1500)，与帧率/真实时间耦合；改为模拟时间驱动的繁殖计划
          this.pendingBirths.push({ timer: BREED_DELAY, parent1Id: fish.id, parent2Id: nearestMate.id });
        } else if (nearestMate) {
          fish.state = 'mate';
          fish.targetX = nearestMate.x;
          fish.targetY = nearestMate.y;
        }
      }

      let desiredVx = fish.vx;
      let desiredVy = fish.vy;

      if (fish.targetX !== null && fish.targetY !== null) {
        const dx = fish.targetX - fish.x;
        const dy = fish.targetY - fish.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) {
          desiredVx = (dx / d) * fish.speed;
          desiredVy = (dy / d) * fish.speed;
        }
      } else {
        if (fish.x < 50) desiredVx = Math.abs(fish.speed);
        if (fish.x > this.width - 50) desiredVx = -Math.abs(fish.speed);
        if (fish.y < 80) desiredVy = Math.abs(fish.speed * 0.6);
        if (fish.y > this.height - 80) desiredVy = -Math.abs(fish.speed * 0.6);

        if (this.rng.next() < 0.005) {
          const angle = this.rng.next() * Math.PI * 2;
          desiredVx = Math.cos(angle) * fish.speed;
          desiredVy = Math.sin(angle) * fish.speed * 0.6;
        }
      }

      fish.vx += (desiredVx - fish.vx) * Math.min(1, dt * 3);
      fish.vy += (desiredVy - fish.vy) * Math.min(1, dt * 3);

      const waveOffset = Math.sin(fish.phase) * fish.size * 0.1;
      fish.x += fish.vx * dt + waveOffset * dt * 2;
      fish.y += fish.vy * dt;

      fish.x = Math.max(30, Math.min(this.width - 30, fish.x));
      fish.y = Math.max(60, Math.min(this.height - 60, fish.y));

      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        const dx = f.x - fish.x;
        const dy = f.y - fish.y;
        if (dx * dx + dy * dy < fish.size * fish.size * 0.3) {
          this.foods.splice(i, 1);
          fish.eatenCount++;
          fish.gene.size = Math.min(56, fish.gene.size * 1.05);
          fish.color.h = (fish.color.h + 30 + this.rng.next() * 60) % 360;
          fish.color.s = Math.min(1, fish.color.s + 0.05);
          this.emit({ type: 'foodEaten', foodId: f.id, fishId: fish.id });
        }
      }
    }
  }

  exportGenes(): string {
    const data = {
      version: 1,
      fishes: this.fishes.map(f => ({
        g: f.gene,
        x: f.x / this.width,
        y: f.y / this.height,
        gd: f.gender
      }))
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }

  importGenes(code: string): boolean {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(code))));
      if (!data.version || !Array.isArray(data.fishes)) return false;
      this.fishes = [];
      for (const fd of data.fishes) {
        const gene: FishGene = {
          h: fd.g.h,
          s: fd.g.s,
          v: fd.g.v,
          size: fd.g.size,
          speed: fd.g.speed
        };
        const fish = this.createFish(gene, fd.x * this.width, fd.y * this.height);
        fish.gender = fd.gd;
        this.fishes.push(fish);
      }
      return true;
    } catch {
      return false;
    }
  }
}
