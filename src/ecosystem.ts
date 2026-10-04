import {
  Animal,
  AnimalType,
  EnvironmentParams,
  FloatingText,
  ANIMAL_CONFIG,
  PREDATION_MAP,
  ALL_ANIMALS,
  INITIAL_ENERGY,
  MAX_ENERGY,
  METABOLISM_RATE,
  PREDATION_ENERGY_RATIO,
} from './types';

const MAP_WIDTH = 800;
const MAP_HEIGHT = 800;
const GRID_SIZE = 50;

export class Ecosystem {
  private animals: Animal[] = [];
  private floatingTexts: FloatingText[] = [];
  private params: EnvironmentParams = {
    temperature: 20,
    precipitation: 250,
    light: 50,
    pollution: 10,
  };
  private nextId = 0;
  private populationStats: Record<AnimalType, number> = {} as Record<AnimalType, number>;
  private grid: Map<string, Animal[]> = new Map();
  private audioContext: AudioContext | null = null;
  private rng: () => number;

  constructor(initialCount: number, rng: () => number = Math.random) {
    this.rng = rng;
    this.initAnimals(initialCount);
    this.initAudio();
  }

  private initAudio(): void {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.audioContext = new AudioCtx();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  private initAnimals(count: number): void {
    this.animals = [];
    this.nextId = 0;

    for (let i = 0; i < count; i++) {
      const type = ALL_ANIMALS[Math.floor(this.rng() * ALL_ANIMALS.length)];
      this.addAnimal(type);
    }

    this.updatePopulationStats();
  }

  private addAnimal(type: AnimalType): void {
    const config = ANIMAL_CONFIG[type];
    const angle = this.rng() * Math.PI * 2;
    const speed = 2 + this.rng() * 2;

    const animal: Animal = {
      id: this.nextId++,
      type,
      diet: config.diet,
      x: this.rng() * (MAP_WIDTH - 40) + 20,
      y: this.rng() * (MAP_HEIGHT - 40) + 20,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hunger: 20 + this.rng() * 30,
      maxHunger: 100,
      energy: INITIAL_ENERGY,
      maxEnergy: MAX_ENERGY,
      color: config.color,
      size: config.size,
      isDying: false,
      deathAnimation: 0,
    };

    this.animals.push(animal);
  }

  playParamSound(paramType: string, value: number): void {
    if (!this.audioContext) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    let baseFreq = 220;
    let freqRange = 440;

    switch (paramType) {
      case 'temperature':
        baseFreq = 200;
        freqRange = 600;
        break;
      case 'precipitation':
        baseFreq = 300;
        freqRange = 400;
        break;
      case 'light':
        baseFreq = 250;
        freqRange = 500;
        break;
      case 'pollution':
        baseFreq = 150;
        freqRange = 300;
        break;
    }

    const normalizedValue = value / 100;
    oscillator.frequency.value = baseFreq + normalizedValue * freqRange;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.1);
  }

