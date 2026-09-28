import { v4 as uuidv4 } from 'uuid';
import {
  Plant,
  PlantSpecies,
  PlantStage,
  DiaryEntry,
  DiaryEntryType,
  calculateGrowthStage,
  calculateProgress,
  STAGE_NAMES,
  User,
  LeaderboardEntry,
} from './types';

export interface OperationResult {
  success: boolean;
  updatedPlant?: Plant;
  diaryEntry?: DiaryEntry;
  message?: string;
}

export class PlantManager {
  private plants: Map<string, Plant> = new Map();
  private diaries: Map<string, DiaryEntry[]> = new Map();
  private users: Map<string, User> = new Map();

  setUsers(users: Map<string, User>): void {
    this.users = users;
  }

  createPlant(ownerId: string, species: PlantSpecies, name: string): Plant {
    const id = uuidv4();
    const now = Date.now();
    const plant: Plant = {
      id,
      ownerId,
      species,
      name,
      stage: calculateGrowthStage(now, now),
      progress: calculateProgress(now, now),
      health: {
        water: 50,
        light: 50,
        nutrition: 50,
      },
      createdAt: now,
      lastWateredBy: [],
      lastFertilizedBy: [],
      lastHelpers: [],
    };
    this.plants.set(id, plant);
    this.diaries.set(id, []);
    this.addDiaryEntry(id, 'create', `植物「${name}」已种植`);
    return plant;
  }

  getPlant(plantId: string): Plant | undefined {
    return this.plants.get(plantId);
  }

  private isFriend(userId1: string, userId2: string): boolean {
    const user1 = this.users.get(userId1);
    const user2 = this.users.get(userId2);
    if (!user1 || !user2) return false;
    return user1.friends.includes(userId2) && user2.friends.includes(userId1);
  }

  private getTodayStr(): string {
    return new Date().toDateString();
  }

  private hasWateredToday(plant: Plant, userId: string): boolean {
    const today = this.getTodayStr();
    return plant.lastWateredBy.some(
      (entry) => entry.userId === userId && new Date(entry.timestamp).toDateString() === today
    );
  }

  private hasFertilizedToday(plant: Plant, userId: string): boolean {
    const today = this.getTodayStr();
    return plant.lastFertilizedBy.some(
      (entry) => entry.userId === userId && new Date(entry.timestamp).toDateString() === today
    );
  }

  private addHelper(plant: Plant, userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    plant.lastHelpers = [
      { userId, username: user.username, avatar: user.avatar, timestamp: Date.now() },
      ...plant.lastHelpers.filter((h) => h.userId !== userId),
    ].slice(0, 5);
  }

  waterPlant(plantId: string, userId: string): OperationResult {
    const plant = this.plants.get(plantId);
    if (!plant) {
      return { success: false, message: '植物不存在' };
    }

    if (plant.ownerId !== userId && !this.isFriend(plant.ownerId, userId)) {
      return { success: false, message: '只能给自己或好友的植物浇水' };
    }

    if (plant.ownerId !== userId && this.hasWateredToday(plant, userId)) {
      return { success: false, message: '今天已经给这个好友的植物浇过水了' };
    }

    const user = this.users.get(userId);
    const username = user?.username || '用户';

    plant.health.water = Math.min(100, plant.health.water + 20);
    plant.lastWateredBy.push({ userId, username, timestamp: Date.now() });

    if (plant.ownerId !== userId) {
      this.addHelper(plant, userId);
    }

    const entry = this.addDiaryEntry(plantId, 'water', `${username}给植物浇了水，水分+20`);

    return { success: true, updatedPlant: { ...plant }, diaryEntry: entry };
  }

