import { SavedConfig } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

const MAX_SAVED_CONFIGS = 10;

class StorageService {
  private configs: Map<string, SavedConfig> = new Map();

  constructor() {
    this.loadFromMemory();
  }

  private loadFromMemory() {
    const sampleConfig1: SavedConfig = {
      id: uuidv4(),
      name: '火焰法师 vs 冰霜战士',
      player1: {
        id: 'p1',
        name: '火焰法师',
        hp: 200,
        maxHp: 200,
        attack: 25,
        defense: 10,
        speed: 18,
        skills: [
          { id: 'fireball', name: '火焰弹', type: 'fire', damage: 35, cooldown: 2, cost: 15, color: '#ff5252' },
          { id: 'lightning-chain', name: '闪电链', type: 'lightning', damage: 45, cooldown: 4, cost: 30, color: '#e040fb' },
        ],
      },
      player2: {
        id: 'p2',
        name: '冰霜战士',
        hp: 280,
        maxHp: 280,
        attack: 20,
        defense: 25,
        speed: 12,
        skills: [
          { id: 'frost-nova', name: '冰霜新星', type: 'ice', damage: 28, cooldown: 3, cost: 20, color: '#448aff' },
          { id: 'shield-charge', name: '护盾冲锋', type: 'shield', damage: 20, cooldown: 3, cost: 18, color: '#ffab40' },
        ],
      },
      status: 'verified',
      createdAt: Date.now() - 86400000,
    };

    const sampleConfig2: SavedConfig = {
      id: uuidv4(),
      name: '治疗牧师 vs 刺客',
      player1: {
        id: 'p1',
        name: '治疗牧师',
        hp: 220,
        maxHp: 220,
        attack: 15,
        defense: 15,
        speed: 15,
        skills: [
          { id: 'heal-wave', name: '治愈波', type: 'heal', damage: 40, cooldown: 4, cost: 25, color: '#69f0ae' },
          { id: 'shield-charge', name: '护盾冲锋', type: 'shield', damage: 20, cooldown: 3, cost: 18, color: '#ffab40' },
        ],
      },
      player2: {
        id: 'p2',
        name: '暗影刺客',
        hp: 180,
        maxHp: 180,
        attack: 35,
        defense: 8,
        speed: 25,
        skills: [
          { id: 'fireball', name: '火焰弹', type: 'fire', damage: 35, cooldown: 2, cost: 15, color: '#ff5252' },
          { id: 'lightning-chain', name: '闪电链', type: 'lightning', damage: 45, cooldown: 4, cost: 30, color: '#e040fb' },
        ],
      },
      status: 'pending',
      createdAt: Date.now() - 3600000,
    };

    this.configs.set(sampleConfig1.id, sampleConfig1);
    this.configs.set(sampleConfig2.id, sampleConfig2);
  }

  getAllConfigs(): SavedConfig[] {
    return Array.from(this.configs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getConfigById(id: string): SavedConfig | undefined {
    return this.configs.get(id);
  }

  saveConfig(config: Omit<SavedConfig, 'id' | 'createdAt'>): SavedConfig {
    const allConfigs = this.getAllConfigs();
    if (allConfigs.length >= MAX_SAVED_CONFIGS) {
      const oldest = allConfigs[allConfigs.length - 1];
      this.configs.delete(oldest.id);
    }

    const newConfig: SavedConfig = {
      ...config,
      id: uuidv4(),
      createdAt: Date.now(),
    };

    this.configs.set(newConfig.id, newConfig);
    return newConfig;
  }

  deleteConfig(id: string): boolean {
    return this.configs.delete(id);
  }

  updateConfigStatus(id: string, status: 'verified' | 'pending'): SavedConfig | undefined {
    const config = this.configs.get(id);
    if (config) {
      config.status = status;
      return config;
    }
    return undefined;
  }
}

export const storageService = new StorageService();