  private playPredationSound(): void {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.frequency.setValueAtTime(440, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, this.audioContext.currentTime + 0.1);
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.15);
  }

  setParams(params: Partial<EnvironmentParams>): void {
    this.params = { ...this.params, ...params };
  }

  getParams(): EnvironmentParams {
    return { ...this.params };
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.05);
    const frameParams: EnvironmentParams = { ...this.params };
    const plantDensity = this.calculatePlantDensity(frameParams);

    this.updateGrid();

    for (const animal of this.animals) {
      if (animal.isDying) {
        animal.deathAnimation += dt * 3;
        continue;
      }

      this.updateAnimalMovement(animal, dt, frameParams);
      this.updateAnimalVitals(animal, dt, plantDensity, frameParams);
    }

    this.checkPredation();
    this.updateFloatingTexts(dt);
    this.removeDeadAnimals();
    this.updatePopulationStats();
  }

  private calculatePlantDensity(params: EnvironmentParams = this.params): number {
    const tempFactor = this.calculateTemperatureFactor(params.temperature);
    const rainFactor = params.precipitation / 500;
    const lightFactor = params.light / 100;
    const pollutionFactor = 1 - params.pollution / 100;

    return Math.max(0, tempFactor * rainFactor * lightFactor * pollutionFactor);
  }

  private calculateTemperatureFactor(temp: number): number {
    if (temp < -5 || temp > 45) return 0;
    if (temp < 10) return (temp + 5) / 15;
    if (temp > 35) return (45 - temp) / 10;
    return 1;
  }

  private updateGrid(): void {
    this.grid.clear();
    for (const animal of this.animals) {
      if (animal.isDying) continue;
      const gridX = Math.floor(animal.x / GRID_SIZE);
      const gridY = Math.floor(animal.y / GRID_SIZE);
      const key = `${gridX},${gridY}`;
      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key)!.push(animal);
    }
  }

  private getNearbyAnimals(animal: Animal): Animal[] {
    const nearby: Animal[] = [];
    const gridX = Math.floor(animal.x / GRID_SIZE);
    const gridY = Math.floor(animal.y / GRID_SIZE);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gridX + dx},${gridY + dy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const other of cell) {
            if (other.id !== animal.id && !other.isDying) {
              nearby.push(other);
            }
          }
        }
      }
    }

    return nearby;
  }

  private updateAnimalMovement(animal: Animal, _dt: number, params: EnvironmentParams): void {
    if (this.rng() < 0.02) {
      const angle = this.rng() * Math.PI * 2;
      const speed = 2 + this.rng() * 2;
      animal.vx = Math.cos(angle) * speed;
      animal.vy = Math.sin(angle) * speed;
    }

    let speedMultiplier = 1;
    if (params.temperature > 35 || params.temperature < 5) {
      speedMultiplier = 0.5;
    }

    animal.x += animal.vx * speedMultiplier;
    animal.y += animal.vy * speedMultiplier;

    if (animal.x < animal.size || animal.x > MAP_WIDTH - animal.size) {
      animal.vx *= -1;
      animal.x = Math.max(animal.size, Math.min(MAP_WIDTH - animal.size, animal.x));
    }
    if (animal.y < animal.size || animal.y > MAP_HEIGHT - animal.size) {
      animal.vy *= -1;
      animal.y = Math.max(animal.size, Math.min(MAP_HEIGHT - animal.size, animal.y));
    }
  }

  private updateAnimalVitals(animal: Animal, dt: number, plantDensity: number, params: EnvironmentParams): void {
    const config = ANIMAL_CONFIG[animal.type];
    let hungerIncrease = config.hungerRate * dt * 60;

    const pollutionEffect = 1 + params.pollution / 200;
    hungerIncrease *= pollutionEffect;

    if (animal.diet === 'herbivore') {
      const foodAvailable = plantDensity * 0.5;
      hungerIncrease = Math.max(0, hungerIncrease - foodAvailable * dt * 60);
      const energyGain = plantDensity * config.feedingRate * dt * 60;
      animal.energy += energyGain;
    }

    animal.hunger += hungerIncrease;
    animal.energy -= METABOLISM_RATE * dt * 60;
    animal.energy = Math.max(0, Math.min(animal.maxEnergy, animal.energy));

    if (animal.energy <= 0 || animal.hunger >= animal.maxHunger) {
      animal.isDying = true;
      animal.deathAnimation = 0;
    }
  }

  private checkPredation(): void {
    const settledPreyIds = new Set<number>();
    const predators = this.animals.filter(a => a.diet === 'carnivore' && !a.isDying);

    for (const predator of predators) {
      if (predator.hunger < 20) continue;

      const nearby = this.getNearbyAnimals(predator);
      const preyTypes = PREDATION_MAP[predator.type] || [];

      for (const prey of nearby) {
        if (prey.isDying) continue;
        if (settledPreyIds.has(prey.id)) continue;
        if (!preyTypes.includes(prey.type)) continue;

        const dist = Math.hypot(predator.x - prey.x, predator.y - prey.y);
        const collisionDist = (predator.size + prey.size) * 0.8;

        if (dist < collisionDist) {
          settledPreyIds.add(prey.id);
          this.executePredation(predator, prey);
          break;
        }
      }
    }
  }

  private executePredation(predator: Animal, prey: Animal): void {
    prey.isDying = true;
    prey.deathAnimation = 0;

    const energyGain = prey.energy * PREDATION_ENERGY_RATIO;
    predator.energy = Math.min(predator.maxEnergy, predator.energy + energyGain);
    predator.hunger = Math.max(0, predator.hunger - energyGain);

    this.addFloatingText(predator.x, predator.y - predator.size - 10, `+${Math.round(energyGain)}能量`, '#ffd700');
    this.playPredationSound();
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      opacity: 1,
      offsetY: 0,
    });
  }

  private updateFloatingTexts(dt: number): void {
    for (const ft of this.floatingTexts) {
      ft.offsetY += dt * 40;
      ft.opacity -= dt * 1.5;
    }
    this.floatingTexts = this.floatingTexts.filter(ft => ft.opacity > 0);
  }

  private removeDeadAnimals(): void {
    this.animals = this.animals.filter(a => !a.isDying || a.deathAnimation < 1);

    if (this.animals.length < 20 && this.rng() < 0.02) {
      const type = ALL_ANIMALS[Math.floor(this.rng() * ALL_ANIMALS.length)];
      this.addAnimal(type);
    }
  }

  private updatePopulationStats(): void {
    for (const type of ALL_ANIMALS) {
      this.populationStats[type] = 0;
    }
    for (const animal of this.animals) {
      if (!animal.isDying) {
        this.populationStats[animal.type] = (this.populationStats[animal.type] || 0) + 1;
      }
    }
  }

  getAnimals(): Animal[] {
    return this.animals;
  }

  getPopulationStats(): Record<AnimalType, number> {
    return { ...this.populationStats };
  }

  getPlantDensity(): number {
    return this.calculatePlantDensity();
  }

  getFloatingTexts(): FloatingText[] {
    return this.floatingTexts;
  }

  getMaxPopulation(): number {
    let max = 0;
    for (const type of ALL_ANIMALS) {
      max = Math.max(max, this.populationStats[type] || 0);
    }
    return Math.max(max, 1);
  }

  reset(initialCount: number): void {
    this.floatingTexts = [];
    this.initAnimals(initialCount);
  }
}
