// 类型定义（被所有文件引用）
// 数据流方向：types.ts → store.ts → components/* → App.tsx

/** 游戏阶段：ready 开场 → playing 演出中 → paused 暂停 → over 结算 */
export type GamePhase = 'ready' | 'playing' | 'paused' | 'over';

/** 表演动作 */
export interface Action {
  id: string;
  name: string;
  icon: string;
  duration: number;        // 耗时（秒）
  successRate: number;     // 成功率 0-1
  fatigueCost: number;     // 消耗疲劳度（休息为负值）
  moodBoost: number;       // 成功后情绪提升
  rewardMultiplier: number; // 打赏倍率
  cooldown: number;        // 冷却（秒）
  isRest?: boolean;        // 休息动作：必定成功且不产生打赏
}

/** 猴子状态 */
export interface MonkeyState {
  currentAction: Action | null;
  fatigue: number;       // 0-100
  score: number;         // 总打赏金额
  isStunned: boolean;    // 是否罢工
  stunEndTime: number;   // 罢工结束的游戏内时刻（秒）
  consecutiveFailures: number;
}

/** 围观者类型 */
export type AudienceType = 'scholar' | 'merchant' | 'elder' | 'child';

export interface AudienceMember {
  id: string;
  type: AudienceType;
  color: string;
  /** 舞台百分比坐标 0-100 */
  position: { x: number; y: number };
}

/** 围观者状态 */
export interface AudienceState {
  count: number;         // 围观人数
  mood: number;          // 情绪值 0-100
  members: AudienceMember[];
}

/** 铜钱（飞行中） */
export interface Coin {
  id: string;
  /** 起点：围观者位置（舞台百分比） */
  startPos: { x: number; y: number };
  /** 落点：猴子周围 50px 半径内（舞台百分比） */
  endPos: { x: number; y: number };
  value: number;
  createdAt: number;     // 游戏内时刻（秒）
  flightTime: number;    // 飞行时长（秒）
  collected: boolean;
}

/** 彩戏道具（扩展能力） */
export interface PropDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  stock: number;         // 每局限量
  cooldown: number;      // 冷却（秒），0 表示无冷却
}

export interface PropState {
  id: string;
  stock: number;         // 剩余次数
  cooldownUntil: number; // 冷却结束的游戏内时刻（秒）
}

/** 游戏状态 */
export interface GameState {
  phase: GamePhase;
  gameTime: number;      // 游戏内累计时间（秒，暂停时冻结）
  timeLeft: number;      // 剩余时间（秒）
  monkey: MonkeyState;
  audience: AudienceState;
  coins: Coin[];
  actionCooldowns: Record<string, number>; // 动作冷却结束时刻（游戏内秒）
  actionStartedAt: number | null;          // 当前动作开始时刻
  props: PropState[];                      // 道具状态（扩展）
  ribbonActive: boolean;                   // 彩绫加护：下一次动作成功率 +20%
  bestScore: number;                       // 历史最佳（localStorage 持久化）
  lastRoundScore: number | null;           // 上一局得分
}
