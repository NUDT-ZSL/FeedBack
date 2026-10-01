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

export class FishManager {
  private fishIdCounter = 0;
  private foodIdCounter = 0;
  private width: number;
  private height: number;
  public fishes: Fish[] = [];
  public foods: Food[] = [];
  public readonly MAX_FISH = 30;
  public readonly INITIAL_FISH = 10;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
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
      h: Math.random() * 360,
      s: 0.6 + Math.random() * 0.4,
      v: 0.7 + Math.random() * 0.3,
      size: 24 + Math.random() * 16,
      speed: 30 + Math.random() * 50
    };
  }

  private createFish(gene: FishGene, x?: number, y?: number, isBaby = false): Fish {
    const angle = Math.random() * Math.PI * 2;
    const speed = gene.speed * (isBaby ? 1.2 : 1);
    const baseSize = isBaby ? gene.size * 0.5 : gene.size;
    return {
      id: this.fishIdCounter++,
      x: x ?? Math.random() * (this.width - 100) + 50,
      y: y ?? Math.random() * (this.height - 200) + 80,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.6,
      color: { h: gene.h, s: gene.s, v: gene.v },
      size: baseSize,
      baseSize: baseSize,
      gene: { ...gene },
      speed: speed,
      gender: Math.random() > 0.5 ? 'male' : 'female',
      state: 'swim',
      targetX: null,
      targetY: null,
      mateTargetId: null,
      phase: Math.random() * Math.PI * 2,
      swimFreq: 1 + Math.random() * 2,
      blinkTimer: Math.random() * 3,
      isBlinking: false,
      blinkDuration: 0,
      heartbeatTimer: 0,
      canMate: !isBaby,
      mateCooldown: isBaby ? 8 : Math.random() * 5,
      eatenCount: 0
    };
  }

  initialize(): void {
    this.fishes = [];
    this.foods = [];
    for (let i = 0; i < this.INITIAL_FISH; i++) {
      this.fishes.push(this.createFish(this.createRandomGene()));
    }
  }

  addFood(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      this.foods.push({
        id: this.foodIdCounter++,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 20,
        vy: 15 + Math.random() * 10,
        life: 15
      });
    }
  }

  private inheritGene(p1: FishGene, p2: FishGene): FishGene {
    const mix = (a: number, b: number, mutate: number) => {
      const base = Math.random() > 0.5 ? a : b;
      return base + (Math.random() - 0.5) * mutate;
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
    if (this.fishes.length >= this.MAX_FISH) return;
    const babyGene = this.inheritGene(parent1.gene, parent2.gene);
    const midX = (parent1.x + parent2.x) / 2;
    const midY = (parent1.y + parent2.y) / 2;
    this.fishes.push(this.createFish(babyGene, midX, midY, true));
    parent1.mateCooldown = 10;
    parent2.mateCooldown = 10;
    parent1.canMate = false;
    parent2.canMate = false;
  }

  update(dt: number): void {
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.y > this.height - 50 || f.life <= 0) {
        this.foods.splice(i, 1);
      }
    }

    for (const fish of this.fishes) {
      fish.phase += fish.swimFreq * Math.PI * 2 * dt;

      if (fish.isBlinking) {
        fish.blinkDuration -= dt;
        if (fish.blinkDuration <= 0) {
          fish.isBlinking = false;
          fish.blinkTimer = 2 + Math.random() * 3;
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
          setTimeout(() => this.breedFish(fish, nearestMate!), 1500);
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

        if (Math.random() < 0.005) {
          const angle = Math.random() * Math.PI * 2;
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
          fish.color.h = (fish.color.h + 30 + Math.random() * 60) % 360;
          fish.color.s = Math.min(1, fish.color.s + 0.05);
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
