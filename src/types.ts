export interface SkillConfig {
  id: string;
  name: string;
  type: 'fire' | 'ice' | 'heal' | 'lightning' | 'shield';
  damage: number;
  cooldown: number;
  cost: number;
  color: string;
}

export interface CharacterConfig {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  skills: SkillConfig[];
}

export interface BattleLogEntry {
  turn: number;
  actor: string;
  action: 'attack' | 'skill' | 'heal' | 'shield';
  target: string;
  value: number;
  remainingHp: number;
  skillName?: string;
  skillColor?: string;
  isCrit?: boolean;
  timestamp: number;
}

export interface BattleStats {
  totalDamage: number;
  totalHeal: number;
  skillHitRate: number;
  effectiveOutputTime: number;
  skillsUsed: number;
  totalActions: number;
}

export interface BattleResult {
  winner: string | null;
  logs: BattleLogEntry[];
  stats: {
    player1: BattleStats;
    player2: BattleStats;
  };
  turns: number;
}

export interface SavedConfig {
  id: string;
  name: string;
  player1: CharacterConfig;
  player2: CharacterConfig;
  status: 'verified' | 'pending';
  createdAt: number;
  lastResult?: BattleResult;
}