  fertilizePlant(plantId: string, userId: string): OperationResult {
    const plant = this.plants.get(plantId);
    if (!plant) {
      return { success: false, message: '植物不存在' };
    }

    if (plant.ownerId !== userId && !this.isFriend(plant.ownerId, userId)) {
      return { success: false, message: '只能给自己或好友的植物施肥' };
    }

    if (plant.ownerId !== userId && this.hasFertilizedToday(plant, userId)) {
      return { success: false, message: '今天已经给这个好友的植物施过肥了' };
    }

    const user = this.users.get(userId);
    const username = user?.username || '用户';

    plant.health.nutrition = Math.min(100, plant.health.nutrition + 20);
    plant.lastFertilizedBy.push({ userId, username, timestamp: Date.now() });

    if (plant.ownerId !== userId) {
      this.addHelper(plant, userId);
    }

    const entry = this.addDiaryEntry(plantId, 'fertilize', `${username}给植物施了肥，营养+20`);

    return { success: true, updatedPlant: { ...plant }, diaryEntry: entry };
  }

  adjustLight(plantId: string, userId: string): OperationResult {
    const plant = this.plants.get(plantId);
    if (!plant) {
      return { success: false, message: '植物不存在' };
    }

    if (plant.ownerId !== userId) {
      return { success: false, message: '只能调整自己植物的光照' };
    }

    plant.health.light = Math.min(100, plant.health.light + 20);

    const user = this.users.get(userId);
    const username = user?.username || '用户';
    const entry = this.addDiaryEntry(plantId, 'light', `${username}调整了植物的光照，光照+20`);

    return { success: true, updatedPlant: { ...plant }, diaryEntry: entry };
  }

  calculateGrowth(): Array<{ plant: Plant; oldStage: PlantStage; newStage: PlantStage }> {
    const stageChanges: Array<{ plant: Plant; oldStage: PlantStage; newStage: PlantStage }> = [];
    const now = Date.now();

    for (const plant of this.plants.values()) {
      const oldStage = plant.stage;

      plant.progress = calculateProgress(plant.createdAt, now);
      plant.stage = calculateGrowthStage(plant.createdAt, now);

      const healthDecayMultiplier = 0.8;
      plant.health.water = Math.max(0, plant.health.water - 2 * healthDecayMultiplier);
      plant.health.light = Math.max(0, plant.health.light - 1 * healthDecayMultiplier);
      plant.health.nutrition = Math.max(0, plant.health.nutrition - 1 * healthDecayMultiplier);

      if (oldStage !== plant.stage) {
        this.addDiaryEntry(
          plant.id,
          'stage',
          `植物成长到了${STAGE_NAMES[plant.stage]}阶段！`
        );
        stageChanges.push({ plant: { ...plant }, oldStage, newStage: plant.stage });
      }
    }

    return stageChanges;
  }

  getPlantsByUser(userId: string): Plant[] {
    const result: Plant[] = [];
    for (const plant of this.plants.values()) {
      if (plant.ownerId === userId) {
        result.push({ ...plant });
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  calculateUserScore(userId: string): number {
    const plants = this.getPlantsByUser(userId);
    let score = 0;

    for (const plant of plants) {
      score += plant.progress;

      const stageScores: Record<PlantStage, number> = {
        seed: 0,
        sprout: 20,
        adult: 50,
        flowering: 100,
      };
      score += stageScores[plant.stage];

      score += plant.lastHelpers.length * 10;

      const ageHours = (Date.now() - plant.createdAt) / (1000 * 60 * 60);
      score += Math.floor(ageHours) * 2;
    }

    return Math.floor(score);
  }

  getLeaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];

    for (const user of this.users.values()) {
      const plants = this.getPlantsByUser(user.id);
      const totalScore = this.calculateUserScore(user.id);
      const recentPlants = plants.slice(0, 3);

      entries.push({
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        totalScore,
        recentPlants,
      });
    }

    return entries.sort((a, b) => b.totalScore - a.totalScore).slice(0, 20);
  }

  addDiaryEntry(plantId: string, type: DiaryEntryType, description: string): DiaryEntry {
    const entry: DiaryEntry = {
      id: uuidv4(),
      plantId,
      timestamp: Date.now(),
      type,
      description,
    };
    const diary = this.diaries.get(plantId) || [];
    diary.unshift(entry);
    this.diaries.set(plantId, diary);
    return entry;
  }

  getDiary(plantId: string): DiaryEntry[] {
    return this.diaries.get(plantId) || [];
  }
}
