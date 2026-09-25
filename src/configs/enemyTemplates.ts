export type EnemyBehavior = 'melee' | 'ranged' | 'suicide';

export interface EnemyTemplate {
  id: string;
  type: EnemyBehavior;
  name: string;
  health: number;
  speed: number;
  attack: number;
  attackRange: number;
  attackCooldown: number;
  color: number;
  size: number;
  bulletSpeed?: number;
  explosionRadius?: number;
  weight: number;
}

export const enemyTemplates: EnemyTemplate[] = [
  {
    id: 'melee_charger',
    type: 'melee',
    name: '冲锋兵',
    health: 50,
    speed: 300,
    attack: 20,
    attackRange: 36,
    attackCooldown: 700,
    color: 0xCD853F,
    size: 18,
    weight: 60
  },
  {
    id: 'ranged_shooter',
    type: 'ranged',
    name: '远程射手',
    health: 80,
    speed: 150,
    attack: 15,
    attackRange: 280,
    attackCooldown: 1200,
    color: 0x4682B4,
    size: 16,
    bulletSpeed: 200,
    weight: 30
  },
  {
    id: 'suicide_bomber',
    type: 'suicide',
    name: '自爆兵',
    health: 30,
    speed: 200,
    attack: 50,
    attackRange: 55,
    attackCooldown: 1500,
    color: 0xFF4500,
    size: 20,
    explosionRadius: 100,
    weight: 10
  }
];

export const getEnemyById = (id: string): EnemyTemplate | undefined => {
  return enemyTemplates.find(t => t.id === id);
};

export const getEnemiesByType = (type: EnemyBehavior): EnemyTemplate[] => {
  return enemyTemplates.filter(t => t.type === type);
};
