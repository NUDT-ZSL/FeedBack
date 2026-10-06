// 游戏核心类型定义。
// 数据流：ActionPanel(选择动作) -> store.selectAction -> store.tick(时钟推进/结算)
//         -> Stage(铜钱/欢呼/猴子动作) 与 StatusPanel(分数/疲劳/情绪/连击/能量)。

export type ActionId =
  | 'flip'
  | 'tripleFlip'
  | 'climb'
  | 'handstand'
  | 'jump'
  | 'rest'
  | 'signature';

export type GameStatus = 'idle' | 'running' | 'paused' | 'finished';

export type Rating = '铜' | '银' | '金';

/** 一个可执行的表演动作（动作列表见 config.ts 的 ACTIONS） */
export interface GameAction {
  id: ActionId;
  name: string;
  desc: string;
  /** 动作耗时（毫秒） */
  duration: number;
  /** 开始时的疲劳变化（休息为负） */
  fatigue: number;
  /** 基础成功率 0~1 */
  successRate: number;
  /** 成功后的情绪加成 */
  moodGain: number;
  /** 铜钱数量倍率（如三筋斗 1.5） */
  coinMultiplier: number;
  /** 动作结束后的冷却（毫秒） */
  cooldown: number;
  /** 休息类动作不受高疲劳减半影响 */
  alwaysSucceeds?: boolean;
}

/** 猴子状态：动作列表由 ACTIONS 提供，此处记录当前动作、疲劳 0~100 与当前得分等 */
export interface MonkeyState {
  currentAction: ActionId | null;
  actionEndsAt: number | null;
  /** 每次开始动作自增，用于触发 CSS 动画重新播放 */
  actionSeq: number;
  /** 疲劳度 0~100 */
  fatigue: number;
  /** 当前打赏得分（文） */
  score: number;
  /** 连续成功动作数（连击） */
  combo: number;
  /** 招牌技充能 0~100 */
  energy: number;
  /** 罢工结束时刻（游戏时间，毫秒），null 表示未罢工 */
  forcedRestUntil: number | null;
}

/** 围观者状态：人数、情绪值 0~100、连续失败次数 */
export interface AudienceState {
  count: number;
  mood: number;
  consecutiveFails: number;
}

/** 飞行中的打赏铜钱 */
export interface Coin {
  id: number;
  startX: number;
  startY: number;
  landX: number;
  landY: number;
  /** 生成时的游戏时间（毫秒） */
  bornAt: number;
  /** 单枚价值（文） */
  value: number;
  spectator: number;
  phase: 'flying' | 'landed';
}

/** 欢呼文字气泡 */
export interface Cheer {
  id: number;
  text: string;
  spectator: number;
  bornAt: number;
}

export interface GameResult {
  score: number;
  rating: Rating;
  maxCombo: number;
  successCount: number;
  failCount: number;
}
